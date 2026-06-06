package egressproxy

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
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
