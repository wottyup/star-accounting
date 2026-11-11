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
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/wottyup/star-accounting/server-go/internal/auth"
	"github.com/wottyup/star-accounting/server-go/internal/config"
)

const (
	maxRecognitionImageBytes = 10 << 20
	maxMultipartOverhead     = 256 << 10
)

var (
	receiptIdentifierPattern = regexp.MustCompile(`(?i)(订单号|订单编号|商户单号|交易号|流水号|支付凭证号|账单编号)\s*[:：#-]?\s*[a-z0-9_-]+`)
	longNumberPattern        = regexp.MustCompile(`\b\d{10,}\b`)
)

type screenshotRecognition struct {
	Type        *string  `json:"type"`
	Amount      *float64 `json:"amount"`
	Merchant    *string  `json:"merchant"`
	Date        *string  `json:"date"`
	Platform    *string  `json:"platform"`
	Category    *string  `json:"category"`
	Description *string  `json:"description"`
	Confidence  string   `json:"confidence"`
	Warnings    []string `json:"warnings"`
}

func registerScreenshotRecognitionRoute(router chi.Router, authService *auth.Service, vision config.VisionConfig) {
	router.Group(func(protected chi.Router) {
		protected.Use(requireAuthentication(authService))
		protected.Post("/api/transactions/recognize-screenshot", func(writer http.ResponseWriter, request *http.Request) {
			if strings.TrimSpace(vision.APIKey) == "" {
				writeJSON(writer, http.StatusServiceUnavailable, map[string]string{"error": "AI 识别服务尚未配置，请联系管理员"})
				return
			}
			image, contentType, status, message := readRecognitionImage(writer, request)
			if status != http.StatusOK {
				writeJSON(writer, status, map[string]string{"error": message})
				return
			}
			result, err := requestScreenshotRecognition(request.Context(), vision, image, contentType)
			if err != nil {
				writeJSON(writer, http.StatusBadGateway, map[string]string{"error": "截图识别失败，请稍后重试"})
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

func requestScreenshotRecognition(parent context.Context, vision config.VisionConfig, image []byte, contentType string) (screenshotRecognition, error) {
	imageData := "data:" + contentType + ";base64," + base64.StdEncoding.EncodeToString(image)
	prompt := `识别这张支付或订单截图，提取可直接辅助记账的信息。严格遵守：
- 金额优先取最终实付金额；不确定、被遮挡或只出现商品原价时返回 null，不要猜。
- 只有截图明确表示已支付或完成交易时才判断为 EXPENSE；明确收款/退款时可用 INCOME；转账用 TRANSFER。看不清交易状态时 type 为 null。
- 商户尽量提取实际收款商户（如小象超市、拼多多）；支付宝或微信只是支付平台时，不要把它当商户。
- 分类必须从这些值中选最贴合的一项：餐饮、外卖、买菜、闲食、水果、肉类、水产、糖果、甜品、下午茶、饮品、酒类、烟草、购物、服装、鞋类、美容、个人护理、理发、宠物、母婴、玩具、礼物、红包、交通、公交地铁、打车、出行、旅游、加油、充电、汽车保养、停车费、住房、房租、物业费、家具、家电、装修、水费、电费、燃气、网费、清洁、清洁优化、日常清洁、家政、维修、日用、生活用品、通讯、电子产品、影音、打印、医疗、药品、门诊、体育、户外、教育、图书、娱乐、会员订阅、工具、保险、税费手续费、花圃、其他。依据商品明细分类；只知道平台而不知道商品时用购物或其他。
- 如果类型为 INCOME，分类从工资、奖金、兼职、经营收入、报销、退款、租金、利息分红、补贴、二手转卖、理财中选；TRANSFER 的分类是转账。
- 日期只提取截图中清晰可见的交易时间，格式 YYYY-MM-DDTHH:mm；否则返回 null。
- description 只可写简短商品/订单内容摘要；绝不包含订单号、商户单号、流水号、手机号、账号或支付凭证编号。
- confidence 为 high、medium、low 之一；任何关键字段不确定时降低置信度，并在 warnings 用中文简短说明。
只输出 JSON 对象，字段固定为 type、amount、merchant、date、platform、category、description、confidence、warnings。平台只能是支付宝、微信、银行卡、现金、其他之一；未知值为 null。`

	body, err := json.Marshal(map[string]interface{}{
		"model":           vision.Model,
		"response_format": map[string]string{"type": "json_object"},
		"messages": []interface{}{
			map[string]interface{}{"role": "system", "content": prompt},
			map[string]interface{}{"role": "user", "content": []interface{}{
				map[string]string{"type": "text", "text": "请识别这张截图。"},
				map[string]interface{}{"type": "image_url", "image_url": map[string]string{"url": imageData, "detail": "high"}},
			}},
		},
	})
	if err != nil {
		return screenshotRecognition{}, err
	}

	ctx, cancel := context.WithTimeout(parent, 50*time.Second)
	defer cancel()
	endpoint := strings.TrimRight(vision.BaseURL, "/") + "/chat/completions"
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return screenshotRecognition{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+vision.APIKey)
	client := &http.Client{Timeout: 55 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return screenshotRecognition{}, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return screenshotRecognition{}, fmt.Errorf("vision service returned %d", response.StatusCode)
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
	}
	if err := json.Unmarshal(responseBody, &envelope); err != nil || len(envelope.Choices) == 0 {
		return screenshotRecognition{}, errors.New("invalid vision response")
	}
	content := strings.TrimSpace(envelope.Choices[0].Message.Content)
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSuffix(strings.TrimSpace(content), "```")
	var result screenshotRecognition
	if err := json.Unmarshal([]byte(strings.TrimSpace(content)), &result); err != nil {
		return screenshotRecognition{}, errors.New("invalid recognition payload")
	}
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
	result.Warnings = warnings
	return result, nil
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
