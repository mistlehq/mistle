package control

import (
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/mistle/sandboxd/protocol"
)

func TestServerHandlesReadyAndShutdownRequests(t *testing.T) {
	socketPath := shortUnixSocketPath(t)
	server, err := StartServer(socketPath)
	requireNoError(t, err)
	waitForControlSocket(t, socketPath)

	requireNoError(t, SubmitReady(socketPath))
	requireNoError(t, SubmitShutdown(socketPath))
	requireNoError(t, server.Wait())
	if _, err := os.Lstat(socketPath); !os.IsNotExist(err) {
		t.Fatalf("expected control socket to be removed after shutdown, got %v", err)
	}
}

func TestServerRecordsFailedActivationWhenBootstrapTunnelConnectionFails(t *testing.T) {
	socketPath := shortUnixSocketPath(t)
	server, err := StartServer(socketPath)
	requireNoError(t, err)
	defer server.Close()
	waitForControlSocket(t, socketPath)

	err = SubmitActivate(socketPath, controlClientActivationInput())

	if err == nil {
		t.Fatalf("expected activation to fail when bootstrap tunnel connection fails")
	}
	if !strings.Contains(err.Error(), "control socket returned an error: sandbox startup request was rejected: sandboxd activation failed: failed to initialize sandboxd state: failed to start bootstrap tunnel session: failed to connect bootstrap tunnel:") {
		t.Fatalf("expected bootstrap tunnel connection failure, got %q", err.Error())
	}
	health := fetchHealthResponse(t, server)
	assertEqual(t, health["daemon_phase"].(string), "failed")
	if !strings.Contains(health["init_error"].(string), "failed to initialize sandboxd state: failed to start bootstrap tunnel session: failed to connect bootstrap tunnel:") {
		t.Fatalf("expected health init_error to describe bootstrap tunnel connection failure, got %q", health["init_error"].(string))
	}
}

func TestServerRejectsDuplicateActivationAfterFailure(t *testing.T) {
	socketPath := shortUnixSocketPath(t)
	server, err := StartServer(socketPath)
	requireNoError(t, err)
	defer server.Close()
	waitForControlSocket(t, socketPath)

	activationInput := controlClientActivationInput()
	firstErr := SubmitActivate(socketPath, activationInput)
	secondErr := SubmitActivate(socketPath, activationInput)

	if firstErr == nil || secondErr == nil {
		t.Fatalf("expected both activation attempts to fail")
	}
	if !strings.Contains(secondErr.Error(), "control socket returned an error: sandbox startup request was rejected: sandboxd activation already failed: failed to initialize sandboxd state: failed to start bootstrap tunnel session: failed to connect bootstrap tunnel:") {
		t.Fatalf("expected duplicate activation to report original bootstrap tunnel failure, got %q", secondErr.Error())
	}
}

func TestServerRejectsActivationWithInvalidGatewayURLBeforeStateInitialization(t *testing.T) {
	socketPath := shortUnixSocketPath(t)
	server, err := StartServer(socketPath)
	requireNoError(t, err)
	defer server.Close()
	waitForControlSocket(t, socketPath)
	activationInput := controlClientActivationInput()
	activationInput.TunnelGatewayWSURL = "ws://127.0.0.1:5003/"

	err = SubmitActivate(socketPath, activationInput)

	if err == nil {
		t.Fatalf("expected invalid gateway URL to fail activation")
	}
	assertEqual(t, err.Error(), "control socket returned an error: failed to initialize sandboxd state: failed to start bootstrap tunnel session: tunnel gateway url must end with the sandbox instance id path segment")
	health := fetchHealthResponse(t, server)
	assertEqual(t, health["daemon_phase"].(string), "unactivated")
}

func TestServerRejectsActivationWithInvalidRuntimePlanBeforeStateInitialization(t *testing.T) {
	socketPath := shortUnixSocketPath(t)
	server, err := StartServer(socketPath)
	requireNoError(t, err)
	defer server.Close()
	waitForControlSocket(t, socketPath)
	activationInput := controlClientActivationInput()
	activationInput.RuntimePlan = []byte(`{"version":1}`)

	err = SubmitActivate(socketPath, activationInput)

	if err == nil {
		t.Fatalf("expected invalid runtime plan to fail activation")
	}
	assertEqual(t, err.Error(), "control socket returned an error: failed to initialize sandboxd state: failed to apply session input: runtime plan sandboxProfileId is required")
	health := fetchHealthResponse(t, server)
	assertEqual(t, health["daemon_phase"].(string), "unactivated")
}

