package egressproxy

import (
	"net"
	"os"
	"strings"
	"syscall"
	"testing"

	tunnelprotocol "github.com/mistle/sandboxd/tunnel/protocol"
)

func TestEgressTokenBridgeClientRequestsTokenOverInheritedUnixSocket(t *testing.T) {
	parent, childFD := newTokenBridgePair(t)
	defer parent.Close()
	client, err := NewEgressTokenBridgeClientFromFD(childFD)
	requireNoError(t, err)
	defer client.Close()
	done := make(chan struct{})
	go func() {
		defer close(done)
		request, err := readTokenBridgeJSONLine[egressTokenBridgeRequest](parent)
		if err != nil {
			t.Errorf("expected token bridge request, got %v", err)
			return
		}
		assertEqual(t, request.Type, "egressToken.request")
		if request.RequestID == "" {
			t.Errorf("expected token bridge request id")
			return
		}
		err = writeTokenBridgeJSONLine(parent, egressTokenBridgeResponse{
			Type:      "egressToken.response",
			RequestID: request.RequestID,
			Token:     "jwt-token",
			ExpiresAt: "2026-05-17T00:05:00Z",
			TTLMS:     300000,
		})
		if err != nil {
			t.Errorf("expected token bridge response write, got %v", err)
		}
	}()

	token, err := client.Token()

	requireNoError(t, err)
	assertEqual(t, token.Token, "jwt-token")
	assertEqual(t, token.ExpiresAt, "2026-05-17T00:05:00Z")
	assertEqual(t, token.TTLMS, uint64(300000))
	<-done
}

func TestEgressTokenBridgeClientRejectsMismatchedResponseID(t *testing.T) {
	parent, childFD := newTokenBridgePair(t)
	defer parent.Close()
	client, err := NewEgressTokenBridgeClientFromFD(childFD)
	requireNoError(t, err)
	defer client.Close()
	done := make(chan struct{})
	go func() {
		defer close(done)
		_, err := readTokenBridgeJSONLine[egressTokenBridgeRequest](parent)
		if err != nil {
			t.Errorf("expected token bridge request, got %v", err)
			return
		}
		err = writeTokenBridgeJSONLine(parent, egressTokenBridgeResponse{
			Type:      "egressToken.response",
			RequestID: "different",
			Token:     "jwt-token",
		})
		if err != nil {
			t.Errorf("expected token bridge response write, got %v", err)
		}
	}()

	_, err = client.Token()

	if err == nil {
		t.Fatalf("expected mismatched response id to fail")
	}
	if !strings.Contains(err.Error(), "egress token bridge response id mismatch") {
		t.Fatalf("expected response id mismatch error, got %q", err.Error())
	}
	<-done
}

func TestEgressTokenBridgeServerPreservesProviderTokenMetadata(t *testing.T) {
	parent, childFD := newTokenBridgePair(t)
	defer parent.Close()
	child := os.NewFile(uintptr(childFD), "token bridge child")
	requireNoError(t, syscall.SetNonblock(childFD, false))
	childConnection, err := net.FileConn(child)
	requireNoError(t, err)
	requireNoError(t, child.Close())
	defer childConnection.Close()
	server, err := StartEgressTokenBridgeServer(childConnection, metadataTokenProvider{
		token: tunnelprotocol.EgressToken{
			Token:     "jwt-token",
			ExpiresAt: "2026-05-17T00:05:00Z",
			TTLMS:     300000,
		},
	})
	requireNoError(t, err)
	defer server.Close()
	requireNoError(t, writeTokenBridgeJSONLine(parent, egressTokenBridgeRequest{
		Type:      "egressToken.request",
		RequestID: "req_123",
	}))

	response, err := readTokenBridgeJSONLine[egressTokenBridgeResponse](parent)

	requireNoError(t, err)
	assertEqual(t, response.Type, "egressToken.response")
	assertEqual(t, response.RequestID, "req_123")
	assertEqual(t, response.Token, "jwt-token")
	assertEqual(t, response.ExpiresAt, "2026-05-17T00:05:00Z")
	assertEqual(t, response.TTLMS, uint64(300000))
}

type metadataTokenProvider struct {
	token tunnelprotocol.EgressToken
}

func (provider metadataTokenProvider) Token() (tunnelprotocol.EgressToken, error) {
	return provider.token, nil
}

func TestReadTokenBridgeJSONLineRejectsOversizedFrames(t *testing.T) {
	_, err := readTokenBridgeJSONLine[egressTokenBridgeRequest](strings.NewReader(strings.Repeat("x", EgressTokenBridgeMaxFrameBytes+1)))

	if err == nil {
		t.Fatalf("expected oversized token bridge frame to fail")
	}
	assertEqual(t, err.Error(), "egress token bridge frame exceeds 65536 bytes")
}

func newTokenBridgePair(t *testing.T) (*os.File, int) {
	t.Helper()
	fds, err := syscall.Socketpair(syscall.AF_UNIX, syscall.SOCK_STREAM, 0)
	requireNoError(t, err)
	parent := os.NewFile(uintptr(fds[0]), "token bridge parent")
	if parent == nil {
		t.Fatalf("expected token bridge parent file")
	}
	return parent, fds[1]
}
