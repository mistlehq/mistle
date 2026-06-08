package piproxy

import (
	"bytes"
	"encoding/json"
	"fmt"
)

type jsonRPCRequest struct {
	ID          any             `json:"id"`
	Method      string          `json:"method"`
	Params      map[string]any  `json:"params"`
	Idempotency json.RawMessage `json:"idempotency"`
}

type jsonRPCError struct {
	Code    int64  `json:"code"`
	Message string `json:"message"`
}

func HandleJSONRPCRequest(state *State, payload []byte) [][]byte {
	request, err := decodeJSONRPCRequest(payload)
	if err != nil {
		return [][]byte{renderJSONRPCError(request.ID, -32700, fmt.Sprintf("Invalid JSON-RPC request: %v", err))}
	}
	idempotencyAction := prepareIdempotency(request, state.idempotencyStore)
	switch idempotencyAction.kind {
	case idempotencyActionDisabled:
	case idempotencyActionForward:
	case idempotencyActionReplay:
		payload := idempotencyAction.replay.Payload
		payload["id"] = request.ID
		return [][]byte{mustMarshalJSON(payload)}
	case idempotencyActionReject:
		return [][]byte{renderJSONRPCError(request.ID, -32001, idempotencyAction.message)}
	default:
		return [][]byte{renderJSONRPCError(request.ID, -32001, fmt.Sprintf("unsupported Pi idempotency action %q", idempotencyAction.kind))}
	}
	var capturedEvents []map[string]any
	result, err := handlePiMethod(state, request, &capturedEvents)
	if err != nil {
		response := jsonRPCErrorPayload(request.ID, -32000, err.Error())
		if idempotencyAction.started != nil {
			if completeErr := completeIdempotency(state.idempotencyStore, *idempotencyAction.started, StoredResponse{Payload: response}); completeErr != nil {
				return [][]byte{renderJSONRPCError(nil, -32000, completeErr.Error())}
			}
		}
		return [][]byte{mustMarshalJSON(response)}
	}
	responses := make([][]byte, 0, len(capturedEvents)+1)
	for _, event := range capturedEvents {
		responses = append(responses, RenderPiEventJSONRPCNotification(event))
	}
	response := jsonRPCSuccessPayload(request.ID, result)
	if idempotencyAction.started != nil {
		if err := completeIdempotency(state.idempotencyStore, *idempotencyAction.started, StoredResponse{Payload: response}); err != nil {
			responses = append(responses, renderJSONRPCError(nil, -32000, err.Error()))
			return responses
		}
	}
	responses = append(responses, mustMarshalJSON(response))
	return responses
}

func decodeJSONRPCRequest(payload []byte) (jsonRPCRequest, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(payload, &raw); err != nil {
		return jsonRPCRequest{}, err
	}
	request := jsonRPCRequest{Params: nil}
	if rawID, ok := raw["id"]; ok {
		if err := json.Unmarshal(rawID, &request.ID); err != nil {
			return request, err
		}
	} else {
		return request, fmt.Errorf("missing field `id`")
	}
	rawMethod, ok := raw["method"]
	if !ok {
		return request, fmt.Errorf("missing field `method`")
	}
	if err := json.Unmarshal(rawMethod, &request.Method); err != nil {
		return request, err
	}
	if rawParams, ok := raw["params"]; ok && !bytes.Equal(bytes.TrimSpace(rawParams), []byte("null")) {
		var paramsValue any
		if err := json.Unmarshal(rawParams, &paramsValue); err != nil {
			return request, err
		}
		if params, ok := paramsValue.(map[string]any); ok {
			request.Params = params
		}
	}
	if rawIdempotency, ok := raw["idempotency"]; ok {
		request.Idempotency = append(json.RawMessage(nil), rawIdempotency...)
	}
	return request, nil
}

func decodeStrictPiIdempotency(payload []byte, target *Idempotency) error {
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	return decoder.Decode(target)
}

func RenderPiEventJSONRPCNotification(event map[string]any) []byte {
	return mustMarshalJSON(map[string]any{
		"jsonrpc": "2.0",
		"method":  "pi/event",
		"params":  event,
	})
}

