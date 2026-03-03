package tunnel

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"syscall"

	"github.com/coder/websocket"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/sessionprotocol"
)

const ptyOutputReadBufferBytes = 4096

type websocketReadResult struct {
	MessageType websocket.MessageType
	Payload     []byte
	Err         error
}

type ptyControlAction string

const (
	ptyControlActionContinue     ptyControlAction = "continue"
	ptyControlActionCloseSession ptyControlAction = "close-session"
)

func handlePTYConnectRequest(
	ctx context.Context,
	tunnelConn *websocket.Conn,
	connectRequest connectRequest,
	activePTYSession *ptySession,
) (*ptySession, error) {
	ptyConnectRequest, err := parsePTYConnectRequest(connectRequest.RawPayload)
	if err != nil {
		if writeErr := writeConnectError(ctx, tunnelConn, sessionprotocol.ConnectError{
			Type:      sessionprotocol.MessageTypeConnectError,
			RequestID: connectRequest.RequestID,
			Code:      connectErrorCodeInvalidConnectRequest,
			Message:   err.Error(),
		}); writeErr != nil {
			return activePTYSession, fmt.Errorf("failed to write sandbox tunnel connect error: %w", writeErr)
		}
		return activePTYSession, nil
	}

	if ptyConnectRequest.Channel.Session == sessionprotocol.PTYSessionModeCreate {
		if activePTYSession != nil && !activePTYSession.IsExited() {
			if writeErr := writeConnectError(ctx, tunnelConn, sessionprotocol.ConnectError{
				Type:      sessionprotocol.MessageTypeConnectError,
				RequestID: connectRequest.RequestID,
				Code:      connectErrorCodePTYSessionExists,
				Message:   "pty session already exists",
			}); writeErr != nil {
				return activePTYSession, fmt.Errorf("failed to write sandbox tunnel connect error: %w", writeErr)
			}
			return activePTYSession, nil
		}

		activePTYSession, err = startPTYSession(ptyConnectRequest)
		if err != nil {
			if writeErr := writeConnectError(ctx, tunnelConn, sessionprotocol.ConnectError{
				Type:      sessionprotocol.MessageTypeConnectError,
				RequestID: connectRequest.RequestID,
				Code:      connectErrorCodePTYSessionCreateFailed,
				Message:   err.Error(),
			}); writeErr != nil {
				return activePTYSession, fmt.Errorf("failed to write sandbox tunnel connect error: %w", writeErr)
			}
			return activePTYSession, nil
		}
	}

	if ptyConnectRequest.Channel.Session == sessionprotocol.PTYSessionModeAttach {
		if activePTYSession == nil || activePTYSession.IsExited() {
			if writeErr := writeConnectError(ctx, tunnelConn, sessionprotocol.ConnectError{
				Type:      sessionprotocol.MessageTypeConnectError,
				RequestID: connectRequest.RequestID,
				Code:      connectErrorCodePTYSessionUnavailable,
				Message:   "pty session is not available",
			}); writeErr != nil {
				return activePTYSession, fmt.Errorf("failed to write sandbox tunnel connect error: %w", writeErr)
			}
			return activePTYSession, nil
		}
	}

	if err := writeConnectOK(ctx, tunnelConn, sessionprotocol.ConnectOK{
		Type:      sessionprotocol.MessageTypeConnectOK,
		RequestID: connectRequest.RequestID,
	}); err != nil {
		return activePTYSession, fmt.Errorf("failed to write sandbox tunnel connect acknowledgement: %w", err)
	}

	if err := relayPTYSession(ctx, tunnelConn, activePTYSession); err != nil {
		return activePTYSession, fmt.Errorf("sandbox tunnel pty relay failed: %w", err)
	}

	if activePTYSession.IsExited() {
		activePTYSession = nil
	}

	return activePTYSession, nil
}

