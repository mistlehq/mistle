package egressproxy

import (
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestReadChildConfigParsesRoutesAndInheritedFDs(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "egress-proxy-child.json")
	requireNoError(t, os.WriteFile(configPath, []byte(`{
		"sandboxInstanceId": "sbi_child_config",
		"listenAddr": "127.0.0.1:38513",
		"tunnelGatewayWsUrl": "ws://127.0.0.1:5003/tunnel/sandbox/sbi_child_config",
		"tokenBridgeFd": 7,
		"routes": [
			{
				"egressRuleId": "egr_123",
				"hosts": ["api.example.test"],
				"pathPrefixes": ["/v1"],
				"methods": ["GET", "POST"]
			}
		],
		"proxyCaCertificateFd": 8,
		"proxyCaPrivateKeyFd": 9
	}`), 0o666))

	config, err := ReadChildConfig(configPath)

	requireNoError(t, err)
	assertEqual(t, config.SandboxInstanceID, "sbi_child_config")
	assertEqual(t, config.ListenAddr, "127.0.0.1:38513")
	assertEqual(t, config.TunnelGatewayWSURL, "ws://127.0.0.1:5003/tunnel/sandbox/sbi_child_config")
	if config.TokenBridgeFD == nil {
		t.Fatalf("expected token bridge fd")
	}
	assertEqual(t, *config.TokenBridgeFD, 7)
	assertEqual(t, config.ProxyCACertificateFD, 8)
	assertEqual(t, config.ProxyCAPrivateKeyFD, 9)
	if len(config.Routes) != 1 {
		t.Fatalf("expected 1 route, got %d", len(config.Routes))
	}
	assertEqual(t, config.Routes[0].EgressRuleID, "egr_123")
	assertEqual(t, config.Routes[0].Hosts[0], "api.example.test")
	routes := config.EgressRoutes()
	assertEqual(t, routes[0].EgressRuleID, "egr_123")
	assertEqual(t, routes[0].PathPrefixes[0], "/v1")
}

func TestReadChildConfigRejectsUnknownFields(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "egress-proxy-child.json")
	requireNoError(t, os.WriteFile(configPath, []byte(`{
		"sandboxInstanceId": "sbi_child_config",
		"listenAddr": "127.0.0.1:38513",
		"tunnelGatewayWsUrl": "ws://127.0.0.1:5003/tunnel/sandbox/sbi_child_config",
		"routes": [],
		"proxyCaCertificateFd": 8,
		"proxyCaPrivateKeyFd": 9,
		"extra": true
	}`), 0o666))

	_, err := ReadChildConfig(configPath)

	if err == nil {
		t.Fatalf("expected unknown field to fail")
	}
	if !strings.Contains(err.Error(), `json: unknown field "extra"`) {
		t.Fatalf("expected unknown field error, got %q", err.Error())
	}
}

func TestReadChildConfigRejectsInvalidListenAddress(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "egress-proxy-child.json")
	requireNoError(t, os.WriteFile(configPath, []byte(`{
		"sandboxInstanceId": "sbi_child_config",
		"listenAddr": "not-a-socket-address",
		"tunnelGatewayWsUrl": "ws://127.0.0.1:5003/tunnel/sandbox/sbi_child_config",
		"routes": [],
		"proxyCaCertificateFd": 8,
		"proxyCaPrivateKeyFd": 9
	}`), 0o666))

	_, err := ReadChildConfig(configPath)

	if err == nil {
		t.Fatalf("expected invalid listen address to fail")
	}
	if !strings.Contains(err.Error(), "listenAddr must be a socket address") {
		t.Fatalf("expected listen address error, got %q", err.Error())
	}
}

func TestReadChildConfigRejectsMissingTokenBridgeFD(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "egress-proxy-child.json")
	requireNoError(t, os.WriteFile(configPath, []byte(`{
		"sandboxInstanceId": "sbi_child_config",
		"listenAddr": "127.0.0.1:38513",
		"tunnelGatewayWsUrl": "ws://127.0.0.1:5003/tunnel/sandbox/sbi_child_config",
		"routes": [],
		"proxyCaCertificateFd": 8,
		"proxyCaPrivateKeyFd": 9
	}`), 0o666))

	_, err := ReadChildConfig(configPath)

	if err == nil {
		t.Fatalf("expected missing token bridge fd to fail")
	}
	if !strings.Contains(err.Error(), "tokenBridgeFd is required") {
		t.Fatalf("expected token bridge fd error, got %q", err.Error())
	}
}

