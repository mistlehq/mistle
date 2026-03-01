package config

import (
	"fmt"
	"net/url"
	"strings"
)

const ListenAddrEnv = "SANDBOX_RUNTIME_LISTEN_ADDR"
const TokenizerProxyEgressBaseURLEnv = "SANDBOX_RUNTIME_TOKENIZER_PROXY_EGRESS_BASE_URL"

type Config struct {
	ListenAddr                  string
	TokenizerProxyEgressBaseURL string
}

func normalizeURL(rawValue string) (string, error) {
	trimmedValue := strings.TrimSpace(rawValue)
	if trimmedValue == "" {
		return "", fmt.Errorf("value is required")
	}

	parsedURL, err := url.Parse(trimmedValue)
	if err != nil {
		return "", fmt.Errorf("value must be a valid URL: %w", err)
	}

	if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
		return "", fmt.Errorf("value must use http or https scheme")
	}
	if parsedURL.Host == "" {
		return "", fmt.Errorf("value host is required")
	}

	return parsedURL.String(), nil
}

func LoadFromEnv(lookupEnv func(string) (string, bool)) (Config, error) {
	listenAddr, ok := lookupEnv(ListenAddrEnv)
	if !ok || listenAddr == "" {
		return Config{}, fmt.Errorf("%s is required", ListenAddrEnv)
	}

	tokenizerProxyEgressBaseURLValue, ok := lookupEnv(TokenizerProxyEgressBaseURLEnv)
	if !ok || strings.TrimSpace(tokenizerProxyEgressBaseURLValue) == "" {
		return Config{}, fmt.Errorf("%s is required", TokenizerProxyEgressBaseURLEnv)
	}
	tokenizerProxyEgressBaseURL, err := normalizeURL(tokenizerProxyEgressBaseURLValue)
	if err != nil {
		return Config{}, fmt.Errorf("%s is invalid: %w", TokenizerProxyEgressBaseURLEnv, err)
	}

	return Config{
		ListenAddr:                  listenAddr,
		TokenizerProxyEgressBaseURL: tokenizerProxyEgressBaseURL,
	}, nil
}