func relayPTYSession(ctx context.Context, tunnelConn *websocket.Conn, session *ptySession) error {
	relayContext, cancel := context.WithCancel(ctx)
	defer cancel()

	wsReadCh := make(chan websocketReadResult, 1)
	go readWebsocketMessages(relayContext, tunnelConn, wsReadCh)

	ptyOutputCh := make(chan []byte, 8)
	ptyOutputErrCh := make(chan error, 1)
	go readPTYOutput(session, ptyOutputCh, ptyOutputErrCh)

	for {
		select {
		case wsReadResult := <-wsReadCh:
			if wsReadResult.Err != nil {
				return fmt.Errorf("sandbox tunnel websocket read failed: %w", wsReadResult.Err)
			}

			switch wsReadResult.MessageType {
			case websocket.MessageBinary:
				if session.IsExited() {
					continue
				}
				if _, err := session.terminal.Write(wsReadResult.Payload); err != nil {
					return fmt.Errorf("failed to write pty stdin payload: %w", err)
				}
			case websocket.MessageText:
				controlAction, err := handlePTYControlMessage(
					relayContext,
					tunnelConn,
					session,
					wsReadResult.Payload,
				)
				if err != nil {
					return err
				}
				if controlAction == ptyControlActionCloseSession {
					return nil
				}
			default:
				return fmt.Errorf(
					"unsupported websocket message type for pty session: %s",
					wsReadResult.MessageType.String(),
				)
			}
		case outputPayload := <-ptyOutputCh:
			if err := tunnelConn.Write(relayContext, websocket.MessageBinary, outputPayload); err != nil {
				return fmt.Errorf("failed to write pty output to websocket: %w", err)
			}
		case ptyOutputErr := <-ptyOutputErrCh:
			if ptyOutputErr == nil ||
				errors.Is(ptyOutputErr, io.EOF) ||
				errors.Is(ptyOutputErr, os.ErrClosed) ||
				errors.Is(ptyOutputErr, syscall.EIO) {
				continue
			}
			return fmt.Errorf("failed to read pty output: %w", ptyOutputErr)
		case <-session.exitedCh:
			if err := writeTextJSONMessage(relayContext, tunnelConn, sessionprotocol.PTYExit{
				Type:     sessionprotocol.MessageTypePTYExit,
				ExitCode: session.ExitCode(),
			}); err != nil {
				return fmt.Errorf("failed to write pty exit message: %w", err)
			}
			_ = session.CloseTerminal()
			return nil
		}
	}
}

func readWebsocketMessages(ctx context.Context, connection *websocket.Conn, resultCh chan<- websocketReadResult) {
	for {
		messageType, payload, err := connection.Read(ctx)
		select {
		case resultCh <- websocketReadResult{
			MessageType: messageType,
			Payload:     payload,
			Err:         err,
		}:
		case <-ctx.Done():
			return
		}

		if err != nil {
			return
		}
	}
}

func readPTYOutput(session *ptySession, outputCh chan<- []byte, errCh chan<- error) {
	buffer := make([]byte, ptyOutputReadBufferBytes)
	for {
		readBytes, readErr := session.terminal.Read(buffer)
		if readBytes > 0 {
			chunk := make([]byte, readBytes)
			copy(chunk, buffer[:readBytes])
			outputCh <- chunk
		}
		if readErr != nil {
			errCh <- readErr
			return
		}
	}
}

