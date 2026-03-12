package integration

import (
	"compress/gzip"
	"crypto/tls"
	"crypto/x509"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/bootstrap"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/egress"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/httpclient"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/proxy"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/startup"
)

type capturedProxyRequest struct {
	Method  string
	Path    string
	Query   string
	Body    string
	Headers http.Header
}

func TestProxyMediation(t *testing.T) {
	t.Run("mediates matching plain http traffic through tokenizer proxy", func(t *testing.T) {
		capturedRequest := capturedProxyRequest{}
		tokenizerProxyServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			bodyBytes, err := io.ReadAll(request.Body)
			if err != nil {
				t.Fatalf("expected tokenizer request body read to succeed, got %v", err)
			}

			capturedRequest = capturedProxyRequest{
				Method:  request.Method,
				Path:    request.URL.Path,
				Query:   request.URL.RawQuery,
				Body:    string(bodyBytes),
				Headers: request.Header.Clone(),
			}

			writer.Header().Set("Content-Type", "application/json")
			writer.WriteHeader(http.StatusCreated)
			_, _ = io.WriteString(writer, `{"tokenized":true}`)
		}))
		defer tokenizerProxyServer.Close()

		handler := mustProxyHandler(
			t,
			mustProxyHandlerInput{
				runtimePlan:                 buildProxyMediationRuntimePlan(),
				tokenizerProxyEgressBaseURL: tokenizerProxyServer.URL + "/tokenizer-proxy/egress",
			},
		)

		proxyServer := httptest.NewServer(handler)
		defer proxyServer.Close()

		client := &http.Client{
			Transport: &http.Transport{
				Proxy: mustProxyURL(t, proxyServer.URL),
			},
		}

		request, err := http.NewRequest(
			http.MethodPost,
			"http://api.openai.com/v1/responses?stream=true",
			strings.NewReader(`{"model":"gpt-5"}`),
		)
		if err != nil {
			t.Fatalf("expected request creation to succeed, got %v", err)
		}
		request.Header.Set("Content-Type", "application/json")

		response, err := client.Do(request)
		if err != nil {
			t.Fatalf("expected mediated plain http request to succeed, got %v", err)
		}
		defer response.Body.Close()

		responseBody, err := io.ReadAll(response.Body)
		if err != nil {
			t.Fatalf("expected mediated response body read to succeed, got %v", err)
		}

		if response.StatusCode != http.StatusCreated {
			t.Fatalf("expected status 201, got %d", response.StatusCode)
		}
		if string(responseBody) != `{"tokenized":true}` {
			t.Fatalf("unexpected tokenizer response body %s", string(responseBody))
		}
		if capturedRequest.Path != "/tokenizer-proxy/egress/v1/responses" {
			t.Fatalf("unexpected tokenizer path %s", capturedRequest.Path)
		}
		if capturedRequest.Query != "stream=true" {
			t.Fatalf("expected tokenizer query stream=true, got %s", capturedRequest.Query)
		}
		if capturedRequest.Headers.Get(egress.HeaderEgressBindingID) != "ibd_openai" {
			t.Fatalf("expected binding id header, got %s", capturedRequest.Headers.Get(egress.HeaderEgressBindingID))
		}
	})

	t.Run("mediates matching intercepted https traffic through tokenizer proxy", func(t *testing.T) {
		capturedRequest := capturedProxyRequest{}
		tokenizerProxyServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			bodyBytes, err := io.ReadAll(request.Body)
			if err != nil {
				t.Fatalf("expected tokenizer request body read to succeed, got %v", err)
			}

			capturedRequest = capturedProxyRequest{
				Method:  request.Method,
				Path:    request.URL.Path,
				Query:   request.URL.RawQuery,
				Body:    string(bodyBytes),
				Headers: request.Header.Clone(),
			}

			writer.Header().Set("Content-Type", "application/json")
			writer.WriteHeader(http.StatusAccepted)
			_, _ = io.WriteString(writer, `{"intercepted":true}`)
		}))
		defer tokenizerProxyServer.Close()

		certificateAuthority, rootPool := mustProxyAuthorityAndRootPool(t)
		handler := mustProxyHandler(
			t,
			mustProxyHandlerInput{
				runtimePlan:                 buildProxyMediationRuntimePlan(),
				tokenizerProxyEgressBaseURL: tokenizerProxyServer.URL + "/tokenizer-proxy/egress",
				certificateAuthority:        certificateAuthority,
			},
		)

		proxyServer := httptest.NewServer(handler)
		defer proxyServer.Close()

		client := &http.Client{
			Transport: &http.Transport{
				Proxy: mustProxyURL(t, proxyServer.URL),
				TLSClientConfig: &tls.Config{
					RootCAs: rootPool,
				},
			},
		}

		request, err := http.NewRequest(
			http.MethodPost,
			"https://api.openai.com/v1/responses?stream=true",
			strings.NewReader(`{"model":"gpt-5"}`),
		)
		if err != nil {
			t.Fatalf("expected request creation to succeed, got %v", err)
		}
		request.Header.Set("Content-Type", "application/json")

		response, err := client.Do(request)
		if err != nil {
			t.Fatalf("expected mediated https request to succeed, got %v", err)
		}
		defer response.Body.Close()

		responseBody, err := io.ReadAll(response.Body)
		if err != nil {
			t.Fatalf("expected mediated https response body read to succeed, got %v", err)
		}

		if response.StatusCode != http.StatusAccepted {
			t.Fatalf("expected status 202, got %d", response.StatusCode)
		}
		if string(responseBody) != `{"intercepted":true}` {
			t.Fatalf("unexpected tokenizer response body %s", string(responseBody))
		}
		if capturedRequest.Path != "/tokenizer-proxy/egress/v1/responses" {
			t.Fatalf("unexpected tokenizer path %s", capturedRequest.Path)
		}
		if capturedRequest.Headers.Get(egress.HeaderEgressUpstreamBaseURL) != "https://api.openai.com/v1" {
			t.Fatalf(
				"expected upstream base url header, got %s",
				capturedRequest.Headers.Get(egress.HeaderEgressUpstreamBaseURL),
			)
		}
	})

	t.Run("re-originates unmatched traffic without tokenizer mediation", func(t *testing.T) {
		tokenizerProxyRequests := 0
		tokenizerProxyServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			tokenizerProxyRequests++
			writer.WriteHeader(http.StatusInternalServerError)
		}))
		defer tokenizerProxyServer.Close()

		upstreamServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			writer.Header().Set("Content-Type", "text/plain")
			writer.WriteHeader(http.StatusOK)
			_, _ = io.WriteString(writer, "upstream-ok")
		}))
		defer upstreamServer.Close()

		handler := mustProxyHandler(
			t,
			mustProxyHandlerInput{
				runtimePlan:                 buildProxyMediationRuntimePlan(),
				tokenizerProxyEgressBaseURL: tokenizerProxyServer.URL + "/tokenizer-proxy/egress",
			},
		)

		proxyServer := httptest.NewServer(handler)
		defer proxyServer.Close()

		client := &http.Client{
			Transport: &http.Transport{
				Proxy: mustProxyURL(t, proxyServer.URL),
			},
		}

		response, err := client.Get(upstreamServer.URL + "/healthz")
		if err != nil {
			t.Fatalf("expected unmatched request to succeed, got %v", err)
		}
		defer response.Body.Close()

		responseBody, err := io.ReadAll(response.Body)
		if err != nil {
			t.Fatalf("expected unmatched response body read to succeed, got %v", err)
		}

		if tokenizerProxyRequests != 0 {
			t.Fatalf("expected unmatched request to bypass tokenizer proxy, got %d tokenizer requests", tokenizerProxyRequests)
		}
		if response.StatusCode != http.StatusOK {
			t.Fatalf("expected upstream status 200, got %d", response.StatusCode)
		}
		if string(responseBody) != "upstream-ok" {
			t.Fatalf("unexpected upstream body %s", string(responseBody))
		}
	})

	t.Run("re-originates unmatched compressed https traffic without stale encoding headers", func(t *testing.T) {
		tokenizerProxyRequests := 0
		tokenizerProxyServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			tokenizerProxyRequests++
			writer.WriteHeader(http.StatusInternalServerError)
		}))
		defer tokenizerProxyServer.Close()

		upstreamServer := httptest.NewTLSServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			if request.URL.Path != "/packages/mistle" {
				t.Fatalf("expected upstream path /packages/mistle, got %s", request.URL.Path)
			}

			writer.Header().Set("Content-Type", "application/json")
			writer.Header().Set("Content-Encoding", "gzip")
			writer.WriteHeader(http.StatusOK)

			gzipWriter := gzip.NewWriter(writer)
			if _, err := io.WriteString(gzipWriter, `{"name":"mistle"}`); err != nil {
				t.Fatalf("expected gzip body write to succeed, got %v", err)
			}
			if err := gzipWriter.Close(); err != nil {
				t.Fatalf("expected gzip writer close to succeed, got %v", err)
			}
		}))
		defer upstreamServer.Close()

		certificateAuthority, rootPool := mustProxyAuthorityAndRootPool(t)
		handler := mustProxyHandler(
			t,
			mustProxyHandlerInput{
				runtimePlan:                 buildProxyMediationRuntimePlan(),
				tokenizerProxyEgressBaseURL: tokenizerProxyServer.URL + "/tokenizer-proxy/egress",
				certificateAuthority:        certificateAuthority,
				httpClient:                  httpclient.NewDirectClient(upstreamServer.Client()),
			},
		)

		proxyServer := httptest.NewServer(handler)
		defer proxyServer.Close()

		client := &http.Client{
			Transport: &http.Transport{
				Proxy: mustProxyURL(t, proxyServer.URL),
				TLSClientConfig: &tls.Config{
					RootCAs: rootPool,
				},
			},
		}

		response, err := client.Get(upstreamServer.URL + "/packages/mistle")
		if err != nil {
			t.Fatalf("expected unmatched https request to succeed, got %v", err)
		}
		defer response.Body.Close()

		responseBody, err := io.ReadAll(response.Body)
		if err != nil {
			t.Fatalf("expected unmatched https response body read to succeed, got %v", err)
		}

		if tokenizerProxyRequests != 0 {
			t.Fatalf("expected unmatched https request to bypass tokenizer proxy, got %d tokenizer requests", tokenizerProxyRequests)
		}
		if response.StatusCode != http.StatusOK {
			t.Fatalf("expected upstream status 200, got %d", response.StatusCode)
		}
		if response.Header.Get("Content-Encoding") != "" {
			t.Fatalf("expected transparently decompressed response to omit content-encoding, got %q", response.Header.Get("Content-Encoding"))
		}
		if string(responseBody) != `{"name":"mistle"}` {
			t.Fatalf("unexpected upstream body %s", string(responseBody))
		}
	})

	t.Run("fails closed when multiple routes match the same request", func(t *testing.T) {
		runtimePlan := buildProxyMediationRuntimePlan()
		runtimePlan.EgressRoutes = append(runtimePlan.EgressRoutes, startup.EgressCredentialRoute{
			EgressRuleID: "egress_rule_openai_duplicate",
			BindingID: "ibd_openai_duplicate",
			Match: startup.EgressRouteMatch{
				Hosts:        []string{"api.openai.com"},
				PathPrefixes: []string{"/v1"},
				Methods:      []string{"POST"},
			},
			Upstream: startup.EgressRouteUpstream{BaseURL: "https://api.openai.com/v1"},
			AuthInjection: startup.EgressAuthInjection{
				Type:   "bearer",
				Target: "authorization",
			},
			CredentialResolver: startup.EgressCredentialResolver{
				ConnectionID: "icn_openai_duplicate",
				SecretType:   "api_key",
				Purpose:      "api_key",
				ResolverKey:  "default",
			},
		})

		handler := mustProxyHandler(
			t,
			mustProxyHandlerInput{
				runtimePlan:                 runtimePlan,
				tokenizerProxyEgressBaseURL: "http://127.0.0.1:1/tokenizer-proxy/egress",
			},
		)

		proxyServer := httptest.NewServer(handler)
		defer proxyServer.Close()

		client := &http.Client{
			Transport: &http.Transport{
				Proxy: mustProxyURL(t, proxyServer.URL),
			},
		}

		request, err := http.NewRequest(
			http.MethodPost,
			"http://api.openai.com/v1/responses",
			strings.NewReader(`{"model":"gpt-5"}`),
		)
		if err != nil {
			t.Fatalf("expected request creation to succeed, got %v", err)
		}

		response, err := client.Do(request)
		if err != nil {
			t.Fatalf("expected ambiguous request to complete with proxy response, got %v", err)
		}
		defer response.Body.Close()

		if response.StatusCode != http.StatusBadGateway {
			t.Fatalf("expected status 502, got %d", response.StatusCode)
		}
	})
}

