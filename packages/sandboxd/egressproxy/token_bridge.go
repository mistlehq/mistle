package egressproxy

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"sync"
	"sync/atomic"

	tunnelprotocol "github.com/mistle/sandboxd/tunnel/protocol"
)

const EgressTokenBridgeMaxFrameBytes = 64 * 1024

type EgressTokenBridgeClient struct {
	connection    net.Conn
	mutex         sync.Mutex
	nextRequestID atomic.Uint64
}

type EgressTokenBridgeServer struct {
	connection net.Conn
	done       chan error
	once       sync.Once
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

func (client *EgressTokenBridgeClient) Token() (tunnelprotocol.EgressToken, error) {
	if client == nil {
		return tunnelprotocol.EgressToken{}, fmt.Errorf("egress token bridge client is required")
	}
	requestID := fmt.Sprintf("egress_token_bridge_req_%d", client.nextRequestID.Add(1))
	request := egressTokenBridgeRequest{
		Type:      "egressToken.request",
		RequestID: requestID,
	}

	client.mutex.Lock()
	defer client.mutex.Unlock()

	if err := writeTokenBridgeJSONLine(client.connection, request); err != nil {
		return tunnelprotocol.EgressToken{}, err
	}
	response, err := readTokenBridgeJSONLine[egressTokenBridgeResponse](client.connection)
	if err != nil {
		return tunnelprotocol.EgressToken{}, err
	}
	if response.RequestID != requestID {
		return tunnelprotocol.EgressToken{}, fmt.Errorf("egress token bridge response id mismatch: expected %s, got %s", requestID, response.RequestID)
	}
	switch response.Type {
	case "egressToken.response":
		if response.Token == "" {
			return tunnelprotocol.EgressToken{}, fmt.Errorf("egress token bridge response token is required")
		}
		return tunnelprotocol.EgressToken{
			Token:     response.Token,
			ExpiresAt: response.ExpiresAt,
			TTLMS:     response.TTLMS,
		}, nil
	case "egressToken.error":
		if response.Message == "" {
			return tunnelprotocol.EgressToken{}, fmt.Errorf("egress token bridge error message is required")
		}
		return tunnelprotocol.EgressToken{}, fmt.Errorf("%s", response.Message)
	default:
		return tunnelprotocol.EgressToken{}, fmt.Errorf("egress token bridge response type is invalid: %s", response.Type)
	}
}

func (client *EgressTokenBridgeClient) Close() error {
	if client == nil || client.connection == nil {
		return nil
	}
	return client.connection.Close()
}

func StartEgressTokenBridgeServer(connection net.Conn, tokenProvider EgressTokenProvider) (*EgressTokenBridgeServer, error) {
	if connection == nil {
		return nil, fmt.Errorf("egress token bridge connection is required")
	}
	if tokenProvider == nil {
		return nil, fmt.Errorf("egress token bridge token provider is required")
	}
	server := &EgressTokenBridgeServer{
		connection: connection,
		done:       make(chan error, 1),
	}
	go server.run(tokenProvider)
	return server, nil
}

func (server *EgressTokenBridgeServer) Close() error {
	if server == nil {
		return nil
	}
	server.once.Do(func() {
		_ = server.connection.Close()
	})
	err := <-server.done
	if err != nil {
		return fmt.Errorf("egress token bridge server failed: %w", err)
	}
	return nil
}

func (server *EgressTokenBridgeServer) run(tokenProvider EgressTokenProvider) {
	for {
		request, err := readTokenBridgeJSONLine[egressTokenBridgeRequest](server.connection)
		if err != nil {
			if isTokenBridgeCloseError(err) {
				server.done <- nil
				return
			}
			server.done <- err
			return
		}
		if request.Type != "egressToken.request" {
			server.done <- fmt.Errorf("egress token bridge request type is invalid: %s", request.Type)
			return
		}
		if request.RequestID == "" {
			server.done <- fmt.Errorf("egress token bridge request id is required")
			return
		}
		token, err := tokenProvider.Token()
		if err != nil {
			writeErr := writeTokenBridgeJSONLine(server.connection, egressTokenBridgeResponse{
				Type:      "egressToken.error",
				RequestID: request.RequestID,
				Message:   err.Error(),
			})
			if writeErr != nil {
				server.done <- writeErr
				return
			}
			continue
		}
		if err := writeTokenBridgeJSONLine(server.connection, egressTokenBridgeResponse{
			Type:      "egressToken.response",
			RequestID: request.RequestID,
			Token:     token.Token,
			ExpiresAt: token.ExpiresAt,
			TTLMS:     token.TTLMS,
		}); err != nil {
			server.done <- err
			return
		}
	}
}

func isTokenBridgeCloseError(err error) bool {
	if err == nil {
		return false
	}
	message := err.Error()
	return message == "egress token bridge stream closed" ||
		message == "failed to read token bridge stream: use of closed network connection" ||
		message == "failed to read token bridge stream: read unix @->@: use of closed network connection"
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
	decoder := json.NewDecoder(bytes.NewReader(line))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil {
		return payload, fmt.Errorf("failed to parse token bridge json: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != nil && err != io.EOF {
		return payload, fmt.Errorf("failed to parse token bridge json: %w", err)
	}
	return payload, nil
}