func handlePTYControlMessage(
	ctx context.Context,
	tunnelConn *websocket.Conn,
	session *ptySession,
	payload []byte,
) (ptyControlAction, error) {
	messageType, err := parseControlMessageType(payload)
	if err != nil {
		return ptyControlActionContinue, fmt.Errorf("failed to parse pty control message type: %w", err)
	}

	switch messageType {
	case sessionprotocol.MessageTypeConnect:
		connectRequest, err := parsePTYConnectRequest(payload)
		if err != nil {
			if writeErr := writeConnectError(ctx, tunnelConn, sessionprotocol.ConnectError{
				Type:      sessionprotocol.MessageTypeConnectError,
				RequestID: "",
				Code:      connectErrorCodeInvalidConnectRequest,
				Message:   err.Error(),
			}); writeErr != nil {
				return ptyControlActionContinue, fmt.Errorf("failed to write connect.error during pty relay: %w", writeErr)
			}
			return ptyControlActionContinue, nil
		}

		if connectRequest.Channel.Session == sessionprotocol.PTYSessionModeCreate {
			if err := writeConnectError(ctx, tunnelConn, sessionprotocol.ConnectError{
				Type:      sessionprotocol.MessageTypeConnectError,
				RequestID: connectRequest.RequestID,
				Code:      connectErrorCodePTYSessionExists,
				Message:   "pty session already exists",
			}); err != nil {
				return ptyControlActionContinue, fmt.Errorf("failed to write connect.error during pty relay: %w", err)
			}
			return ptyControlActionContinue, nil
		}

		if err := writeConnectOK(ctx, tunnelConn, sessionprotocol.ConnectOK{
			Type:      sessionprotocol.MessageTypeConnectOK,
			RequestID: connectRequest.RequestID,
		}); err != nil {
			return ptyControlActionContinue, fmt.Errorf("failed to write connect.ok during pty relay: %w", err)
		}

		return ptyControlActionContinue, nil
	case sessionprotocol.MessageTypePTYResize:
		var resizeRequest sessionprotocol.PTYResize
		if err := json.Unmarshal(payload, &resizeRequest); err != nil {
			return ptyControlActionContinue, fmt.Errorf("pty resize request must be valid JSON: %w", err)
		}
		if err := session.Resize(resizeRequest.Cols, resizeRequest.Rows); err != nil {
			return ptyControlActionContinue, fmt.Errorf("failed to resize pty session: %w", err)
		}
		return ptyControlActionContinue, nil
	case sessionprotocol.MessageTypePTYClose:
		var closeRequest sessionprotocol.PTYClose
		if err := json.Unmarshal(payload, &closeRequest); err != nil {
			if writeErr := writeTextJSONMessage(ctx, tunnelConn, sessionprotocol.PTYCloseError{
				Type:      sessionprotocol.MessageTypePTYCloseErr,
				RequestID: "",
				Code:      ptyCloseErrorCodeInvalidCloseRequest,
				Message:   fmt.Sprintf("pty close request must be valid JSON: %v", err),
			}); writeErr != nil {
				return ptyControlActionContinue, fmt.Errorf("failed to write pty.close.error: %w", writeErr)
			}
			return ptyControlActionContinue, nil
		}

		closeRequest.RequestID = strings.TrimSpace(closeRequest.RequestID)
		if closeRequest.RequestID == "" {
			if writeErr := writeTextJSONMessage(ctx, tunnelConn, sessionprotocol.PTYCloseError{
				Type:      sessionprotocol.MessageTypePTYCloseErr,
				RequestID: "",
				Code:      ptyCloseErrorCodeInvalidCloseRequest,
				Message:   "pty close request requestId is required",
			}); writeErr != nil {
				return ptyControlActionContinue, fmt.Errorf("failed to write pty.close.error: %w", writeErr)
			}
			return ptyControlActionContinue, nil
		}

		exitCode, terminateErr := session.Terminate()
		if terminateErr != nil {
			if writeErr := writeTextJSONMessage(ctx, tunnelConn, sessionprotocol.PTYCloseError{
				Type:      sessionprotocol.MessageTypePTYCloseErr,
				RequestID: closeRequest.RequestID,
				Code:      ptyCloseErrorCodeTerminateFailed,
				Message:   terminateErr.Error(),
			}); writeErr != nil {
				return ptyControlActionContinue, fmt.Errorf("failed to write pty.close.error: %w", writeErr)
			}
			return ptyControlActionContinue, nil
		}

		if err := writeTextJSONMessage(ctx, tunnelConn, sessionprotocol.PTYCloseOK{
			Type:      sessionprotocol.MessageTypePTYCloseOK,
			RequestID: closeRequest.RequestID,
			ExitCode:  exitCode,
		}); err != nil {
			return ptyControlActionContinue, fmt.Errorf("failed to write pty.close.ok: %w", err)
		}

		_ = session.CloseTerminal()
		return ptyControlActionCloseSession, nil
	default:
		return ptyControlActionContinue, fmt.Errorf("unsupported pty control message type '%s'", messageType)
	}
}
