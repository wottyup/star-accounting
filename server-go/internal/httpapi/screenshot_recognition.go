package httpapi

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/wottyup/star-accounting/server-go/internal/auth"
	"github.com/wottyup/star-accounting/server-go/internal/config"
	"github.com/wottyup/star-accounting/server-go/internal/vision"
)

const (
	maxRecognitionImageBytes = 10 << 20
	maxMultipartOverhead     = 256 << 10
	maxRecognitionEntries    = 20
)

var (
	receiptIdentifierPattern  = regexp.MustCompile(`(?i)(订单号|订单编号|商户单号|交易号|流水号|支付凭证号|账单编号)\s*[:：#-]?\s*[a-z0-9_-]+`)
	longNumberPattern         = regexp.MustCompile(`\b\d{10,}\b`)
	providerCredentialPattern = regexp.MustCompile(`(?i)(x-api-key|api[_-]?key|authorization)\s*[:=]\s*(?:bearer\s+)?[^\s,"]+`)
)

type screenshotRecognition struct {
	Type         *string                 `json:"type"`
	Amount       *recognitionAmount      `json:"amount"`
	Merchant     *string                 `json:"merchant"`
	Date         *string                 `json:"date"`
	Platform     *string                 `json:"platform"`
	Category     *string                 `json:"category"`
	Description  *string                 `json:"description"`
	Confidence   string                  `json:"confidence"`
	Warnings     recognitionWarnings     `json:"warnings"`
	Transactions []screenshotRecognition `json:"transactions,omitempty"`
}

type recognitionWarnings []string

func (warnings *recognitionWarnings) UnmarshalJSON(data []byte) error {
	value := bytes.TrimSpace(data)
	if bytes.Equal(value, []byte("null")) {
		*warnings = nil
		return nil
	}
	if len(value) > 0 && value[0] == '"' {
		var warning string
		if err := json.Unmarshal(value, &warning); err != nil {
			return err
		}
		*warnings = recognitionWarnings{warning}
		return nil
	}
	if len(value) > 0 && value[0] == '[' {
		var items []string
		if err := json.Unmarshal(value, &items); err != nil {
			return err
		}
		*warnings = recognitionWarnings(items)
		return nil
	}
	return errors.New("warnings must be a string or an array of strings")
}

type recognitionAmount float64

func (amount *recognitionAmount) UnmarshalJSON(data []byte) error {
	value := strings.TrimSpace(string(data))
	if strings.EqualFold(value, "null") {
		return nil
	}
	if strings.HasPrefix(value, "\"") {
		var text string
		if err := json.Unmarshal(data, &text); err != nil {
			return err
		}
		value = strings.NewReplacer("¥", "", "￥", "", "元", "", ",", "", " ", "").Replace(strings.TrimSpace(text))
	}
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return err
	}
	*amount = recognitionAmount(parsed)
	return nil
}

func registerScreenshotRecognitionRoute(router chi.Router, authService *auth.Service, settings VisionSettingsRepository, serverVision config.VisionConfig, encryptionKey string, allowPrivateEndpoints bool) {
	router.Group(func(protected chi.Router) {
		protected.Use(requireAuthentication(authService))
		protected.Post("/api/transactions/recognize-screenshot", func(writer http.ResponseWriter, request *http.Request) {
			user, exists := authenticatedUser(request.Context())
			if !exists {
				writeJSON(writer, http.StatusUnauthorized, map[string]string{"error": "请先登录云端账户"})
				return
			}
			provider, _, err := resolveUserVisionConfig(request.Context(), settings, user.ID, serverVision, encryptionKey)
			if err != nil {
				writeJSON(writer, http.StatusServiceUnavailable, map[string]string{"error": "个人 AI 配置无法解密，请在设置中重新保存或联系管理员"})
				return
			}
			if strings.TrimSpace(provider.APIKey) == "" {
				writeJSON(writer, http.StatusServiceUnavailable, map[string]string{"error": "AI 识别服务尚未配置，请联系管理员"})
				return
			}
			image, contentType, status, message := readRecognitionImage(writer, request)
			if status != http.StatusOK {
				writeJSON(writer, status, map[string]string{"error": message})
				return
			}
			result, err := requestScreenshotRecognition(request.Context(), provider, image, contentType, allowPrivateEndpoints)
			if err != nil {
				writeJSON(writer, http.StatusBadGateway, map[string]string{"error": publicScreenshotRecognitionError(err, provider.APIKey)})
				return
			}
			writeJSON(writer, http.StatusOK, result)
		})
	})
}