func TestServerShutdownClearsFailedActivationState(t *testing.T) {
	socketPath := shortUnixSocketPath(t)
	server, err := StartServer(socketPath)
	requireNoError(t, err)
	waitForControlSocket(t, socketPath)
	_ = SubmitActivate(socketPath, controlClientActivationInput())

	requireNoError(t, SubmitShutdown(socketPath))
	requireNoError(t, server.Wait())
}

func TestServerActivatesPrematerializedSnapshotState(t *testing.T) {
	socketPath := shortUnixSocketPath(t)
	server, err := StartServer(socketPath)
	requireNoError(t, err)
	defer server.Close()
	waitForControlSocket(t, socketPath)
	activationInput := controlClientActivationInput()
	activationInput.RuntimePlan = []byte(`{
		"sandboxProfileId": "sbp_control",
		"version": 1,
		"image": {
			"source": "snapshot",
			"imageRef": "snapshot-ref"
		},
		"egressRoutes": [],
		"artifacts": [],
		"runtimeClients": []
	}`)

	requireNoError(t, SubmitActivate(socketPath, activationInput))

	health := fetchHealthResponse(t, server)
	assertEqual(t, health["daemon_phase"].(string), "activated")
	if health["init_error"] != nil {
		t.Fatalf("expected no init_error after activation, got %#v", health["init_error"])
	}
	snapshot := health["snapshot"].(map[string]any)
	components := snapshot["components"].([]any)
	firstComponent := components[0].(map[string]any)
	assertEqual(t, firstComponent["component"].(string), "sandboxd")
	assertEqual(t, firstComponent["state"].(string), "stopped")
}

func TestServerResumeReconnectsBootstrapTunnelWhenRuntimePlanIsUnchanged(t *testing.T) {
	socketPath := shortUnixSocketPath(t)
	server, err := StartServer(socketPath)
	requireNoError(t, err)
	defer server.Close()
	waitForControlSocket(t, socketPath)
	bootstrapRequests := make(chan string, 2)
	gatewayURL, closeGateway := startActivationBootstrapGateway(t, bootstrapRequests)
	defer closeGateway()
	activationInput := controlClientActivationInput()
	activationInput.TunnelGatewayWSURL = gatewayURL
	resumedActivationInput := activationInput
	resumedActivationInput.BootstrapToken = "bootstrap-token-resumed"

	requireNoError(t, SubmitActivate(socketPath, activationInput))
	requireNoError(t, SubmitActivate(socketPath, resumedActivationInput))

	assertEqual(t, receiveBootstrapRequest(t, bootstrapRequests), "bootstrap_token=bootstrap-token-value")
	assertEqual(t, receiveBootstrapRequest(t, bootstrapRequests), "bootstrap_token=bootstrap-token-resumed")
}

func TestServerServesUnactivatedHealthResponse(t *testing.T) {
	socketPath := shortUnixSocketPath(t)
	server, err := StartServerWithHealthEndpoint(socketPath, "127.0.0.1:0")
	requireNoError(t, err)
	defer server.Close()

	response, err := http.Get("http://" + server.HealthEndpointAddr() + DefaultHealthEndpointPath)

	requireNoError(t, err)
	defer response.Body.Close()
	assertEqual(t, response.StatusCode, http.StatusOK)
	var body map[string]any
	requireNoError(t, json.NewDecoder(response.Body).Decode(&body))
	assertEqual(t, body["daemon_phase"].(string), "unactivated")
	if body["observed_at"].(string) == "" {
		t.Fatalf("expected observed_at timestamp")
	}
	if body["snapshot"] != nil {
		t.Fatalf("expected nil snapshot before activation")
	}
	if body["init_error"] != nil {
		t.Fatalf("expected nil init_error before activation")
	}
}

func TestServerSigningRequiresActivation(t *testing.T) {
	socketPath := shortUnixSocketPath(t)
	server, err := StartServer(socketPath)
	requireNoError(t, err)
	defer server.Close()
	waitForControlSocket(t, socketPath)

	_, err = SubmitSigning(socketPath, SignRequest{KeyRef: "key", PayloadBase64: "cGF5bG9hZA=="})

	if err == nil {
		t.Fatalf("expected signing before activation to fail")
	}
	assertEqual(t, err.Error(), "control socket returned an error: sandbox startup request was rejected: sandboxd is not activated")
}

