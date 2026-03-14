package tunnel

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"syscall"

	"github.com/coder/websocket"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/sessionprotocol"
)

const ptyOutputReadBufferBytes = 4096

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
) (*ptySession, *activeTunnelStreamRelay, error) {
	ptyConnectRequest, err := parsePTYConnectRequest(connectRequest.RawPayload)
	if err != nil {
		if writeErr := writeStreamOpenError(ctx, tunnelConn, sessionprotocol.StreamOpenError{
			Type:     sessionprotocol.MessageTypeStreamOpenError,
			StreamID: connectRequest.StreamID,
			Code:     connectErrorCodeInvalidConnectRequest,
			Message:  err.Error(),
		}); writeErr != nil {
			return activePTYSession, nil, fmt.Errorf("failed to write sandbox tunnel stream.open error: %w", writeErr)
		}
		return activePTYSession, nil, nil
	}

	if ptyConnectRequest.Channel.Session == sessionprotocol.PTYSessionModeCreate {
		if activePTYSession != nil && !activePTYSession.IsExited() {
			if writeErr := writeStreamOpenError(ctx, tunnelConn, sessionprotocol.StreamOpenError{
				Type:     sessionprotocol.MessageTypeStreamOpenError,
				StreamID: connectRequest.StreamID,
				Code:     connectErrorCodePTYSessionExists,
				Message:  "pty session already exists",
			}); writeErr != nil {
				return activePTYSession, nil, fmt.Errorf("failed to write sandbox tunnel stream.open error: %w", writeErr)
			}
			return activePTYSession, nil, nil
		}

		activePTYSession, err = startPTYSession(ptyConnectRequest)
		if err != nil {
			if writeErr := writeStreamOpenError(ctx, tunnelConn, sessionprotocol.StreamOpenError{
				Type:     sessionprotocol.MessageTypeStreamOpenError,
				StreamID: connectRequest.StreamID,
				Code:     connectErrorCodePTYSessionCreateFailed,
				Message:  err.Error(),
			}); writeErr != nil {
				return activePTYSession, nil, fmt.Errorf("failed to write sandbox tunnel stream.open error: %w", writeErr)
			}
			return activePTYSession, nil, nil
		}
	}

	if ptyConnectRequest.Channel.Session == sessionprotocol.PTYSessionModeAttach {
		if activePTYSession == nil || activePTYSession.IsExited() {
			if writeErr := writeStreamOpenError(ctx, tunnelConn, sessionprotocol.StreamOpenError{
				Type:     sessionprotocol.MessageTypeStreamOpenError,
				StreamID: connectRequest.StreamID,
				Code:     connectErrorCodePTYSessionUnavailable,
				Message:  "pty session is not available",
			}); writeErr != nil {
				return activePTYSession, nil, fmt.Errorf("failed to write sandbox tunnel stream.open error: %w", writeErr)
			}
			return activePTYSession, nil, nil
		}
	}

	if err := writeStreamOpenOK(ctx, tunnelConn, sessionprotocol.StreamOpenOK{
		Type:     sessionprotocol.MessageTypeStreamOpenOK,
		StreamID: connectRequest.StreamID,
	}); err != nil {
		return activePTYSession, nil, fmt.Errorf("failed to write sandbox tunnel stream.open acknowledgement: %w", err)
	}

	return activePTYSession, startPTYRelay(ctx, tunnelConn, activePTYSession, connectRequest.StreamID), nil
}

func startPTYRelay(
	ctx context.Context,
	tunnelConn *websocket.Conn,
	session *ptySession,
	streamID int,
) *activeTunnelStreamRelay {
	relay := &activeTunnelStreamRelay{
		MessageCh: make(chan tunnelMessage),
		ResultCh:  make(chan activeTunnelStreamRelayResult, 1),
	}

	go func() {
		result := activeTunnelStreamRelayResult{
			PTYSession:        session,
			UpdatesPTYSession: true,
		}
		if err := relayPTYSession(ctx, tunnelConn, session, streamID, relay.MessageCh); err != nil {
			result.Err = fmt.Errorf("sandbox tunnel pty relay failed: %w", err)
		}
		if session.IsExited() {
			result.PTYSession = nil
		}
		relay.ResultCh <- result
	}()

	return relay
}