func renderJSONRPCSuccess(id any, result any) []byte {
	return mustMarshalJSON(jsonRPCSuccessPayload(id, result))
}

func jsonRPCSuccessPayload(id any, result any) map[string]any {
	return map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"result":  result,
	}
}

func renderJSONRPCError(id any, code int64, message string) []byte {
	return mustMarshalJSON(jsonRPCErrorPayload(id, code, message))
}

func jsonRPCErrorPayload(id any, code int64, message string) map[string]any {
	return map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"error": jsonRPCError{
			Code:    code,
			Message: message,
		},
	}
}

func handlePiMethod(state *State, request jsonRPCRequest, capturedEvents *[]map[string]any) (any, error) {
	switch request.Method {
	case "pi/createConversation":
		cwd := optionalStringParam(request.Params, "cwd")
		if err := state.EnsureChild(cwd); err != nil {
			return nil, err
		}
		if _, err := state.SendCommandWithCapturedEvents(map[string]any{"type": "new_session"}, capturedEvents); err != nil {
			return nil, err
		}
		stateValue, err := state.SendCommandWithCapturedEvents(map[string]any{"type": "get_state"}, capturedEvents)
		if err != nil {
			return nil, err
		}
		sessionFile, err := readSessionFileFromState(stateValue)
		if err != nil {
			return nil, err
		}
		providerConversationID, ok := stateValue["sessionId"].(string)
		if !ok || providerConversationID == "" {
			return nil, fmt.Errorf("Pi did not report sessionId")
		}
		return map[string]any{
			"providerConversationId": providerConversationID,
			"sessionFile":            sessionFile,
		}, nil
	case "pi/findRecentConversation":
		conversation, err := FindRecentConversation(state.config.Env, optionalStringParam(request.Params, "cwd"))
		if err != nil {
			return nil, err
		}
		if conversation == nil {
			return map[string]any{"providerConversationId": nil}, nil
		}
		return map[string]any{"providerConversationId": conversation.ID}, nil
	case "pi/listConversations":
		limit, err := requiredIntParam(request.Params, "limit")
		if err != nil {
			return nil, err
		}
		return ListConversations(state.config.Env, optionalStringParam(request.Params, "cwd"), limit)
	case "pi/resolveConversation":
		providerConversationID, err := requiredStringParam(request.Params, "providerConversationId")
		if err != nil {
			return nil, err
		}
		conversation, err := FindConversationByID(state.config.Env, providerConversationID)
		if err != nil {
			return nil, err
		}
		return map[string]any{"sessionFile": conversation.Path}, nil
	case "pi/getState":
		if err := state.EnsureChild(nil); err != nil {
			return nil, err
		}
		if sessionFile := optionalStringParam(request.Params, "sessionFile"); sessionFile != nil {
			if err := state.SwitchSession(*sessionFile, capturedEvents); err != nil {
				return nil, err
			}
		}
		return state.SendCommandWithCapturedEvents(map[string]any{"type": "get_state"}, capturedEvents)
	case "pi/getAvailableModels":
		sessionFile, err := requiredStringParam(request.Params, "sessionFile")
		if err != nil {
			return nil, err
		}
		if err := state.EnsureChild(nil); err != nil {
			return nil, err
		}
		if err := state.SwitchSession(sessionFile, capturedEvents); err != nil {
			return nil, err
		}
		return state.SendCommandWithCapturedEvents(map[string]any{"type": "get_available_models"}, capturedEvents)
	case "pi/readMetadata":
		sessionFile, err := requiredStringParam(request.Params, "sessionFile")
		if err != nil {
			return nil, err
		}
		if err := state.EnsureChild(nil); err != nil {
			return nil, err
		}
		if err := state.SwitchSession(sessionFile, capturedEvents); err != nil {
			return nil, err
		}
		stateValue, err := state.SendCommandWithCapturedEvents(map[string]any{"type": "get_state"}, capturedEvents)
		if err != nil {
			return nil, err
		}
		return map[string]any{"name": stateValue["sessionName"], "preview": nil}, nil
	case "pi/getMessages":
		sessionFile, err := requiredStringParam(request.Params, "sessionFile")
		if err != nil {
			return nil, err
		}
		if err := state.EnsureChild(nil); err != nil {
			return nil, err
		}
		if err := state.SwitchSession(sessionFile, capturedEvents); err != nil {
			return nil, err
		}
		return state.SendCommandWithCapturedEvents(map[string]any{"type": "get_messages"}, capturedEvents)
	case "pi/resumeConversation":
		providerConversationID, err := requiredStringParam(request.Params, "providerConversationId")
		if err != nil {
			return nil, err
		}
		conversation, err := FindConversationByID(state.config.Env, providerConversationID)
		if err != nil {
			return nil, err
		}
		if err := state.EnsureChild(nil); err != nil {
			return nil, err
		}
		if err := state.SwitchSession(conversation.Path, capturedEvents); err != nil {
			return nil, err
		}
		state.MarkActiveAndStartActivityMonitor()
		return map[string]any{"sessionFile": conversation.Path}, nil
	case "pi/setModel":
		return stateCommandWithSession(state, request.Params, capturedEvents, "set_model", map[string]string{"provider": "provider", "modelId": "modelId"})
	case "pi/setThinkingLevel":
		return stateCommandWithSession(state, request.Params, capturedEvents, "set_thinking_level", map[string]string{"level": "level"})
	case "pi/setSessionName":
		return stateCommandWithSession(state, request.Params, capturedEvents, "set_session_name", map[string]string{"name": "name"})
	case "pi/prompt":
		return stateCommandWithSession(state, request.Params, capturedEvents, "prompt", map[string]string{"message": "message"})
	case "pi/steer":
		return stateCommandWithSession(state, request.Params, capturedEvents, "steer", map[string]string{"message": "message"})
	case "pi/followUp":
		return stateCommandWithSession(state, request.Params, capturedEvents, "follow_up", map[string]string{"message": "message"})
	case "pi/abort":
		return stateCommandWithSession(state, request.Params, capturedEvents, "abort", nil)
	default:
		return nil, fmt.Errorf("unsupported Pi method %q", request.Method)
	}
}