func readRecognitionImage(writer http.ResponseWriter, request *http.Request) ([]byte, string, int, string) {
	request.Body = http.MaxBytesReader(writer, request.Body, maxRecognitionImageBytes+maxMultipartOverhead)
	multipart, err := request.MultipartReader()
	if err != nil {
		return nil, "", http.StatusBadRequest, "请选择一张 PNG、JPG 或 WebP 截图"
	}

	var image []byte
	for {
		part, partErr := multipart.NextPart()
		if errors.Is(partErr, io.EOF) {
			break
		}
		if partErr != nil {
			return nil, "", http.StatusBadRequest, "截图上传失败，请重试"
		}
		if part.FormName() != "image" || image != nil {
			_ = part.Close()
			return nil, "", http.StatusBadRequest, "请选择一张 PNG、JPG 或 WebP 截图"
		}
		image, err = io.ReadAll(io.LimitReader(part, maxRecognitionImageBytes+1))
		_ = part.Close()
		if err != nil {
			return nil, "", http.StatusBadRequest, "截图上传失败，请重试"
		}
		if len(image) > maxRecognitionImageBytes {
			return nil, "", http.StatusRequestEntityTooLarge, "图片超过 10 MiB，请压缩后重试"
		}
	}

	if len(image) == 0 {
		return nil, "", http.StatusBadRequest, "请选择一张 PNG、JPG 或 WebP 截图"
	}
	contentType := http.DetectContentType(image)
	if contentType != "image/png" && contentType != "image/jpeg" && contentType != "image/webp" {
		return nil, "", http.StatusUnsupportedMediaType, "仅支持 PNG、JPG 或 WebP 图片"
	}
	return image, contentType, http.StatusOK, ""
}

