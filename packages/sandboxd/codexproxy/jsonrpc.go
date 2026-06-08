package codexproxy

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/coder/websocket"
)

const (
	InitializeClientName    = "codex_cli_rs"
	InitializeClientTitle   = "Mistle sandboxd Codex session manager"
	InitializeClientVersion = "0.0.0"
	MistleAgentClientTitle  = "Mistle Agent Client"
)

func SendJSON(ctx context.Context, connection *websocket.Conn, payload map[string]any) error {
	serialized, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to serialize Codex JSON-RPC payload: %w", err)
	}
	if err := connection.Write(ctx, websocket.MessageText, serialized); err != nil {
		return fmt.Errorf("failed to write Codex JSON-RPC payload: %w", err)
	}
	return nil
}

func ReadJSONObject(ctx context.Context, connection *websocket.Conn) (map[string]any, []byte, error) {
	messageType, payload, err := connection.Read(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to read Codex JSON-RPC payload: %w", err)
	}
	if messageType != websocket.MessageText {
		return nil, nil, fmt.Errorf("Codex JSON-RPC payload must be text, got %s", messageType.String())
	}
	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return nil, nil, fmt.Errorf("Codex JSON-RPC payload was not JSON: %w", err)
	}
	return decoded, payload, nil
}

func JSONRPCIDKey(value any) (string, bool) {
	switch typed := value.(type) {
	case string:
		return "s:" + typed, true
	case float64:
		if typed != float64(int64(typed)) {
			return "", false
		}
		return fmt.Sprintf("n:%d", int64(typed)), true
	case nil:
		return "", false
	default:
		return "", false
	}
}

func ResponseMatchesID(response map[string]any, requestID int64) bool {
	responseID, ok := response["id"].(float64)
	return ok && int64(responseID) == requestID && responseID == float64(requestID)
}

func ResponseErrorMessage(response map[string]any) (string, bool) {
	errorValue, ok := response["error"].(map[string]any)
	if !ok {
		return "", false
	}
	message, ok := errorValue["message"].(string)
	return message, ok
}
