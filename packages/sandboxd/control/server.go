package control

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"sync"
)

type Server struct {
	listener   net.Listener
	socketPath string
	done       chan error
	closeOnce  sync.Once
}

func StartServer(socketPath string) (*Server, error) {
	if socketPath == "" {
		return nil, fmt.Errorf("control socket path is required")
	}
	parent := filepath.Dir(socketPath)
	if parent == "." || parent == "" {
		return nil, fmt.Errorf("control socket path %s has no parent directory", socketPath)
	}
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return nil, fmt.Errorf("failed to create control socket directory %s: %w", parent, err)
	}
	if err := removeStaleSocket(socketPath); err != nil {
		return nil, err
	}
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		return nil, fmt.Errorf("failed to bind control socket %s: %w", socketPath, err)
	}
	server := &Server{
		listener:   listener,
		socketPath: socketPath,
		done:       make(chan error, 1),
	}
	go server.run()
	return server, nil
}

func (server *Server) Wait() error {
	if server == nil {
		return fmt.Errorf("control server is required")
	}
	return <-server.done
}

func (server *Server) Close() error {
	if server == nil {
		return nil
	}
	server.closeOnce.Do(func() {
		_ = server.listener.Close()
	})
	return server.Wait()
}

func (server *Server) run() {
	for {
		connection, err := server.listener.Accept()
		if err != nil {
			if isClosedNetworkError(err) {
				server.finish(nil)
				return
			}
			server.finish(fmt.Errorf("failed to accept control socket connection: %w", err))
			return
		}
		shouldStop, err := handleServerConnection(connection)
		if err != nil {
			server.finish(err)
			return
		}
		if shouldStop {
			server.finish(nil)
			return
		}
	}
}

func (server *Server) finish(err error) {
	_ = os.Remove(server.socketPath)
	server.done <- err
}

func handleServerConnection(connection net.Conn) (bool, error) {
	defer connection.Close()
	requestBytes, err := io.ReadAll(connection)
	if err != nil {
		return false, writeServerResponse(connection, ErrorResponse(fmt.Sprintf("failed to read control socket request: %v", err)))
	}
	request, err := DecodeRequest(requestBytes)
	if err != nil {
		return false, writeServerResponse(connection, ErrorResponse(err.Error()))
	}
	response, shouldStop := dispatchServerRequest(request)
	return shouldStop, writeServerResponse(connection, response)
}

func dispatchServerRequest(request Request) (Response, bool) {
	switch request.Type {
	case RequestReady:
		return OKResponse(nil), false
	case RequestShutdown:
		return OKResponse(nil), true
	case RequestActivate:
		return ErrorResponse("sandbox startup request was rejected: daemon activation is not migrated to Go"), false
	case RequestSign:
		return ErrorResponse("sandbox startup request was rejected: daemon signing is not migrated to Go"), false
	default:
		return ErrorResponse(fmt.Sprintf("unsupported control request type: %s", request.Type)), false
	}
}

func writeServerResponse(connection net.Conn, response Response) error {
	responseBytes, err := json.Marshal(response)
	if err != nil {
		return fmt.Errorf("failed to serialize control socket response: %w", err)
	}
	if _, err := connection.Write(responseBytes); err != nil {
		return fmt.Errorf("failed to write control socket response: %w", err)
	}
	return nil
}

func removeStaleSocket(socketPath string) error {
	metadata, err := os.Lstat(socketPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("failed to inspect control socket path %s: %w", socketPath, err)
	}
	if metadata.Mode()&os.ModeSocket == 0 {
		return fmt.Errorf("control socket path %s already exists and is not a unix socket", socketPath)
	}
	if err := os.Remove(socketPath); err != nil {
		return fmt.Errorf("failed to remove stale control socket %s: %w", socketPath, err)
	}
	return nil
}

func isClosedNetworkError(err error) bool {
	if err == nil {
		return false
	}
	return err == net.ErrClosed
}
