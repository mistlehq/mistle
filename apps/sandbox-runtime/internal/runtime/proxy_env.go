package runtime

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"slices"
	"strings"
)

type baselineProxyEnvironmentInput struct {
	ListenAddr                  string
	TokenizerProxyEgressBaseURL string
}

func resolveLoopbackProxyURL(listenAddr string) (string, error) {
	parsedListenAddr, err := parseListenAddr(listenAddr)
	if err != nil {
		return "", err
	}

	_, port, err := net.SplitHostPort(parsedListenAddr)
	if err != nil {
		return "", fmt.Errorf("listen addr must include a host and port, got %s: %w", listenAddr, err)
	}

	return (&url.URL{
		Scheme: "http",
		Host:   net.JoinHostPort("127.0.0.1", port),
	}).String(), nil
}

func resolveNoProxyEntries(tokenizerProxyEgressBaseURL string) ([]string, error) {
	parsedTokenizerProxyURL, err := url.Parse(strings.TrimSpace(tokenizerProxyEgressBaseURL))
	if err != nil {
		return nil, fmt.Errorf("failed to parse tokenizer proxy egress base url: %w", err)
	}

	entriesSet := map[string]struct{}{
		"127.0.0.1": {},
		"localhost": {},
		"::1":       {},
	}

	if parsedTokenizerProxyURL.Host != "" {
		entriesSet[parsedTokenizerProxyURL.Host] = struct{}{}
	}
	if parsedTokenizerProxyURL.Hostname() != "" {
		entriesSet[parsedTokenizerProxyURL.Hostname()] = struct{}{}
	}

	entries := make([]string, 0, len(entriesSet))
	for entry := range entriesSet {
		entries = append(entries, entry)
	}
	slices.Sort(entries)
	return entries, nil
}

func resolveBaselineProxyEnvironment(input baselineProxyEnvironmentInput) (map[string]string, error) {
	proxyURL, err := resolveLoopbackProxyURL(input.ListenAddr)
	if err != nil {
		return nil, err
	}

	noProxyEntries, err := resolveNoProxyEntries(input.TokenizerProxyEgressBaseURL)
	if err != nil {
		return nil, err
	}
	noProxyValue := strings.Join(noProxyEntries, ",")

	return map[string]string{
		"HTTP_PROXY":  proxyURL,
		"HTTPS_PROXY": proxyURL,
		"NO_PROXY":    noProxyValue,
		"http_proxy":  proxyURL,
		"https_proxy": proxyURL,
		"no_proxy":    noProxyValue,
	}, nil
}

func applyEnvironmentEntries(entries map[string]string) (func(), error) {
	originalValues := make(map[string]*string, len(entries))
	for key, value := range entries {
		if existingValue, ok := os.LookupEnv(key); ok {
			existingValueCopy := existingValue
			originalValues[key] = &existingValueCopy
		} else {
			originalValues[key] = nil
		}

		if err := os.Setenv(key, value); err != nil {
			return nil, fmt.Errorf("failed to set %s: %w", key, err)
		}
	}

	restore := func() {
		for key, originalValue := range originalValues {
			if originalValue == nil {
				_ = os.Unsetenv(key)
				continue
			}
			_ = os.Setenv(key, *originalValue)
		}
	}

	return restore, nil
}
