package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/wottyup/star-accounting/server-go/internal/auth"
	"github.com/wottyup/star-accounting/server-go/internal/config"
	"github.com/wottyup/star-accounting/server-go/internal/vision"
)

type VisionSettingsRepository interface {
	GetUserVisionSettings(context.Context, string) (vision.UserSettings, bool, error)
	SaveUserVisionSettings(context.Context, string, vision.UserSettings) error
	DeleteUserVisionSettings(context.Context, string) error
}

type aiVisionSettingsResponse struct {
	Configured               bool   `json:"configured"`
	Source                   string `json:"source"`
	BaseURL                  string `json:"baseUrl"`
	Model                    string `json:"model"`
	HasAPIKey                bool   `json:"hasApiKey"`
	HasPersonalConfiguration bool   `json:"hasPersonalConfiguration"`
	EncryptionReady          bool   `json:"encryptionReady"`
	PrivateEndpointsAllowed  bool   `json:"privateEndpointsAllowed"`
}

type saveAIVisionSettingsRequest struct {
	BaseURL string `json:"baseUrl"`
	Model   string `json:"model"`
	APIKey  string `json:"apiKey"`
}

func registerAIVisionSettingsRoutes(
	router chi.Router,
	authService *auth.Service,
	repository VisionSettingsRepository,
	defaultVision config.VisionConfig,
	encryptionKey string,
	allowPrivateEndpoints bool,
) {
	router.Group(func(protected chi.Router) {
		protected.Use(requireAuthentication(authService))
		protected.Get("/api/settings/ai-vision", func(writer http.ResponseWriter, request *http.Request) {
			user, exists := authenticatedUser(request.Context())
			if !exists || repository == nil {
				writeJSON(writer, http.StatusServiceUnavailable, map[string]string{"error": "AI 设置服务暂不可用"})
				return
			}
			personal, hasPersonal, err := repository.GetUserVisionSettings(request.Context(), user.ID)
			if err != nil {
				writeJSON(writer, http.StatusServiceUnavailable, map[string]string{"error": "无法读取 AI 设置，请检查云端数据库"})
				return
			}
			response := aiVisionSettingsResponse{
				Source:                   "server",
				BaseURL:                  defaultVision.BaseURL,
				Model:                    defaultVision.Model,
				HasAPIKey:                strings.TrimSpace(defaultVision.APIKey) != "",
				HasPersonalConfiguration: hasPersonal,
				EncryptionReady:          vision.EncryptionReady(encryptionKey),
				PrivateEndpointsAllowed:  allowPrivateEndpoints,
			}
			if hasPersonal {
				response.Source = "personal"
				response.BaseURL = personal.BaseURL
				response.Model = personal.Model
				response.HasAPIKey = personal.EncryptedAPIKey != ""
				if response.HasAPIKey {
					_, err = vision.DecryptAPIKey(encryptionKey, personal.EncryptedAPIKey)
				}
			}
			response.Configured = strings.TrimSpace(response.BaseURL) != "" && strings.TrimSpace(response.Model) != "" && response.HasAPIKey && err == nil
			writeJSON(writer, http.StatusOK, response)
		})

		protected.Put("/api/settings/ai-vision", func(writer http.ResponseWriter, request *http.Request) {
			user, exists := authenticatedUser(request.Context())
			if !exists || repository == nil {
				writeJSON(writer, http.StatusServiceUnavailable, map[string]string{"error": "AI 设置服务暂不可用"})
				return
			}
			if !vision.EncryptionReady(encryptionKey) {
				writeJSON(writer, http.StatusServiceUnavailable, map[string]string{"error": "服务器尚未配置 AI 密钥加密项，请联系管理员"})
				return
			}
			var payload saveAIVisionSettingsRequest
			if !decodeJSON(writer, request, &payload) {
				return
			}
			baseURL := strings.TrimSpace(payload.BaseURL)
			model := strings.TrimSpace(payload.Model)
			apiKey := strings.TrimSpace(payload.APIKey)
			if len(baseURL) > 2048 || len(model) > 191 || len(apiKey) > 8192 {
				writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "地址、模型名或 API Key 超出长度限制"})
				return
			}
			normalizedURL, err := vision.NormalizeBaseURL(baseURL, allowPrivateEndpoints)
			if err != nil {
				writeJSON(writer, http.StatusBadRequest, map[string]string{"error": err.Error()})
				return
			}
			var encryptedKey string
			if apiKey == "" {
				previous, found, readErr := repository.GetUserVisionSettings(request.Context(), user.ID)
				if readErr != nil {
					writeJSON(writer, http.StatusServiceUnavailable, map[string]string{"error": "无法读取已保存的 AI 密钥"})
					return
				}
				if !found {
					writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "首次保存个人模型配置时，请填写 API Key"})
					return
				}
				if _, decryptErr := vision.DecryptAPIKey(encryptionKey, previous.EncryptedAPIKey); decryptErr != nil {
					writeJSON(writer, http.StatusServiceUnavailable, map[string]string{"error": "无法解密已保存的 AI 密钥，请重新填写并保存"})
					return
				}
				encryptedKey = previous.EncryptedAPIKey
			} else {
				encryptedKey, err = vision.EncryptAPIKey(encryptionKey, apiKey)
				if err != nil {
					writeJSON(writer, http.StatusInternalServerError, map[string]string{"error": "AI 密钥加密失败"})
					return
				}
			}
			if model == "" || normalizedURL == "" {
				writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "请填写模型服务地址和模型名称"})
				return
			}
			if err := repository.SaveUserVisionSettings(request.Context(), user.ID, vision.UserSettings{
				BaseURL: normalizedURL, Model: model, EncryptedAPIKey: encryptedKey,
			}); err != nil {
				writeJSON(writer, http.StatusInternalServerError, map[string]string{"error": "保存 AI 设置失败"})
				return
			}
			writeJSON(writer, http.StatusOK, map[string]string{"message": "AI 设置已保存"})
		})

		protected.Delete("/api/settings/ai-vision", func(writer http.ResponseWriter, request *http.Request) {
			user, exists := authenticatedUser(request.Context())
			if !exists || repository == nil {
				writeJSON(writer, http.StatusServiceUnavailable, map[string]string{"error": "AI 设置服务暂不可用"})
				return
			}
			if err := repository.DeleteUserVisionSettings(request.Context(), user.ID); err != nil {
				writeJSON(writer, http.StatusInternalServerError, map[string]string{"error": "恢复服务器默认配置失败"})
				return
			}
			writeJSON(writer, http.StatusOK, map[string]string{"message": "已恢复服务器默认配置"})
		})

		protected.Post("/api/settings/ai-vision/test", func(writer http.ResponseWriter, request *http.Request) {
			user, exists := authenticatedUser(request.Context())
			if !exists || repository == nil {
				writeJSON(writer, http.StatusServiceUnavailable, map[string]string{"error": "AI 设置服务暂不可用"})
				return
			}
			var payload saveAIVisionSettingsRequest
			if !decodeJSON(writer, request, &payload) {
				return
			}
			apiKey := strings.TrimSpace(payload.APIKey)
			if apiKey == "" {
				personal, found, err := repository.GetUserVisionSettings(request.Context(), user.ID)
				if err != nil {
					writeJSON(writer, http.StatusServiceUnavailable, map[string]string{"error": "无法读取已保存的 AI 密钥"})
					return
				}
				if found {
					apiKey, err = vision.DecryptAPIKey(encryptionKey, personal.EncryptedAPIKey)
					if err != nil {
						writeJSON(writer, http.StatusServiceUnavailable, map[string]string{"error": "无法解密已保存的 AI 密钥，请重新填写"})
						return
					}
				}
			}
			provider := vision.ProviderConfig{BaseURL: strings.TrimSpace(payload.BaseURL), Model: strings.TrimSpace(payload.Model), APIKey: apiKey}
			if provider.Model == "" {
				writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "请填写模型名称"})
				return
			}
			if err := vision.TestConnection(request.Context(), provider, allowPrivateEndpoints); err != nil {
				status := http.StatusBadRequest
				if errors.Is(err, context.DeadlineExceeded) {
					status = http.StatusGatewayTimeout
				}
				writeJSON(writer, status, map[string]string{"error": err.Error()})
				return
			}
			writeJSON(writer, http.StatusOK, map[string]string{"message": "模型服务连接成功"})
		})
	})
}

func resolveUserVisionConfig(ctx context.Context, repository VisionSettingsRepository, userID string, defaultVision config.VisionConfig, encryptionKey string) (vision.ProviderConfig, bool, error) {
	if repository != nil {
		personal, found, err := repository.GetUserVisionSettings(ctx, userID)
		if err != nil {
			return vision.ProviderConfig{}, false, err
		}
		if found {
			apiKey, err := vision.DecryptAPIKey(encryptionKey, personal.EncryptedAPIKey)
			if err != nil {
				return vision.ProviderConfig{}, true, err
			}
			return vision.ProviderConfig{BaseURL: personal.BaseURL, Model: personal.Model, APIKey: apiKey}, true, nil
		}
	}
	return vision.ProviderConfig{BaseURL: defaultVision.BaseURL, Model: defaultVision.Model, APIKey: defaultVision.APIKey}, false, nil
}
