package vision

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type UserSettings struct {
	BaseURL         string
	Model           string
	EncryptedAPIKey string
}

type ProviderConfig struct {
	BaseURL string
	Model   string
	APIKey  string
}

func EncryptionReady(key string) bool {
	return len(strings.TrimSpace(key)) >= 32
}

func EncryptAPIKey(masterKey, apiKey string) (string, error) {
	if !EncryptionReady(masterKey) {
		return "", errors.New("AI vision encryption key is unavailable")
	}
	block, err := aes.NewCipher(deriveKey(masterKey))
	if err != nil {
		return "", err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := aead.Seal(nonce, nonce, []byte(apiKey), nil)
	return base64.StdEncoding.EncodeToString(sealed), nil
}

func DecryptAPIKey(masterKey, encrypted string) (string, error) {
	if !EncryptionReady(masterKey) {
		return "", errors.New("AI vision encryption key is unavailable")
	}
	block, err := aes.NewCipher(deriveKey(masterKey))
	if err != nil {
		return "", err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	sealed, err := base64.StdEncoding.DecodeString(encrypted)
	if err != nil || len(sealed) <= aead.NonceSize() {
		return "", errors.New("invalid encrypted AI vision key")
	}
	nonce, ciphertext := sealed[:aead.NonceSize()], sealed[aead.NonceSize():]
	plaintext, err := aead.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", errors.New("could not decrypt AI vision key")
	}
	return string(plaintext), nil
}

func deriveKey(key string) []byte {
	digest := sha256.Sum256([]byte(strings.TrimSpace(key)))
	return digest[:]
}

func NormalizeBaseURL(raw string, allowPrivate bool) (string, error) {
	trimmed := strings.TrimSpace(raw)
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed == nil || parsed.Hostname() == "" {
		return "", errors.New("请输入有效的模型服务地址")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "" {
		return "", errors.New("模型服务地址不能包含账号、查询参数或片段")
	}
	if !strings.EqualFold(parsed.Scheme, "https") && !(allowPrivate && strings.EqualFold(parsed.Scheme, "http")) {
		return "", errors.New("模型服务地址必须使用 HTTPS；私有服务需由服务器管理员显式允许")
	}
	host := strings.TrimSuffix(strings.ToLower(parsed.Hostname()), ".")
	if host == "" || strings.HasSuffix(host, ".localhost") || host == "localhost" {
		if !allowPrivate {
			return "", errors.New("不能连接本机或内网地址；请联系服务器管理员开启私有模型地址")
		}
	}
	if ip := net.ParseIP(host); ip != nil && !allowPrivate && !publicAddress(ip) {
		return "", errors.New("不能连接本机或内网地址；请联系服务器管理员开启私有模型地址")
	}
	parsed.Host = net.JoinHostPort(parsed.Hostname(), parsed.Port())
	if parsed.Port() == "" {
		parsed.Host = parsed.Hostname()
		if strings.Contains(parsed.Hostname(), ":") {
			parsed.Host = "[" + parsed.Hostname() + "]"
		}
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	return strings.TrimRight(parsed.String(), "/"), nil
}

func NewProviderClient(ctx context.Context, baseURL string, allowPrivate bool, timeout time.Duration) (*http.Client, string, error) {
	normalized, err := NormalizeBaseURL(baseURL, allowPrivate)
	if err != nil {
		return nil, "", err
	}
	parsed, _ := url.Parse(normalized)
	client := &http.Client{
		Timeout: timeout,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
		Transport: &http.Transport{Proxy: nil},
	}
	if allowPrivate {
		return client, normalized, nil
	}

	host := parsed.Hostname()
	port := parsed.Port()
	if port == "" {
		port = "443"
	}
	lookupContext, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	addresses, err := net.DefaultResolver.LookupIPAddr(lookupContext, host)
	if err != nil || len(addresses) == 0 {
		return nil, "", errors.New("无法解析模型服务地址")
	}
	for _, address := range addresses {
		if !publicAddress(address.IP) {
			return nil, "", errors.New("模型服务地址解析到本机或内网，请联系服务器管理员开启私有模型地址")
		}
	}
	allowed := make([]net.IP, 0, len(addresses))
	for _, address := range addresses {
		allowed = append(allowed, append(net.IP(nil), address.IP...))
	}
	client.Transport = &http.Transport{
		Proxy: nil,
		DialContext: func(dialContext context.Context, network, address string) (net.Conn, error) {
			dialHost, dialPort, splitErr := net.SplitHostPort(address)
			if splitErr != nil || !strings.EqualFold(strings.Trim(dialHost, "[]"), host) || dialPort != port {
				return nil, errors.New("模型服务连接地址无效")
			}
			dialer := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
			var lastError error
			for _, ip := range allowed {
				connection, dialErr := dialer.DialContext(dialContext, network, net.JoinHostPort(ip.String(), port))
				if dialErr == nil {
					return connection, nil
				}
				lastError = dialErr
			}
			if lastError == nil {
				lastError = errors.New("model service is unreachable")
			}
			return nil, lastError
		},
	}
	return client, normalized, nil
}

func publicAddress(ip net.IP) bool {
	if ip == nil || !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() {
		return false
	}
	ipv4 := ip.To4()
	return ipv4 == nil || ipv4[0] != 100 || ipv4[1] < 64 || ipv4[1] > 127
}

func TestConnection(ctx context.Context, provider ProviderConfig, allowPrivate bool) error {
	if strings.TrimSpace(provider.APIKey) == "" {
		return errors.New("请填写 API Key")
	}
	client, baseURL, err := NewProviderClient(ctx, provider.BaseURL, allowPrivate, 15*time.Second)
	if err != nil {
		return err
	}
	endpoint := baseURL + "/models"
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return errors.New("模型服务地址无效")
	}
	request.Header.Set("Authorization", "Bearer "+provider.APIKey)
	response, err := client.Do(request)
	if err != nil {
		return errors.New("连接模型服务失败，请检查地址、网络和证书")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return errors.New("模型服务拒绝连接，请检查模型服务地址和 API Key")
	}
	return nil
}
