package sessionprotocol

import (
	"encoding/json"
	"testing"
)

func TestLeaseCreateJSON(t *testing.T) {
	payload, err := json.Marshal(LeaseCreate{
		Type: MessageTypeLeaseCreate,
		Lease: ExecutionLease{
			ID:                  "sxl_123",
			Kind:                "agent_execution",
			Source:              "codex",
			ExternalExecutionID: "turn_123",
			Metadata: map[string]any{
				"threadId": "thr_123",
			},
		},
	})
	if err != nil {
		t.Fatalf("expected lease.create marshal to succeed: %v", err)
	}

	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatalf("expected lease.create unmarshal to succeed: %v", err)
	}

	if decoded["type"] != MessageTypeLeaseCreate {
		t.Fatalf("expected lease.create type %q, got %v", MessageTypeLeaseCreate, decoded["type"])
	}
}

func TestLeaseRenewJSON(t *testing.T) {
	payload, err := json.Marshal(LeaseRenew{
		Type:    MessageTypeLeaseRenew,
		LeaseID: "sxl_123",
	})
	if err != nil {
		t.Fatalf("expected lease.renew marshal to succeed: %v", err)
	}

	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatalf("expected lease.renew unmarshal to succeed: %v", err)
	}

	if decoded["type"] != MessageTypeLeaseRenew {
		t.Fatalf("expected lease.renew type %q, got %v", MessageTypeLeaseRenew, decoded["type"])
	}
	if decoded["leaseId"] != "sxl_123" {
		t.Fatalf("expected lease.renew leaseId %q, got %v", "sxl_123", decoded["leaseId"])
	}
}
