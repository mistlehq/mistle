package control

import (
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

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

func TestServerRecordsFailedActivationWhenStateInitializationIsNotMigrated(t *testing.T) {
	socketPath := shortUnixSocketPath(t)
	server, err := StartServer(socketPath)
	requireNoError(t, err)
	defer server.Close()
	waitForControlSocket(t, socketPath)

	err = SubmitActivate(socketPath, controlClientActivationInput())

	if err == nil {
		t.Fatalf("expected activation to fail before daemon state initialization is migrated")
	}
	assertEqual(t, err.Error(), "control socket returned an error: sandbox startup request was rejected: sandboxd activation failed: failed to initialize sandboxd state: sandboxd state initialization is not migrated to Go")
	health := fetchHealthResponse(t, server)
	assertEqual(t, health["daemon_phase"].(string), "failed")
	assertEqual(t, health["init_error"].(string), "failed to initialize sandboxd state: sandboxd state initialization is not migrated to Go")
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
	assertEqual(t, secondErr.Error(), "control socket returned an error: sandbox startup request was rejected: sandboxd activation already failed: failed to initialize sandboxd state: sandboxd state initialization is not migrated to Go")
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

func TestServerSigningValidatesConfiguredKeyBeforeTunnelSigningIsMigrated(t *testing.T) {
	socketPath := shortUnixSocketPath(t)
	server, err := StartServer(socketPath)
	requireNoError(t, err)
	defer server.Close()
	waitForControlSocket(t, socketPath)
	server.state.mutex.Lock()
	server.state.phase = ActivationPhaseActivated
	server.state.activationInput = signingActivationInput("key::allowed")
	server.state.mutex.Unlock()

	_, wrongKeyErr := SubmitSigning(socketPath, SignRequest{KeyRef: "key::different", PayloadBase64: "cGF5bG9hZA=="})
	tunnelPayload, payloadErr := server.buildSigningTunnelRequestPayload(SignRequest{KeyRef: "key::allowed", PayloadBase64: "cGF5bG9hZA=="})
	_, migratedErr := SubmitSigning(socketPath, SignRequest{KeyRef: "key::allowed", PayloadBase64: "cGF5bG9hZA=="})

	if wrongKeyErr == nil {
		t.Fatalf("expected mismatched signing key to fail")
	}
	assertEqual(t, wrongKeyErr.Error(), "control socket returned an error: sandbox startup request was rejected: requested Git signing key does not match the configured Git signing identity")
	requireNoError(t, payloadErr)
	assertEqual(t, tunnelPayload, `{"type":"signing.request","requestId":"sign_req_0","organizationId":"org_123","sandboxInstanceId":"sbi_control","actingUserId":"user_123","providerFamily":"github","format":"ssh","keyRef":"key::allowed","grant":"grant","payload":"cGF5bG9hZA==","encoding":"base64"}`)
	if migratedErr == nil {
		t.Fatalf("expected tunnel signing migration error")
	}
	assertEqual(t, migratedErr.Error(), "control socket returned an error: sandbox startup request was rejected: sandboxd signing tunnel session is not migrated to Go")
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