func requestScreenshotRecognition(parent context.Context, provider vision.ProviderConfig, image []byte, contentType string, allowPrivateEndpoints bool) (screenshotRecognition, error) {
	imageBase64 := base64.StdEncoding.EncodeToString(image)
	imageData := "data:" + contentType + ";base64," + imageBase64
	prompt := `识别这张支付或订单截图，提取可直接辅助记账的信息。严格遵守：
- 识别截图中所有互相独立且明确已支付或已完成的订单；每笔订单各输出一条记录，不得只取第一笔。
- 同一订单含有多件商品时仍只输出一条；金额取该订单最终实付总额，不得把商品行、优惠金额和订单实付重复相加。
- 忽略待付款、已取消订单；明确退款时按 INCOME 处理。最多输出 20 笔，超过时优先保留截图中完整可见的订单，并在 warnings 说明未覆盖数量。
- 金额优先取最终实付金额；不确定、被遮挡或只出现商品原价时返回 null，不要猜。
- 只有截图明确表示已支付或完成交易时才判断为 EXPENSE；明确收款/退款时可用 INCOME；转账用 TRANSFER。看不清交易状态时 type 为 null。
- 商户尽量提取实际收款商户（如小象超市、拼多多）；支付宝或微信只是支付平台时，不要把它当商户。
- 分类必须从这些值中选最贴合的一项：餐饮、外卖、买菜、米面粮油、调料、蛋奶、速食、干货、闲食、水果、肉类、水产、糖果、甜品、下午茶、饮品、酒类、烟草、购物、服装、鞋类、箱包、配饰、美容、个人护理、理发、宠物、宠物食品、宠物洗护、宠物医疗、宠物寄养、母婴、玩具、礼物、红包、公益捐赠、借出、借入、收回借款、归还借款、交通、公交地铁、打车、出行、旅游、机票车票、过路费、住宿、加油、充电、汽车保养、停车费、住房、房租、物业费、家具、家电、装修、水费、电费、燃气、网费、清洁、清洁优化、日常清洁、家政、维修、日用、生活用品、快递跑腿、洗衣洗鞋、搬家、通讯、电子产品、数码配件、AI订阅、API、软件应用、云盘备份、云服务器、域名建站、网络加速、影音、打印、素材授权、医疗、药品、门诊、体检、牙科、康复理疗、体育、户外、教育、图书、文具办公、在线课程、数字阅读、娱乐、演出展览、游戏购买、游戏充值、短剧付费、会员订阅、工具、保险、税费手续费、花圃、运动、其他。依据商品明细分类；只知道平台而不知道商品时用购物或其他。
- 有明确细分类时优先使用细分类；AI订阅用于 AI 会员或订阅套餐，API用于接口调用或 Token 用量付费；游戏购买与游戏充值分开，宠物医疗与人员医疗分开。
- 如果类型为 INCOME，分类从工资、奖金、兼职、经营收入、报销、退款、租金、利息分红、补贴、二手转卖、理财、借入、收回借款中选；TRANSFER 的分类是转账。
- 明确个人借款往来时，借出、归还借款使用 EXPENSE，借入、收回借款使用 INCOME；不要把个人借款归还识别为贷款还款，也不要因画面出现转账就覆盖已确认的借款方向。
- 日期只提取截图中清晰可见的交易时间，格式 YYYY-MM-DDTHH:mm；否则返回 null。
- description 只可写简短商品/订单内容摘要；绝不包含订单号、商户单号、流水号、手机号、账号或支付凭证编号。
- confidence 为 high、medium、low 之一；任何关键字段不确定时降低置信度，并在 warnings 用中文简短说明。
只输出一个 JSON 对象，顶层字段为 transactions。transactions 是数组，每个元素的字段固定为 type、amount、merchant、date、platform、category、description、confidence、warnings。只有一笔时数组也必须包含这一笔；多笔时逐笔列出。平台只能是支付宝、微信、银行卡、现金、其他之一；未知值为 null。`

	apiFormat, err := vision.NormalizeAPIFormat(provider.APIFormat)
	if err != nil {
		return screenshotRecognition{}, err
	}
	var requestPayload map[string]interface{}
	if apiFormat == vision.APIFormatAnthropic {
		requestPayload = map[string]interface{}{
			"model": provider.Model, "max_tokens": 3000, "system": prompt,
			"messages": []interface{}{map[string]interface{}{
				"role": "user", "content": []interface{}{
					map[string]string{"type": "text", "text": "请识别这张截图。"},
					map[string]interface{}{"type": "image", "source": map[string]string{
						"type": "base64", "media_type": contentType, "data": imageBase64,
					}},
				},
			}},
		}
		if isDeepSeekAnthropicEndpoint(provider.BaseURL) {
			requestPayload["thinking"] = map[string]string{"type": "disabled"}
		}
	} else {
		requestPayload = map[string]interface{}{
			"model":           provider.Model,
			"response_format": map[string]string{"type": "json_object"},
			"messages": []interface{}{
				map[string]interface{}{"role": "system", "content": prompt},
				map[string]interface{}{"role": "user", "content": []interface{}{
					map[string]string{"type": "text", "text": "请识别这张截图。"},
					map[string]interface{}{"type": "image_url", "image_url": map[string]string{"url": imageData, "detail": "high"}},
				}},
			},
		}
	}
	body, err := json.Marshal(requestPayload)
	if err != nil {
		return screenshotRecognition{}, err
	}

	client, baseURL, err := vision.NewProviderClient(parent, provider.BaseURL, allowPrivateEndpoints, 55*time.Second)
	if err != nil {
		return screenshotRecognition{}, err
	}
	ctx, cancel := context.WithTimeout(parent, 50*time.Second)
	defer cancel()
	endpoint := strings.TrimRight(baseURL, "/") + "/chat/completions"
	if apiFormat == vision.APIFormatAnthropic {
		endpoint = strings.TrimRight(baseURL, "/") + "/v1/messages"
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return screenshotRecognition{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	if apiFormat == vision.APIFormatAnthropic {
		request.Header.Set("x-api-key", provider.APIKey)
		request.Header.Set("anthropic-version", "2023-06-01")
	} else {
		request.Header.Set("Authorization", "Bearer "+provider.APIKey)
	}
	response, err := client.Do(request)
	if err != nil {
		return screenshotRecognition{}, fmt.Errorf("vision service request failed: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		providerErrorBody, readErr := io.ReadAll(io.LimitReader(response.Body, 8<<10))
		if readErr != nil {
			return screenshotRecognition{}, fmt.Errorf("vision service returned HTTP %d (could not read error response)", response.StatusCode)
		}
		detail := providerErrorDescription(providerErrorBody)
		if detail == "" {
			return screenshotRecognition{}, fmt.Errorf("vision service returned HTTP %d", response.StatusCode)
		}
		return screenshotRecognition{}, fmt.Errorf("vision service returned HTTP %d: %s", response.StatusCode, detail)
	}
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return screenshotRecognition{}, err
	}
	var envelope struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		StopReason string `json:"stop_reason"`
	}
	if err := json.Unmarshal(responseBody, &envelope); err != nil {
		return screenshotRecognition{}, errors.New("invalid vision response")
	}
	var content string
	if apiFormat == vision.APIFormatAnthropic {
		textParts := make([]string, 0, len(envelope.Content))
		for _, block := range envelope.Content {
			if block.Type == "text" && strings.TrimSpace(block.Text) != "" {
				textParts = append(textParts, block.Text)
			}
		}
		content = strings.TrimSpace(strings.Join(textParts, "\n"))
	} else {
		if len(envelope.Choices) == 0 {
			return screenshotRecognition{}, errors.New("invalid vision response")
		}
		content = strings.TrimSpace(envelope.Choices[0].Message.Content)
	}
	if content == "" {
		return screenshotRecognition{}, errors.New("empty vision response")
	}
	if envelope.StopReason == "max_tokens" {
		return screenshotRecognition{}, errors.New("model output reached max_tokens")
	}
	content, ok := extractRecognitionJSON(content)
	if !ok {
		return screenshotRecognition{}, errors.New("invalid recognition payload: no complete JSON object found")
	}
	var result screenshotRecognition
	if err := json.Unmarshal([]byte(strings.TrimSpace(content)), &result); err != nil {
		return screenshotRecognition{}, fmt.Errorf("invalid recognition payload: %w", err)
	}
	entries := result.Transactions
	if len(entries) == 0 {
		legacyEntry := result
		legacyEntry.Transactions = nil
		entries = []screenshotRecognition{legacyEntry}
	}
	truncated := len(entries) > maxRecognitionEntries
	if truncated {
		entries = entries[:maxRecognitionEntries]
	}
	for index := range entries {
		entries[index] = sanitizeScreenshotRecognition(entries[index])
	}
	if truncated {
		entries[0].Warnings = append(entries[0].Warnings, "截图订单较多，仅返回前 20 笔，请分批识别")
	}
	result = entries[0]
	result.Transactions = entries
	return result, nil
}

func sanitizeScreenshotRecognition(result screenshotRecognition) screenshotRecognition {
	result.Type = validTransactionType(result.Type)
	result.Platform = validPlatform(result.Platform)
	if result.Amount != nil && (*result.Amount <= 0 || *result.Amount > 1_000_000_000) {
		result.Amount = nil
	}
	result.Merchant = limitedText(result.Merchant, 120)
	result.Description = safeDescription(result.Description)
	result.Category = limitedText(result.Category, 40)
	if result.Date != nil && !validRecognitionDate(*result.Date) {
		result.Date = nil
	}
	if result.Confidence != "high" && result.Confidence != "medium" {
		result.Confidence = "low"
	}
	warnings := make([]string, 0, 4)
	for _, warning := range result.Warnings {
		if len(warnings) == 4 {
			break
		}
		if safeWarning := limitedText(&warning, 120); safeWarning != nil {
			warnings = append(warnings, *safeWarning)
		}
	}
	result.Warnings = recognitionWarnings(warnings)
	result.Transactions = nil
	return result
}

func isDeepSeekAnthropicEndpoint(baseURL string) bool {
	parsed, err := url.Parse(strings.TrimSpace(baseURL))
	return err == nil && strings.EqualFold(parsed.Hostname(), "api.deepseek.com")
}

func extractRecognitionJSON(content string) (string, bool) {
	content = strings.TrimSpace(removeThinkingSections(content))
	if content == "" {
		return "", false
	}
	var decoded string
	if json.Unmarshal([]byte(content), &decoded) == nil {
		content = strings.TrimSpace(decoded)
	}
	if strings.HasPrefix(content, "```") {
		if newline := strings.IndexByte(content, '\n'); newline >= 0 {
			content = strings.TrimSpace(content[newline+1:])
		}
		if fenceEnd := strings.LastIndex(content, "```"); fenceEnd >= 0 {
			content = strings.TrimSpace(content[:fenceEnd])
		}
	}
	start := strings.IndexByte(content, '{')
	if start < 0 {
		return "", false
	}
	depth := 0
	inString := false
	escaped := false
	for index := start; index < len(content); index++ {
		char := content[index]
		if inString {
			if escaped {
				escaped = false
			} else if char == '\\' {
				escaped = true
			} else if char == '"' {
				inString = false
			}
			continue
		}
		switch char {
		case '"':
			inString = true
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return content[start : index+1], true
			}
		}
	}
	return "", false
}