func TestBuildChildProxyStateUsesTokenBridgeForDirectGatewayRequests(t *testing.T) {
	var gatewayTarget string
	gateway := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		assertEqual(t, request.URL.Path, DirectEgressHTTPRoutePath)
		gatewayTarget = request.URL.Query().Get("target")
		assertEqual(t, request.Header.Get(DirectGatewayEgressAuthorizationHeaderName), "Bearer bridge-token")
		_, _ = responseWriter.Write([]byte("gateway through child"))
	}))
	defer gateway.Close()
	gatewayURL, err := url.Parse(gateway.URL)
	requireNoError(t, err)
	gatewayURL.Scheme = "ws"
	parentTokenBridge, childTokenBridgeFD := newTokenBridgePair(t)
	defer parentTokenBridge.Close()
	tokenBridgeDone := serveOneTokenBridgeRequest(t, parentTokenBridge, "bridge-token")
	generatedCA, err := GenerateProxyCA(time.Now())
	requireNoError(t, err)
	certificateFile := writeInheritedPayload(t, generatedCA.CertificatePEM)
	privateKeyFile := writeInheritedPayload(t, generatedCA.PrivateKeyPEM)
	state, err := BuildChildProxyState(ChildConfig{
		SandboxInstanceID:    "sbi_child_state",
		ListenAddr:           "127.0.0.1:0",
		TunnelGatewayWSURL:   gatewayURL.String(),
		TokenBridgeFD:        &childTokenBridgeFD,
		Routes:               []ChildRoute{{EgressRuleID: "egr_child", Hosts: []string{"api.example.test"}, PathPrefixes: []string{"/v1"}, Methods: []string{"GET"}}},
		ProxyCACertificateFD: int(certificateFile.Fd()),
		ProxyCAPrivateKeyFD:  int(privateKeyFile.Fd()),
	})
	_ = certificateFile.Close()
	_ = privateKeyFile.Close()
	requireNoError(t, err)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	requireNoError(t, err)
	go func() {
		_ = RunProxyServer(listener, state)
	}()
	t.Cleanup(func() {
		_ = listener.Close()
	})
	proxyURL, err := url.Parse("http://" + listener.Addr().String())
	requireNoError(t, err)
	client := http.Client{Transport: &http.Transport{Proxy: http.ProxyURL(proxyURL)}}

	response, err := client.Get("http://api.example.test/v1/allowed")

	requireNoError(t, err)
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	requireNoError(t, err)
	assertEqual(t, string(body), "gateway through child")
	assertEqual(t, gatewayTarget, "http://api.example.test/v1/allowed")
	<-tokenBridgeDone
}

func TestReadPEMFromInheritedFDReadsPayloadAndClosesFD(t *testing.T) {
	tempFile, err := os.CreateTemp(t.TempDir(), "pem-*")
	requireNoError(t, err)
	_, err = tempFile.WriteString("-----BEGIN CERTIFICATE-----\nexample\n-----END CERTIFICATE-----\n")
	requireNoError(t, err)
	_, err = tempFile.Seek(0, 0)
	requireNoError(t, err)

	payload, err := ReadPEMFromInheritedFD("proxy ca certificate", int(tempFile.Fd()))

	requireNoError(t, err)
	assertEqual(t, payload, "-----BEGIN CERTIFICATE-----\nexample\n-----END CERTIFICATE-----\n")
	if err := tempFile.Close(); err == nil {
		t.Fatalf("expected fd to be closed by ReadPEMFromInheritedFD")
	}
}

func TestReadPEMFromInheritedFDRejectsEmptyPayload(t *testing.T) {
	tempFile, err := os.CreateTemp(t.TempDir(), "pem-*")
	requireNoError(t, err)
	_, err = tempFile.WriteString("\n")
	requireNoError(t, err)
	_, err = tempFile.Seek(0, 0)
	requireNoError(t, err)

	_, err = ReadPEMFromInheritedFD("proxy ca private key", int(tempFile.Fd()))

	if err == nil {
		t.Fatalf("expected empty payload to fail")
	}
	assertEqual(t, err.Error(), "proxy ca private key payload is empty")
}

func serveOneTokenBridgeRequest(t *testing.T, stream *os.File, token string) <-chan struct{} {
	t.Helper()
	done := make(chan struct{})
	go func() {
		defer close(done)
		request, err := readTokenBridgeJSONLine[egressTokenBridgeRequest](stream)
		if err != nil {
			t.Errorf("expected token bridge request, got %v", err)
			return
		}
		err = writeTokenBridgeJSONLine(stream, egressTokenBridgeResponse{
			Type:      "egressToken.response",
			RequestID: request.RequestID,
			Token:     token,
			ExpiresAt: "2026-05-17T00:05:00Z",
			TTLMS:     300000,
		})
		if err != nil {
			t.Errorf("expected token bridge response write, got %v", err)
		}
	}()
	return done
}

func writeInheritedPayload(t *testing.T, payload string) *os.File {
	t.Helper()
	file, err := os.CreateTemp(t.TempDir(), "inherited-payload-*")
	requireNoError(t, err)
	_, err = file.WriteString(payload)
	requireNoError(t, err)
	_, err = file.Seek(0, 0)
	requireNoError(t, err)
	return file
}