func TestServerSigningUsesConfiguredKeyAndBootstrapTunnel(t *testing.T) {
	socketPath := shortUnixSocketPath(t)
	server, err := StartServer(socketPath)
	requireNoError(t, err)
	defer server.Close()
	waitForControlSocket(t, socketPath)
	signingRequests := make(chan string, 2)
	gatewayURL, closeGateway := startSigningBootstrapGateway(t, signingRequests, `{"type":"signing.result","requestId":"sign_req_0","ok":true,"signature":"c2lnbmF0dXJl","encoding":"base64"}`)
	defer closeGateway()
	activationInput := signingActivationInput("key::allowed")
	activationInput.TunnelGatewayWSURL = gatewayURL
	requireNoError(t, SubmitActivate(socketPath, *activationInput))

	_, wrongKeyErr := SubmitSigning(socketPath, SignRequest{KeyRef: "key::different", PayloadBase64: "cGF5bG9hZA=="})
	signatureBase64, signingErr := SubmitSigning(socketPath, SignRequest{KeyRef: "key::allowed", PayloadBase64: "cGF5bG9hZA=="})

	if wrongKeyErr == nil {
		t.Fatalf("expected mismatched signing key to fail")
	}
	assertEqual(t, wrongKeyErr.Error(), "control socket returned an error: sandbox startup request was rejected: requested Git signing key does not match the configured Git signing identity")
	requireNoError(t, signingErr)
	assertEqual(t, signatureBase64, "c2lnbmF0dXJl")
	assertEqual(t, receiveSigningRequest(t, signingRequests), `{"type":"signing.request","requestId":"sign_req_0","organizationId":"org_123","sandboxInstanceId":"sbi_control","actingUserId":"user_123","providerFamily":"github","format":"ssh","keyRef":"key::allowed","grant":"grant","payload":"cGF5bG9hZA==","encoding":"base64"}`)
}

func TestServerSigningReturnsTunnelFailureResult(t *testing.T) {
	socketPath := shortUnixSocketPath(t)
	server, err := StartServer(socketPath)
	requireNoError(t, err)
	defer server.Close()
	waitForControlSocket(t, socketPath)
	signingRequests := make(chan string, 2)
	gatewayURL, closeGateway := startSigningBootstrapGateway(t, signingRequests, `{"type":"signing.result","requestId":"sign_req_0","ok":false,"code":"signing_backend_unavailable","message":"signing backend unavailable"}`)
	defer closeGateway()
	activationInput := signingActivationInput("key::allowed")
	activationInput.TunnelGatewayWSURL = gatewayURL
	requireNoError(t, SubmitActivate(socketPath, *activationInput))

	_, err = SubmitSigning(socketPath, SignRequest{KeyRef: "key::allowed", PayloadBase64: "cGF5bG9hZA=="})

	if err == nil {
		t.Fatalf("expected signing failure result to fail")
	}
	assertEqual(t, err.Error(), "control socket returned an error: bootstrap tunnel signing failed (signing_backend_unavailable): signing backend unavailable")
	assertEqual(t, receiveSigningRequest(t, signingRequests), `{"type":"signing.request","requestId":"sign_req_0","organizationId":"org_123","sandboxInstanceId":"sbi_control","actingUserId":"user_123","providerFamily":"github","format":"ssh","keyRef":"key::allowed","grant":"grant","payload":"cGF5bG9hZA==","encoding":"base64"}`)
}

func TestServerServesJSONNotFoundFromHealthEndpoint(t *testing.T) {
	socketPath := shortUnixSocketPath(t)
	server, err := StartServerWithHealthEndpoint(socketPath, "127.0.0.1:0")
	requireNoError(t, err)
	defer server.Close()

	response, err := http.Get("http://" + server.HealthEndpointAddr() + "/missing")

	requireNoError(t, err)
	defer response.Body.Close()
	assertEqual(t, response.StatusCode, http.StatusNotFound)
	var body map[string]string
	requireNoError(t, json.NewDecoder(response.Body).Decode(&body))
	assertEqual(t, body["error"], "not_found")
}

