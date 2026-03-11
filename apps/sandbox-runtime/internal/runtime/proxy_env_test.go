package runtime

import (
	"os"
	"slices"
	"strings"
	"testing"
)

func TestResolveBaselineProxyEnvironment(t *testing.T) {
	t.Run("derives loopback proxy urls and internal no-proxy coverage", func(t *testing.T) {
		environment, err := resolveBaselineProxyEnvironment(baselineProxyEnvironmentInput{
			ListenAddr:                  ":8090",
			TokenizerProxyEgressBaseURL: "http://tokenizer-proxy.internal:8081/egress",
		})
		if err != nil {
			t.Fatalf("expected environment resolution to succeed, got %v", err)
		}

		expectedProxyURL := "http://127.0.0.1:8090"
		if environment["HTTP_PROXY"] != expectedProxyURL {
			t.Fatalf("expected HTTP_PROXY %s, got %s", expectedProxyURL, environment["HTTP_PROXY"])
		}
		if environment["HTTPS_PROXY"] != expectedProxyURL {
			t.Fatalf(
				"expected HTTPS_PROXY %s, got %s",
				expectedProxyURL,
				environment["HTTPS_PROXY"],
			)
		}
		if environment["http_proxy"] != expectedProxyURL {
			t.Fatalf("expected http_proxy %s, got %s", expectedProxyURL, environment["http_proxy"])
		}
		if environment["https_proxy"] != expectedProxyURL {
			t.Fatalf(
				"expected https_proxy %s, got %s",
				expectedProxyURL,
				environment["https_proxy"],
			)
		}

		noProxyEntries := strings.Split(environment["NO_PROXY"], ",")
		expectedEntries := []string{
			"127.0.0.1",
			"::1",
			"localhost",
			"tokenizer-proxy.internal",
			"tokenizer-proxy.internal:8081",
		}
		slices.Sort(noProxyEntries)
		if !slices.Equal(noProxyEntries, expectedEntries) {
			t.Fatalf("expected NO_PROXY entries %#v, got %#v", expectedEntries, noProxyEntries)
		}
		if environment["no_proxy"] != environment["NO_PROXY"] {
			t.Fatalf("expected no_proxy to match NO_PROXY, got %s and %s", environment["no_proxy"], environment["NO_PROXY"])
		}
	})

	t.Run("applies and restores environment entries", func(t *testing.T) {
		t.Setenv("HTTP_PROXY", "http://original-proxy")

		restore, err := applyEnvironmentEntries(map[string]string{
			"HTTP_PROXY": "http://updated-proxy",
			"NO_PROXY":   "127.0.0.1",
		})
		if err != nil {
			t.Fatalf("expected environment apply to succeed, got %v", err)
		}

		if got := os.Getenv("HTTP_PROXY"); got != "http://updated-proxy" {
			t.Fatalf("expected HTTP_PROXY to be updated, got %s", got)
		}
		if got := os.Getenv("NO_PROXY"); got != "127.0.0.1" {
			t.Fatalf("expected NO_PROXY to be set, got %s", got)
		}

		restore()

		if got := os.Getenv("HTTP_PROXY"); got != "http://original-proxy" {
			t.Fatalf("expected HTTP_PROXY to be restored, got %s", got)
		}
		if _, ok := os.LookupEnv("NO_PROXY"); ok {
			t.Fatal("expected NO_PROXY to be removed during restore")
		}
	})
}
