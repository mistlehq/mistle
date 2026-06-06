package protocol

type RuntimeAttachment struct {
	SandboxInstanceID string `json:"sandboxInstanceId"`
	OwnerLeaseID      string `json:"ownerLeaseId"`
	NodeID            string `json:"nodeId"`
	SessionID         string `json:"sessionId"`
	AttachedAtMS      uint64 `json:"attachedAtMs"`
}

type RuntimePresenceSummary struct {
	ActiveCount uint64 `json:"activeCount"`
}

type RuntimeKeepaliveSummary struct {
	Active bool `json:"active"`
}

type RuntimeSummary struct {
	Ready bool `json:"ready"`
}

type RuntimeStateSnapshot struct {
	OwnerLeaseID *string                 `json:"ownerLeaseId"`
	Attachment   *RuntimeAttachment      `json:"attachment"`
	Presence     RuntimePresenceSummary  `json:"presence"`
	Keepalive    RuntimeKeepaliveSummary `json:"keepalive"`
	Runtime      RuntimeSummary          `json:"runtime"`
}

func DecodeRuntimeStateSnapshot(data []byte) (RuntimeStateSnapshot, error) {
	var snapshot RuntimeStateSnapshot
	if err := decodeStrict(data, &snapshot); err != nil {
		return RuntimeStateSnapshot{}, err
	}
	return snapshot, nil
}