func TestServerReturnsProtocolErrorForInvalidRequestPayload(t *testing.T) {
	socketPath := shortUnixSocketPath(t)
	server, err := StartServer(socketPath)
	requireNoError(t, err)
	defer server.Close()
	waitForControlSocket(t, socketPath)
	connection, err := net.Dial("unix", socketPath)
	requireNoError(t, err)
	_, err = connection.Write([]byte(`{"type":"ready","activationInput":{}}`))
	requireNoError(t, err)
	if unixConnection, ok := connection.(*net.UnixConn); ok {
		requireNoError(t, unixConnection.CloseWrite())
	}

	responseBytes, err := io.ReadAll(connection)

	requireNoError(t, err)
	var response Response
	requireNoError(t, json.Unmarshal(responseBytes, &response))
	assertEqual(t, response.OK, false)
	if response.Error == nil || !strings.Contains(*response.Error, "control ready request must not include a payload") {
		t.Fatalf("expected protocol error response, got %s", string(responseBytes))
	}
	requireNoError(t, connection.Close())
}

func TestStartServerRejectsExistingNonSocketPath(t *testing.T) {
	socketPath := shortUnixSocketPath(t)
	requireNoError(t, os.WriteFile(socketPath, []byte("not a socket"), 0o600))

	_, err := StartServer(socketPath)

	if err == nil {
		t.Fatalf("expected existing non-socket path to fail")
	}
	if !strings.Contains(err.Error(), "already exists and is not a unix socket") {
		t.Fatalf("expected existing non-socket error, got %q", err.Error())
	}
}

func waitForControlSocket(t *testing.T, socketPath string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		if metadata, err := os.Lstat(socketPath); err == nil && metadata.Mode()&os.ModeSocket != 0 {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("control socket %s was not created", socketPath)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func fetchHealthResponse(t *testing.T, server *Server) map[string]any {
	t.Helper()
	response, err := http.Get("http://" + server.HealthEndpointAddr() + DefaultHealthEndpointPath)
	requireNoError(t, err)
	defer response.Body.Close()
	var body map[string]any
	requireNoError(t, json.NewDecoder(response.Body).Decode(&body))
	return body
}

func signingActivationInput(keyRef string) *protocol.ActivationInput {
	input := controlClientActivationInput()
	input.GitIdentity = &protocol.GitIdentity{
		Name:  "Mistle",
		Email: "mistle@example.test",
		Signing: &protocol.GitSigningConfig{
			Format:         "ssh",
			Program:        "mistle-ssh-sign",
			KeyRef:         keyRef,
			OrganizationID: "org_123",
			ProviderFamily: "github",
			ActingUserID:   "user_123",
			Grant:          "grant",
		},
	}
	return &input
}

func startActivationBootstrapGateway(t *testing.T, bootstrapRequests chan<- string) (string, func()) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		connection, err := websocket.Accept(responseWriter, request, nil)
		if err != nil {
			return
		}
		defer connection.Close(websocket.StatusNormalClosure, "")
		bootstrapRequests <- request.URL.RawQuery
		_, _, _ = connection.Read(request.Context())
	}))
	return "ws" + strings.TrimPrefix(server.URL, "http") + "/bootstrap/sbi_control", server.Close
}

func receiveBootstrapRequest(t *testing.T, bootstrapRequests <-chan string) string {
	t.Helper()
	select {
	case request := <-bootstrapRequests:
		return request
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for bootstrap request")
		return ""
	}
}

func startSigningBootstrapGateway(t *testing.T, signingRequests chan<- string, signingResponse string) (string, func()) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		connection, err := websocket.Accept(responseWriter, request, nil)
		if err != nil {
			return
		}
		defer connection.Close(websocket.StatusNormalClosure, "")
		_, payload, err := connection.Read(request.Context())
		if err != nil {
			return
		}
		signingRequests <- string(payload)
		if err := connection.Write(request.Context(), websocket.MessageText, []byte(signingResponse)); err != nil {
			signingRequests <- "write error: " + err.Error()
		}
	}))
	return "ws" + strings.TrimPrefix(server.URL, "http") + "/bootstrap/sbi_control", server.Close
}

func receiveSigningRequest(t *testing.T, signingRequests <-chan string) string {
	t.Helper()
	select {
	case request := <-signingRequests:
		return request
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for signing request")
		return ""
	}
}