type mustProxyHandlerInput struct {
	runtimePlan                 startup.RuntimePlan
	tokenizerProxyEgressBaseURL string
	certificateAuthority        *proxy.CertificateAuthority
	httpClient                  *http.Client
}

func mustProxyHandler(t *testing.T, input mustProxyHandlerInput) http.Handler {
	t.Helper()

	handlerHTTPClient := input.httpClient
	if handlerHTTPClient == nil {
		handlerHTTPClient = httpclient.NewDirectClient(http.DefaultClient)
	}

	integrationMediator, err := egress.NewProxyMediator(egress.NewProxyMediatorInput{
		RuntimePlan:                 input.runtimePlan,
		TokenizerProxyEgressBaseURL: input.tokenizerProxyEgressBaseURL,
		HTTPClient:                  handlerHTTPClient,
	})
	if err != nil {
		t.Fatalf("expected proxy mediator creation to succeed, got %v", err)
	}

	handler, err := proxy.NewHandler(proxy.NewHandlerInput{
		HTTPClient:           handlerHTTPClient,
		CertificateAuthority: input.certificateAuthority,
		IntegrationMediator:  integrationMediator,
	})
	if err != nil {
		t.Fatalf("expected proxy handler creation to succeed, got %v", err)
	}

	return handler
}

