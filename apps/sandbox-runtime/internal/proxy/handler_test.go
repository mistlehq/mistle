package proxy

import (
	"bufio"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/bootstrap"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/httpclient"
)

func TestHandlerServeHTTP(t *testing.T) {
	t.Run("forwards plain http proxy requests upstream", func(t *testing.T) {
		var capturedAuthHeader string
		var capturedConnectionHeader string
		var capturedProxyAuthorizationHeader string
		var capturedStrippedHeader string
		upstreamServer := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			if request.Method != http.MethodGet {
				t.Fatalf("expected method GET, got %s", request.Method)
			}
			if request.URL.Path != "/v1/models" {
				t.Fatalf("expected path /v1/models, got %s", request.URL.Path)
			}
			if request.URL.RawQuery != "limit=1" {
				t.Fatalf("expected query limit=1, got %s", request.URL.RawQuery)
			}

			capturedAuthHeader = request.Header.Get("Authorization")
			capturedConnectionHeader = request.Header.Get("Connection")
			capturedProxyAuthorizationHeader = request.Header.Get("Proxy-Authorization")
			capturedStrippedHeader = request.Header.Get("X-Strip-Me")
			writer.Header().Set("Connection", "close, X-Upstream-Hop")
			writer.Header().Set("Proxy-Authenticate", "Basic realm=proxy")
			writer.Header().Set("Content-Type", "application/json")
			writer.Header().Set("X-Upstream-Hop", "should-not-forward")
			writer.WriteHeader(http.StatusAccepted)
			_, _ = io.WriteString(writer, `{"ok":true}`)
		}))
		defer upstreamServer.Close()

		handler, err := NewHandler(NewHandlerInput{
			HTTPClient: httpclient.NewDirectClient(http.DefaultClient),
		})
		if err != nil {
			t.Fatalf("expected handler creation to succeed, got %v", err)
		}

		absoluteURL, err := url.Parse(upstreamServer.URL + "/v1/models?limit=1")
		if err != nil {
			t.Fatalf("expected absolute url parse to succeed, got %v", err)
		}

		request := httptest.NewRequest(http.MethodGet, absoluteURL.String(), nil)
		request.URL = absoluteURL
		request.Header.Set("Authorization", "Bearer test-token")
		request.Header.Set("Connection", "keep-alive, X-Strip-Me")
		request.Header.Set("Proxy-Authorization", "Basic cHJveHk=")
		request.Header.Set("X-Strip-Me", "request-hop-by-hop")

		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusAccepted {
			t.Fatalf("expected status 202, got %d", recorder.Code)
		}
		if recorder.Body.String() != `{"ok":true}` {
			t.Fatalf("expected body from upstream, got %s", recorder.Body.String())
		}
		if capturedAuthHeader != "Bearer test-token" {
			t.Fatalf("expected auth header to be forwarded, got %s", capturedAuthHeader)
		}
		if capturedConnectionHeader != "" {
			t.Fatalf("expected Connection header to be stripped, got %s", capturedConnectionHeader)
		}
		if capturedProxyAuthorizationHeader != "" {
			t.Fatalf("expected Proxy-Authorization header to be stripped, got %s", capturedProxyAuthorizationHeader)
		}
		if capturedStrippedHeader != "" {
			t.Fatalf("expected connection-nominated header to be stripped, got %s", capturedStrippedHeader)
		}
		if recorder.Header().Get("Connection") != "" {
			t.Fatalf("expected Connection response header to be stripped, got %s", recorder.Header().Get("Connection"))
		}
		if recorder.Header().Get("Proxy-Authenticate") != "" {
			t.Fatalf("expected Proxy-Authenticate response header to be stripped, got %s", recorder.Header().Get("Proxy-Authenticate"))
		}
	})

	t.Run("rejects non-absolute proxy requests", func(t *testing.T) {
		handler, err := NewHandler(NewHandlerInput{
			HTTPClient: httpclient.NewDirectClient(http.DefaultClient),
		})
		if err != nil {
			t.Fatalf("expected handler creation to succeed, got %v", err)
		}

		request := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
		request.URL.Scheme = ""
		request.URL.Host = ""

		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("expected status 400, got %d", recorder.Code)
		}
	})

	t.Run("rejects https connect traffic when interception is not configured", func(t *testing.T) {
		handler, err := NewHandler(NewHandlerInput{
			HTTPClient: httpclient.NewDirectClient(http.DefaultClient),
		})
		if err != nil {
			t.Fatalf("expected handler creation to succeed, got %v", err)
		}

		proxyServer := httptest.NewServer(handler)
		defer proxyServer.Close()

		client := &http.Client{
			Transport: &http.Transport{
				Proxy: mustProxyURL(t, proxyServer.URL),
			},
		}

		_, err = client.Get("https://127.0.0.1:443/health")
		if err == nil {
			t.Fatal("expected https proxy request without interception configuration to fail")
		}
	})

	t.Run("intercepts https connect traffic, classifies the request, and forwards upstream", func(t *testing.T) {
		var capturedMethod string
		var capturedPath string
		var capturedHost string
		var capturedConnectionHeader string

		upstreamServer := httptest.NewTLSServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			capturedMethod = request.Method
			capturedPath = request.URL.Path
			capturedHost = request.Host
			capturedConnectionHeader = request.Header.Get("Connection")
			writer.Header().Set("Connection", "close, X-Upstream-Hop")
			writer.Header().Set("X-Upstream-Hop", "should-not-forward")
			writer.Header().Set("Content-Type", "application/json")
			writer.WriteHeader(http.StatusCreated)
			_, _ = io.WriteString(writer, `{"proxied":true}`)
		}))
		defer upstreamServer.Close()

		certificateAuthority, rootPool := mustProxyAuthorityAndRootPool(t)
		handler, err := NewHandler(NewHandlerInput{
			HTTPClient:           upstreamServer.Client(),
			CertificateAuthority: certificateAuthority,
		})
		if err != nil {
			t.Fatalf("expected handler creation to succeed, got %v", err)
		}

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

		response, err := client.Get(upstreamServer.URL + "/repos/acme/repo?state=open")
		if err != nil {
			t.Fatalf("expected intercepted https request to succeed, got %v", err)
		}
		defer response.Body.Close()

		responseBody, err := io.ReadAll(response.Body)
		if err != nil {
			t.Fatalf("expected intercepted response body read to succeed, got %v", err)
		}

		if response.StatusCode != http.StatusCreated {
			t.Fatalf("expected upstream status code, got %d", response.StatusCode)
		}
		if string(responseBody) != `{"proxied":true}` {
			t.Fatalf("expected upstream body, got %s", string(responseBody))
		}
		if capturedMethod != http.MethodGet {
			t.Fatalf("expected upstream method GET, got %s", capturedMethod)
		}
		if capturedPath != "/repos/acme/repo" {
			t.Fatalf("expected upstream path /repos/acme/repo, got %s", capturedPath)
		}
		if capturedHost == "" {
			t.Fatal("expected upstream host to be preserved")
		}
		if capturedConnectionHeader != "" {
			t.Fatalf("expected Connection header to be stripped upstream, got %s", capturedConnectionHeader)
		}
		if response.Header.Get("Connection") != "" {
			t.Fatalf("expected proxied Connection header to be stripped, got %s", response.Header.Get("Connection"))
		}
	})

	t.Run("preserves upstream redirects for intercepted https requests", func(t *testing.T) {
		upstreamServer := httptest.NewTLSServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			switch request.URL.Path {
			case "/releases/latest":
				http.Redirect(writer, request, "/releases/tag/v2.88.0", http.StatusFound)
			case "/releases/tag/v2.88.0":
				writer.WriteHeader(http.StatusOK)
				_, _ = io.WriteString(writer, "ok")
			default:
				http.NotFound(writer, request)
			}
		}))
		defer upstreamServer.Close()

		certificateAuthority, rootPool := mustProxyAuthorityAndRootPool(t)
		upstreamTransport, ok := upstreamServer.Client().Transport.(*http.Transport)
		if !ok {
			t.Fatal("expected upstream tls server transport to be *http.Transport")
		}
		handler, err := NewHandler(NewHandlerInput{
			HTTPClient: &http.Client{
				Transport: upstreamTransport.Clone(),
			},
			CertificateAuthority: certificateAuthority,
		})
		if err != nil {
			t.Fatalf("expected handler creation to succeed, got %v", err)
		}

		proxyServer := httptest.NewServer(handler)
		defer proxyServer.Close()

		client := &http.Client{
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
			Transport: &http.Transport{
				Proxy: mustProxyURL(t, proxyServer.URL),
				TLSClientConfig: &tls.Config{
					RootCAs: rootPool,
				},
			},
		}

		response, err := client.Head(upstreamServer.URL + "/releases/latest")
		if err != nil {
			t.Fatalf("expected intercepted https head request to succeed, got %v", err)
		}
		defer response.Body.Close()

		if response.StatusCode != http.StatusFound {
			t.Fatalf("expected upstream redirect status 302, got %d", response.StatusCode)
		}
		if response.Header.Get("Location") != "/releases/tag/v2.88.0" {
			t.Fatalf("expected upstream redirect location to be preserved, got %q", response.Header.Get("Location"))
		}
	})

	t.Run("preserves upgraded https streams after switching protocols", func(t *testing.T) {
		upstreamServer := httptest.NewTLSServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			if request.Header.Get("Connection") != "Upgrade" {
				t.Fatalf("expected upgrade connection header, got %q", request.Header.Get("Connection"))
			}
			if request.Header.Get("Upgrade") != "websocket" {
				t.Fatalf("expected websocket upgrade header, got %q", request.Header.Get("Upgrade"))
			}

			hijacker, ok := writer.(http.Hijacker)
			if !ok {
				t.Fatal("expected tls test server writer to support hijacking")
			}
			hijackedConn, bufferedReadWriter, err := hijacker.Hijack()
			if err != nil {
				t.Fatalf("expected upstream hijack to succeed, got %v", err)
			}
			defer hijackedConn.Close()

			_, _ = io.WriteString(bufferedReadWriter, "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n")
			_ = bufferedReadWriter.Flush()

			payload, err := bufferedReadWriter.ReadString('\n')
			if err != nil {
				t.Fatalf("expected upgraded payload read to succeed, got %v", err)
			}
			if payload != "ping\n" {
				t.Fatalf("expected upstream upgraded payload ping, got %q", payload)
			}

			_, _ = io.WriteString(bufferedReadWriter, "pong\n")
			_ = bufferedReadWriter.Flush()
		}))
		defer upstreamServer.Close()

		certificateAuthority, rootPool := mustProxyAuthorityAndRootPool(t)
		handler, err := NewHandler(NewHandlerInput{
			HTTPClient:           upstreamServer.Client(),
			CertificateAuthority: certificateAuthority,
		})
		if err != nil {
			t.Fatalf("expected handler creation to succeed, got %v", err)
		}

		proxyServer := httptest.NewServer(handler)
		defer proxyServer.Close()

		proxyURL, err := url.Parse(proxyServer.URL)
		if err != nil {
			t.Fatalf("expected proxy url parse to succeed, got %v", err)
		}

		proxyConn, err := net.Dial("tcp", proxyURL.Host)
		if err != nil {
			t.Fatalf("expected proxy dial to succeed, got %v", err)
		}
		defer proxyConn.Close()

		upstreamTarget := strings.TrimPrefix(upstreamServer.URL, "https://")
		_, err = io.WriteString(
			proxyConn,
			fmt.Sprintf("CONNECT %s HTTP/1.1\r\nHost: %s\r\n\r\n", upstreamTarget, upstreamTarget),
		)
		if err != nil {
			t.Fatalf("expected connect request write to succeed, got %v", err)
		}

		proxyReader := bufio.NewReader(proxyConn)
		statusLine, err := proxyReader.ReadString('\n')
		if err != nil {
			t.Fatalf("expected connect status read to succeed, got %v", err)
		}
		if !strings.Contains(statusLine, "200 Connection Established") {
			t.Fatalf("expected connect success status, got %s", statusLine)
		}
		for {
			headerLine, headerErr := proxyReader.ReadString('\n')
			if headerErr != nil {
				t.Fatalf("expected connect header read to succeed, got %v", headerErr)
			}
			if headerLine == "\r\n" {
				break
			}
		}

		tlsConn := tls.Client(
			&bufferedConn{
				Conn:   proxyConn,
				reader: io.MultiReader(proxyReader, proxyConn),
			},
			&tls.Config{
				RootCAs: rootPool,
				ServerName: strings.Split(upstreamTarget, ":")[0],
			},
		)
		defer tlsConn.Close()

		if err := tlsConn.Handshake(); err != nil {
			t.Fatalf("expected tls handshake with proxy to succeed, got %v", err)
		}

		_, err = io.WriteString(
			tlsConn,
			"GET /socket HTTP/1.1\r\nHost: "+upstreamTarget+"\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
		)
		if err != nil {
			t.Fatalf("expected upgraded request write to succeed, got %v", err)
		}

		tlsReader := bufio.NewReader(tlsConn)
		switchingProtocolsLine, err := tlsReader.ReadString('\n')
		if err != nil {
			t.Fatalf("expected switching protocols status read to succeed, got %v", err)
		}
		if !strings.Contains(switchingProtocolsLine, "101 Switching Protocols") {
			t.Fatalf("expected 101 response, got %s", switchingProtocolsLine)
		}
		for {
			headerLine, headerErr := tlsReader.ReadString('\n')
			if headerErr != nil {
				t.Fatalf("expected switching protocols header read to succeed, got %v", headerErr)
			}
			if headerLine == "\r\n" {
				break
			}
		}

		_, err = io.WriteString(tlsConn, "ping\n")
		if err != nil {
			t.Fatalf("expected upgraded payload write to succeed, got %v", err)
		}

		upgradedResponse, err := tlsReader.ReadString('\n')
		if err != nil {
			t.Fatalf("expected upgraded payload read to succeed, got %v", err)
		}
		if upgradedResponse != "pong\n" {
			t.Fatalf("expected upgraded response pong, got %q", upgradedResponse)
		}
	})
}

