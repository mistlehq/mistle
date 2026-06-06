package protocol

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDecodeActivationInputFixture(t *testing.T) {
	fixture := readContractFixture(t, "activation-input.valid.json")

	input, err := DecodeActivationInput(fixture)
	requireNoError(t, err)

	assertEqual(t, input.BootstrapToken, "bootstrap-token-value")
	assertEqual(t, input.TunnelExchangeToken, "tunnel-exchange-token-value")
	assertEqual(t, input.TunnelGatewayWSURL, "ws://127.0.0.1:5003/tunnel/sandbox")
}

func TestDecodeActivationInputRejectsLegacyFields(t *testing.T) {
	_, err := DecodeActivationInput([]byte(`{"startupMode":"new","operationKind":"start","bootstrapToken":"bootstrap-token","tunnelExchangeToken":"exchange-token","tunnelGatewayWsUrl":"ws://127.0.0.1/tunnel","runtimePlan":{"version":1},"actingUserId":null,"gitIdentity":null}`))
	if err == nil {
		t.Fatalf("expected legacy startupMode to fail")
	}
}

func TestSessionRuntimeInputFromActivationInputCopiesSharedFields(t *testing.T) {
	fixture := readContractFixture(t, "activation-input.valid.json")
	activationInput, err := DecodeActivationInput(fixture)
	requireNoError(t, err)

	sessionInput := SessionRuntimeInputFromActivationInput(activationInput)

	assertEqual(t, sessionInput.OperationKind, ActivationOperationStart)
	assertEqual(t, sessionInput.BootstrapToken, "bootstrap-token-value")
	assertEqual(t, sessionInput.TunnelExchangeToken, "tunnel-exchange-token-value")
	assertEqual(t, sessionInput.TunnelGatewayWSURL, "ws://127.0.0.1:5003/tunnel/sandbox")
	if len(sessionInput.RuntimePlan) == 0 {
		t.Fatalf("expected runtime plan to be copied")
	}
}

func TestDecodeActivationResponse(t *testing.T) {
	ok, err := DecodeActivationResponse([]byte(`{"ok":true}`))
	requireNoError(t, err)
	assertEqual(t, ok.OK, true)
	assertEqual(t, ok.Error, "")

	failure, err := DecodeActivationResponse([]byte(`{"ok":false,"error":"sandbox activation failed"}`))
	requireNoError(t, err)
	assertEqual(t, failure.OK, false)
	assertEqual(t, failure.Error, "sandbox activation failed")
}

func TestDecodeActivationResponseRejectsInvalidDiscriminants(t *testing.T) {
	for _, input := range [][]byte{
		[]byte(`{"ok":false}`),
		[]byte(`{"ok":true,"error":"sandbox activation failed"}`),
		[]byte(`{"ok":false,"error":""}`),
	} {
		_, err := DecodeActivationResponse(input)
		if err == nil {
			t.Fatalf("expected activation response %s to fail", string(input))
		}
	}
}

func TestDecodeKeepaliveStateFixture(t *testing.T) {
	fixture := readContractFixture(t, "keepalive-state.valid.json")

	state, err := DecodeKeepaliveState(fixture)
	requireNoError(t, err)

	assertEqual(t, state.MessageType, KeepaliveMessageState)
	assertEqual(t, state.Active, true)
	assertEqual(t, state.TTLMS, uint64(30000))
}

func TestDecodeRuntimeStateFixture(t *testing.T) {
	fixture := readContractFixture(t, "runtime-state.valid.json")

	snapshot, err := DecodeRuntimeStateSnapshot(fixture)
	requireNoError(t, err)

	if snapshot.OwnerLeaseID == nil {
		t.Fatalf("expected owner lease id")
	}
	assertEqual(t, *snapshot.OwnerLeaseID, "owner_123")
	assertEqual(t, snapshot.Presence.ActiveCount, uint64(1))
	assertEqual(t, snapshot.Keepalive.Active, true)
	assertEqual(t, snapshot.Runtime.Ready, true)
	if snapshot.Attachment == nil {
		t.Fatalf("expected attachment")
	}
	assertEqual(t, snapshot.Attachment.SandboxInstanceID, "sbi_123")
	assertEqual(t, snapshot.Attachment.OwnerLeaseID, "owner_123")
	assertEqual(t, snapshot.Attachment.NodeID, "node_123")
	assertEqual(t, snapshot.Attachment.SessionID, "session_123")
	assertEqual(t, snapshot.Attachment.AttachedAtMS, uint64(1730910000))
}

func readContractFixture(t *testing.T, name string) []byte {
	t.Helper()
	path := filepath.Join("..", "..", "sandbox-runtime-contract", "tests", "fixtures", name)
	contents, err := os.ReadFile(path)
	requireNoError(t, err)
	return contents
}

func requireNoError(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
}

func assertEqual[T comparable](t *testing.T, actual T, expected T) {
	t.Helper()
	if actual != expected {
		t.Fatalf("expected %v, got %v", expected, actual)
	}
}