func stateCommandWithSession(
	state *State,
	params map[string]any,
	capturedEvents *[]map[string]any,
	commandType string,
	paramMappings map[string]string,
) (any, error) {
	sessionFile, err := requiredStringParam(params, "sessionFile")
	if err != nil {
		return nil, err
	}
	if err := state.EnsureChild(nil); err != nil {
		return nil, err
	}
	if err := state.SwitchSession(sessionFile, capturedEvents); err != nil {
		return nil, err
	}
	command := map[string]any{"type": commandType}
	for commandKey, paramKey := range paramMappings {
		value, err := requiredStringParam(params, paramKey)
		if err != nil {
			return nil, err
		}
		command[commandKey] = value
	}
	result, err := state.SendCommandWithCapturedEvents(command, capturedEvents)
	if err == nil && (commandType == "prompt" || commandType == "steer" || commandType == "follow_up") {
		state.MarkActiveAndStartActivityMonitor()
	}
	return result, err
}

func optionalStringParam(params map[string]any, key string) *string {
	if params == nil {
		return nil
	}
	value, ok := params[key].(string)
	if !ok {
		return nil
	}
	return &value
}

func requiredStringParam(params map[string]any, key string) (string, error) {
	value := optionalStringParam(params, key)
	if value == nil {
		return "", fmt.Errorf("missing required parameter %q", key)
	}
	return *value, nil
}

func requiredIntParam(params map[string]any, key string) (int, error) {
	if params == nil {
		return 0, fmt.Errorf("missing required parameter %q", key)
	}
	value, ok := params[key].(float64)
	if !ok {
		return 0, fmt.Errorf("missing required parameter %q", key)
	}
	return int(value), nil
}

func readSessionFileFromState(stateValue map[string]any) (string, error) {
	sessionFile, ok := stateValue["sessionFile"].(string)
	if !ok || sessionFile == "" {
		return "", fmt.Errorf("Pi did not report sessionFile")
	}
	return sessionFile, nil
}

func mustMarshalJSON(value any) []byte {
	serialized, err := json.Marshal(value)
	if err != nil {
		return []byte(`{"jsonrpc":"2.0","id":null,"error":{"code":-32000,"message":"failed to serialize response"}}`)
	}
	return serialized
}