func relayPTYSession(
	ctx context.Context,
	tunnelConn *websocket.Conn,
	session *ptySession,
	streamID int,
	incomingMessages <-chan tunnelMessage,
) error {
	relayContext, cancel := context.WithCancel(ctx)
	defer cancel()

	ptyOutputCh := make(chan []byte, 8)
	ptyOutputErrCh := make(chan error, 1)
	go readPTYOutput(session, ptyOutputCh, ptyOutputErrCh)

	for {
		select {
		case message := <-incomingMessages:
			switch message.MessageType {
			case websocket.MessageBinary:
				if session.IsExited() {
					continue
				}
				if _, err := session.terminal.Write(message.Payload); err != nil {
					return fmt.Errorf("failed to write pty stdin payload: %w", err)
				}
			case websocket.MessageText:
				controlAction, err := handlePTYControlMessage(
					relayContext,
					tunnelConn,
					session,
					streamID,
					message.Payload,
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
					message.MessageType.String(),
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
			if err := writeStreamEvent(relayContext, tunnelConn, sessionprotocol.StreamEvent{
				Type:     sessionprotocol.MessageTypeStreamEvent,
				StreamID: streamID,
				Event: sessionprotocol.PTYExitEvent{
					Type:     sessionprotocol.MessageTypePTYExit,
					ExitCode: session.ExitCode(),
				},
			}); err != nil {
				return fmt.Errorf("failed to write pty exit message: %w", err)
			}
			_ = session.CloseTerminal()
			return nil
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
	streamID int,
	payload []byte,
) (ptyControlAction, error) {
	messageType, err := parseControlMessageType(payload)
	if err != nil {
		return ptyControlActionContinue, fmt.Errorf("failed to parse pty control message type: %w", err)
	}

	switch messageType {
	case sessionprotocol.MessageTypeStreamOpen:
		connectRequest, err := parsePTYConnectRequest(payload)
		if err != nil {
			if writeErr := writeStreamOpenError(ctx, tunnelConn, sessionprotocol.StreamOpenError{
				Type:     sessionprotocol.MessageTypeStreamOpenError,
				StreamID: 0,
				Code:     connectErrorCodeInvalidConnectRequest,
				Message:  err.Error(),
			}); writeErr != nil {
				return ptyControlActionContinue, fmt.Errorf("failed to write stream.open.error during pty relay: %w", writeErr)
			}
			return ptyControlActionContinue, nil
		}

		if connectRequest.Channel.Session == sessionprotocol.PTYSessionModeCreate {
			if err := writeStreamOpenError(ctx, tunnelConn, sessionprotocol.StreamOpenError{
				Type:     sessionprotocol.MessageTypeStreamOpenError,
				StreamID: connectRequest.StreamID,
				Code:     connectErrorCodePTYSessionExists,
				Message:  "pty session already exists",
			}); err != nil {
				return ptyControlActionContinue, fmt.Errorf("failed to write stream.open.error during pty relay: %w", err)
			}
			return ptyControlActionContinue, nil
		}

		if err := writeStreamOpenOK(ctx, tunnelConn, sessionprotocol.StreamOpenOK{
			Type:     sessionprotocol.MessageTypeStreamOpenOK,
			StreamID: connectRequest.StreamID,
		}); err != nil {
			return ptyControlActionContinue, fmt.Errorf("failed to write stream.open.ok during pty relay: %w", err)
		}

		return ptyControlActionContinue, nil
	case sessionprotocol.MessageTypeStreamSignal:
		signalMessage, err := parsePTYResizeSignal(payload)
		if err != nil {
			if writeErr := writeStreamReset(ctx, tunnelConn, sessionprotocol.StreamReset{
				Type:     sessionprotocol.MessageTypeStreamReset,
				StreamID: streamID,
				Code:     streamResetCodeInvalidStreamSignal,
				Message:  err.Error(),
			}); writeErr != nil {
				return ptyControlActionCloseSession, fmt.Errorf("failed to write stream.reset for invalid pty signal: %w", writeErr)
			}
			return ptyControlActionCloseSession, nil
		}
		if signalMessage.StreamID != streamID {
			if err := writeStreamReset(ctx, tunnelConn, sessionprotocol.StreamReset{
				Type:     sessionprotocol.MessageTypeStreamReset,
				StreamID: streamID,
				Code:     streamResetCodeInvalidStreamSignal,
				Message:  fmt.Sprintf("stream signal streamId %d does not match active PTY stream %d", signalMessage.StreamID, streamID),
			}); err != nil {
				return ptyControlActionCloseSession, fmt.Errorf("failed to write stream.reset for mismatched pty signal: %w", err)
			}
			return ptyControlActionCloseSession, nil
		}
		if err := session.Resize(signalMessage.Signal.Cols, signalMessage.Signal.Rows); err != nil {
			return ptyControlActionContinue, fmt.Errorf("failed to resize pty session: %w", err)
		}
		return ptyControlActionContinue, nil
	case sessionprotocol.MessageTypeStreamClose:
		closeRequest, err := parseStreamClose(payload)
		if err != nil {
			if writeErr := writeStreamReset(ctx, tunnelConn, sessionprotocol.StreamReset{
				Type:     sessionprotocol.MessageTypeStreamReset,
				StreamID: streamID,
				Code:     streamResetCodeInvalidStreamClose,
				Message:  err.Error(),
			}); writeErr != nil {
				return ptyControlActionCloseSession, fmt.Errorf("failed to write stream.reset for invalid pty close: %w", writeErr)
			}
			return ptyControlActionCloseSession, nil
		}
		if closeRequest.StreamID != streamID {
			if err := writeStreamReset(ctx, tunnelConn, sessionprotocol.StreamReset{
				Type:     sessionprotocol.MessageTypeStreamReset,
				StreamID: streamID,
				Code:     streamResetCodeInvalidStreamClose,
				Message:  fmt.Sprintf("stream close streamId %d does not match active PTY stream %d", closeRequest.StreamID, streamID),
			}); err != nil {
				return ptyControlActionCloseSession, fmt.Errorf("failed to write stream.reset for mismatched pty close: %w", err)
			}
			return ptyControlActionCloseSession, nil
		}

		exitCode, terminateErr := session.Terminate()
		if terminateErr != nil {
			if writeErr := writeStreamReset(ctx, tunnelConn, sessionprotocol.StreamReset{
				Type:     sessionprotocol.MessageTypeStreamReset,
				StreamID: streamID,
				Code:     streamResetCodeStreamCloseFailed,
				Message:  terminateErr.Error(),
			}); writeErr != nil {
				return ptyControlActionCloseSession, fmt.Errorf("failed to write stream.reset for pty close failure: %w", writeErr)
			}
			return ptyControlActionCloseSession, nil
		}

		if err := writeStreamEvent(ctx, tunnelConn, sessionprotocol.StreamEvent{
			Type:     sessionprotocol.MessageTypeStreamEvent,
			StreamID: streamID,
			Event: sessionprotocol.PTYExitEvent{
				Type:     sessionprotocol.MessageTypePTYExit,
				ExitCode: exitCode,
			},
		}); err != nil {
			return ptyControlActionCloseSession, fmt.Errorf("failed to write stream.event for pty close: %w", err)
		}

		_ = session.CloseTerminal()
		return ptyControlActionCloseSession, nil
	default:
		return ptyControlActionContinue, fmt.Errorf("unsupported pty control message type '%s'", messageType)
	}
}

func parsePTYResizeSignal(payload []byte) (sessionprotocol.StreamSignal, error) {
	var signalMessage sessionprotocol.StreamSignal
	if err := json.Unmarshal(payload, &signalMessage); err != nil {
		return sessionprotocol.StreamSignal{}, fmt.Errorf("stream.signal must be valid JSON: %w", err)
	}

	if signalMessage.Type != sessionprotocol.MessageTypeStreamSignal {
		return sessionprotocol.StreamSignal{}, fmt.Errorf("stream.signal request type must be '%s'", sessionprotocol.MessageTypeStreamSignal)
	}
	if signalMessage.StreamID <= 0 {
		return sessionprotocol.StreamSignal{}, fmt.Errorf("stream.signal request streamId must be a positive integer")
	}
	if signalMessage.Signal.Type != sessionprotocol.MessageTypePTYResize {
		return sessionprotocol.StreamSignal{}, fmt.Errorf("stream.signal signal.type must be '%s'", sessionprotocol.MessageTypePTYResize)
	}
	if signalMessage.Signal.Cols < 1 || signalMessage.Signal.Rows < 1 {
		return sessionprotocol.StreamSignal{}, fmt.Errorf("pty resize signal cols and rows must be greater than or equal to 1")
	}
	if signalMessage.Signal.Cols > 65535 || signalMessage.Signal.Rows > 65535 {
		return sessionprotocol.StreamSignal{}, fmt.Errorf("pty resize signal cols and rows must be less than or equal to 65535")
	}

	return signalMessage, nil
}

func parseStreamClose(payload []byte) (sessionprotocol.StreamClose, error) {
	var closeRequest sessionprotocol.StreamClose
	if err := json.Unmarshal(payload, &closeRequest); err != nil {
		return sessionprotocol.StreamClose{}, fmt.Errorf("stream.close must be valid JSON: %w", err)
	}

	if closeRequest.Type != sessionprotocol.MessageTypeStreamClose {
		return sessionprotocol.StreamClose{}, fmt.Errorf("stream.close request type must be '%s'", sessionprotocol.MessageTypeStreamClose)
	}
	if closeRequest.StreamID <= 0 {
		return sessionprotocol.StreamClose{}, fmt.Errorf("stream.close request streamId must be a positive integer")
	}

	return closeRequest, nil
}
