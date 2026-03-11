package config

import (
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

const ListenAddrEnv = "SANDBOX_RUNTIME_LISTEN_ADDR"
const TokenizerProxyEgressBaseURLEnv = "SANDBOX_RUNTIME_TOKENIZER_PROXY_EGRESS_BASE_URL"
const ProxyCACertFDEnv = "SANDBOX_RUNTIME_PROXY_CA_CERT_FD"
const ProxyCAKeyFDEnv = "SANDBOX_RUNTIME_PROXY_CA_KEY_FD"

type Config struct {
	ListenAddr                  string
	TokenizerProxyEgressBaseURL string
	ProxyCACertFD               int
	ProxyCAKeyFD                int
	ProxyCAConfigured           bool
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

	proxyCACertFDValue, proxyCACertFDSet := lookupEnv(ProxyCACertFDEnv)
	proxyCAKeyFDValue, proxyCAKeyFDSet := lookupEnv(ProxyCAKeyFDEnv)

	if proxyCACertFDSet != proxyCAKeyFDSet {
		return Config{}, fmt.Errorf("%s and %s must be set together", ProxyCACertFDEnv, ProxyCAKeyFDEnv)
	}

	proxyCACertFD := 0
	proxyCAKeyFD := 0
	proxyCAConfigured := false
	if proxyCACertFDSet {
		proxyCACertFD, err = parseFDEnv(ProxyCACertFDEnv, proxyCACertFDValue)
		if err != nil {
			return Config{}, err
		}
		proxyCAKeyFD, err = parseFDEnv(ProxyCAKeyFDEnv, proxyCAKeyFDValue)
		if err != nil {
			return Config{}, err
		}
		proxyCAConfigured = true
	}

	return Config{
		ListenAddr:                  listenAddr,
		TokenizerProxyEgressBaseURL: tokenizerProxyEgressBaseURL,
		ProxyCACertFD:               proxyCACertFD,
		ProxyCAKeyFD:                proxyCAKeyFD,
		ProxyCAConfigured:           proxyCAConfigured,
	}, nil
}

func parseFDEnv(envName string, rawValue string) (int, error) {
	trimmedValue := strings.TrimSpace(rawValue)
	if trimmedValue == "" {
		return 0, fmt.Errorf("%s must not be empty when set", envName)
	}

	fd, err := strconv.Atoi(trimmedValue)
	if err != nil {
		return 0, fmt.Errorf("%s must be a valid file descriptor number: %w", envName, err)
	}
	if fd < 0 {
		return 0, fmt.Errorf("%s must be non-negative", envName)
	}

	return fd, nil
}
