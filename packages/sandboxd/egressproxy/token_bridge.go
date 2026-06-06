package egressproxy

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"sync"
	"sync/atomic"
)

const EgressTokenBridgeMaxFrameBytes = 64 * 1024

type EgressTokenBridgeClient struct {
	connection    net.Conn
	mutex         sync.Mutex
	nextRequestID atomic.Uint64
}

type egressTokenBridgeRequest struct {
	Type      string `json:"type"`
	RequestID string `json:"requestId"`
}

type egressTokenBridgeResponse struct {
	Type      string `json:"type"`
	RequestID string `json:"requestId"`
	Token     string `json:"token,omitempty"`
	ExpiresAt string `json:"expiresAt,omitempty"`
	TTLMS     uint64 `json:"ttlMs,omitempty"`
	Message   string `json:"message,omitempty"`
}

func NewEgressTokenBridgeClientFromFD(fd int) (*EgressTokenBridgeClient, error) {
	if fd < 0 {
		return nil, fmt.Errorf("egress token bridge fd must be non-negative")
	}
	file := os.NewFile(uintptr(fd), "egress token bridge")
	if file == nil {
		return nil, fmt.Errorf("failed to read inherited egress token bridge fd %d: invalid file descriptor", fd)
	}
	connection, err := net.FileConn(file)
	if closeErr := file.Close(); closeErr != nil && err == nil {
		return nil, fmt.Errorf("failed to close inherited egress token bridge fd wrapper %d: %w", fd, closeErr)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to open inherited egress token bridge fd %d: %w", fd, err)
	}
	return &EgressTokenBridgeClient{
		connection: connection,
	}, nil
}

func (client *EgressTokenBridgeClient) Token() (string, error) {
	if client == nil {
		return "", fmt.Errorf("egress token bridge client is required")
	}
	requestID := fmt.Sprintf("egress_token_bridge_req_%d", client.nextRequestID.Add(1))
	request := egressTokenBridgeRequest{
		Type:      "egressToken.request",
		RequestID: requestID,
	}

	client.mutex.Lock()
	defer client.mutex.Unlock()

	if err := writeTokenBridgeJSONLine(client.connection, request); err != nil {
		return "", err
	}
	response, err := readTokenBridgeJSONLine[egressTokenBridgeResponse](client.connection)
	if err != nil {
		return "", err
	}
	if response.RequestID != requestID {
		return "", fmt.Errorf("egress token bridge response id mismatch: expected %s, got %s", requestID, response.RequestID)
	}
	switch response.Type {
	case "egressToken.response":
		if response.Token == "" {
			return "", fmt.Errorf("egress token bridge response token is required")
		}
		return response.Token, nil
	case "egressToken.error":
		if response.Message == "" {
			return "", fmt.Errorf("egress token bridge error message is required")
		}
		return "", fmt.Errorf("%s", response.Message)
	default:
		return "", fmt.Errorf("egress token bridge response type is invalid: %s", response.Type)
	}
}

func (client *EgressTokenBridgeClient) Close() error {
	if client == nil || client.connection == nil {
		return nil
	}
	return client.connection.Close()
}

func writeTokenBridgeJSONLine[T any](writer io.Writer, payload T) error {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to write token bridge json: %w", err)
	}
	if _, err := writer.Write(append(encoded, '\n')); err != nil {
		return fmt.Errorf("failed to write token bridge stream: %w", err)
	}
	return nil
}

func readTokenBridgeJSONLine[T any](reader io.Reader) (T, error) {
	bufferedReader := bufio.NewReader(reader)
	line := make([]byte, 0)
	for {
		nextByte, err := bufferedReader.ReadByte()
		if err != nil {
			var zero T
			if err == io.EOF && len(line) == 0 {
				return zero, fmt.Errorf("egress token bridge stream closed")
			}
			if err == io.EOF {
				return zero, fmt.Errorf("egress token bridge stream closed mid-message")
			}
			return zero, fmt.Errorf("failed to read token bridge stream: %w", err)
		}
		if nextByte == '\n' {
			break
		}
		if len(line) >= EgressTokenBridgeMaxFrameBytes {
			var zero T
			return zero, fmt.Errorf("egress token bridge frame exceeds %d bytes", EgressTokenBridgeMaxFrameBytes)
		}
		line = append(line, nextByte)
	}
	var payload T
	if err := json.Unmarshal(line, &payload); err != nil {
		return payload, fmt.Errorf("failed to parse token bridge json: %w", err)
	}
	return payload, nil
}