func TestClassifyInterceptedRequest(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "https://api.github.com/graphql?owner=acme", strings.NewReader(`{"query":"{}"}`))
	request.URL.Scheme = ""
	request.URL.Host = ""
	request.Host = "api.github.com:443"

	classification, err := classifyInterceptedRequest("api.github.com:443", request)
	if err != nil {
		t.Fatalf("expected request classification to succeed, got %v", err)
	}

	if classification.Host != "api.github.com" {
		t.Fatalf("expected classification host api.github.com, got %s", classification.Host)
	}
	if classification.Method != http.MethodPost {
		t.Fatalf("expected classification method POST, got %s", classification.Method)
	}
	if classification.Path != "/graphql" {
		t.Fatalf("expected classification path /graphql, got %s", classification.Path)
	}
	if classification.UpstreamURL.String() != "https://api.github.com:443/graphql?owner=acme" {
		t.Fatalf("unexpected upstream url: %s", classification.UpstreamURL.String())
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

func mustProxyAuthorityAndRootPool(t *testing.T) (*CertificateAuthority, *x509.CertPool) {
	t.Helper()

	proxyCA, err := bootstrap.GenerateProxyCA(time.Date(2026, time.March, 11, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatalf("expected proxy ca generation to succeed, got %v", err)
	}
	certificateAuthority, err := NewCertificateAuthority(proxyCA.CertificatePEM, proxyCA.PrivateKeyPEM)
	if err != nil {
		t.Fatalf("expected proxy certificate authority creation to succeed, got %v", err)
	}
	rootPool := x509.NewCertPool()
	if !rootPool.AppendCertsFromPEM(proxyCA.CertificatePEM) {
		t.Fatal("expected proxy ca certificate to append to root pool")
	}
	return certificateAuthority, rootPool
}