func removeThinkingSections(content string) string {
	for _, tag := range []string{"think", "thinking"} {
		for {
			lower := strings.ToLower(content)
			start := strings.Index(lower, "<"+tag+">")
			if start < 0 {
				break
			}
			bodyStart := start + len(tag) + 2
			endRelative := strings.Index(lower[bodyStart:], "</"+tag+">")
			if endRelative < 0 {
				content = content[:start]
				break
			}
			end := bodyStart + endRelative + len(tag) + 3
			content = content[:start] + content[end:]
		}
	}
	return content
}

func providerErrorDescription(body []byte) string {
	var envelope struct {
		Error   json.RawMessage `json:"error"`
		Message string          `json:"message"`
	}
	if json.Unmarshal(body, &envelope) != nil {
		return ""
	}
	if len(envelope.Error) > 0 && string(envelope.Error) != "null" {
		var detail struct {
			Type    string          `json:"type"`
			Code    json.RawMessage `json:"code"`
			Message string          `json:"message"`
		}
		if json.Unmarshal(envelope.Error, &detail) == nil {
			parts := make([]string, 0, 3)
			if detail.Type != "" {
				parts = append(parts, detail.Type)
			}
			if len(detail.Code) > 0 && string(detail.Code) != "null" {
				var code string
				if json.Unmarshal(detail.Code, &code) == nil {
					parts = append(parts, code)
				} else {
					parts = append(parts, string(detail.Code))
				}
			}
			if detail.Message != "" {
				parts = append(parts, detail.Message)
			}
			return strings.Join(parts, ": ")
		}
		var message string
		if json.Unmarshal(envelope.Error, &message) == nil {
			return message
		}
	}
	return envelope.Message
}