func buildProxyMediationRuntimePlan() startup.RuntimePlan {
	return startup.RuntimePlan{
		SandboxProfileID: "sbp_proxy_test",
		Version:          1,
		Image: startup.ResolvedSandboxImage{
			Source:   "base",
			ImageRef: "mistle/sandbox-base:dev",
		},
		EgressRoutes: []startup.EgressCredentialRoute{
			{
				EgressRuleID: "egress_rule_openai",
				BindingID: "ibd_openai",
				Match: startup.EgressRouteMatch{
					Hosts:        []string{"api.openai.com"},
					PathPrefixes: []string{"/v1"},
					Methods:      []string{"POST"},
				},
				Upstream: startup.EgressRouteUpstream{BaseURL: "https://api.openai.com/v1"},
				AuthInjection: startup.EgressAuthInjection{
					Type:   "bearer",
					Target: "authorization",
				},
				CredentialResolver: startup.EgressCredentialResolver{
					ConnectionID: "icn_openai",
					SecretType:   "api_key",
					Purpose:      "api_key",
					ResolverKey:  "default",
				},
			},
		},
		Artifacts:      []startup.RuntimeArtifactSpec{},
		RuntimeClients: []startup.RuntimeClient{},
	}
}

func mustProxyURL(t *testing.T, rawURL string) func(*http.Request) (*url.URL, error) {
	t.Helper()

	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		t.Fatalf("expected proxy url parse to succeed, got %v", err)
	}

	return http.ProxyURL(parsedURL)
}

func mustProxyAuthorityAndRootPool(t *testing.T) (*proxy.CertificateAuthority, *x509.CertPool) {
	t.Helper()

	proxyCA, err := bootstrap.GenerateProxyCA(time.Now().UTC().Add(-time.Hour))
	if err != nil {
		t.Fatalf("expected proxy ca generation to succeed, got %v", err)
	}

	certificateAuthority, err := proxy.NewCertificateAuthority(proxyCA.CertificatePEM, proxyCA.PrivateKeyPEM)
	if err != nil {
		t.Fatalf("expected proxy certificate authority creation to succeed, got %v", err)
	}

	rootPool := x509.NewCertPool()
	if !rootPool.AppendCertsFromPEM(proxyCA.CertificatePEM) {
		t.Fatal("expected proxy ca certificate to append to root pool")
	}

	return certificateAuthority, rootPool
}