func publicScreenshotRecognitionError(err error, apiKey string) string {
	if err == nil {
		return "截图识别失败，请稍后重试"
	}
	message := safeScreenshotErrorText(err.Error(), apiKey)
	switch {
	case strings.HasPrefix(message, "vision service returned HTTP "):
		return "模型服务返回错误：" + strings.TrimPrefix(message, "vision service returned ")
	case strings.Contains(message, "context deadline exceeded") || strings.Contains(message, "Client.Timeout exceeded"):
		return "模型服务请求超时，请检查模型服务状态后重试"
	case strings.Contains(message, "model output reached max_tokens"):
		return "模型输出被截断，请重试"
	case strings.Contains(message, "vision service request failed:"):
		return "连接模型服务失败：" + strings.TrimSpace(strings.TrimPrefix(message, "vision service request failed:"))
	case message == "invalid vision response":
		return "模型服务返回了无法解析的响应"
	case message == "empty vision response":
		return "模型服务没有返回识别内容"
	case strings.HasPrefix(message, "invalid recognition payload:"):
		detail := strings.TrimSpace(strings.TrimPrefix(message, "invalid recognition payload:"))
		return "模型返回的内容不是有效记账数据：" + detail
	case message == "invalid recognition payload":
		return "模型返回的内容不是有效记账数据，请重试或调整识别模型"
	default:
		return "截图识别失败：" + message
	}
}

func safeScreenshotErrorText(message, apiKey string) string {
	if apiKey != "" {
		message = strings.ReplaceAll(message, apiKey, "[已隐藏]")
	}
	message = providerCredentialPattern.ReplaceAllString(message, "$1: [已隐藏]")
	message = strings.Map(func(char rune) rune {
		if char < 0x20 || char == 0x7f {
			return ' '
		}
		return char
	}, message)
	message = strings.Join(strings.Fields(message), " ")
	runes := []rune(message)
	if len(runes) > 240 {
		message = string(runes[:240]) + "…"
	}
	return message
}

func validTransactionType(value *string) *string {
	if value == nil || (*value != "EXPENSE" && *value != "INCOME" && *value != "TRANSFER") {
		return nil
	}
	return value
}

func validPlatform(value *string) *string {
	if value == nil {
		return nil
	}
	switch *value {
	case "支付宝", "微信", "银行卡", "现金", "其他":
		return value
	default:
		return nil
	}
}

func limitedText(value *string, maxLength int) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	if len([]rune(trimmed)) > maxLength {
		trimmed = string([]rune(trimmed)[:maxLength])
	}
	return &trimmed
}

func safeDescription(value *string) *string {
	if value == nil {
		return nil
	}
	cleaned := receiptIdentifierPattern.ReplaceAllString(*value, "")
	cleaned = longNumberPattern.ReplaceAllString(cleaned, "")
	cleaned = strings.TrimSpace(strings.Trim(cleaned, "，,、;；:：-— "))
	if cleaned == "" {
		return nil
	}
	return limitedText(&cleaned, 180)
}

func validRecognitionDate(value string) bool {
	_, err := time.Parse("2006-01-02T15:04", value)
	return err == nil
}
