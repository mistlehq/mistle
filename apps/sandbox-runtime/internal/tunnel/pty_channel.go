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
	ptyControlActionDetachStream ptyControlAction = "detach-stream"
	ptyControlActionCloseSession ptyControlAction = "close-session"
)

func handlePTYConnectRequest(
	ctx context.Context,
	tunnelConn *websocket.Conn,
	connectRequest connectRequest,
	activePTYSession *ptySession,
	relayResultCh chan<- activeTunnelStreamRelayResult,
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

	return activePTYSession, startPTYRelay(
		ctx,
		tunnelConn,
		activePTYSession,
		connectRequest.StreamID,
		relayResultCh,
	), nil
}

func startPTYRelay(
	ctx context.Context,
	tunnelConn *websocket.Conn,
	session *ptySession,
	streamID int,
	relayResultCh chan<- activeTunnelStreamRelayResult,
) *activeTunnelStreamRelay {
	relay := &activeTunnelStreamRelay{
		PrimaryStreamID: streamID,
		ChannelKind:     sessionprotocol.ChannelKindPTY,
		MessageCh:       make(chan tunnelMessage),
	}

	go func() {
		result := activeTunnelStreamRelayResult{
			Relay:             relay,
			PTYSession:        session,
			UpdatesPTYSession: true,
		}
		if err := relayPTYSession(ctx, tunnelConn, session, streamID, relay.MessageCh); err != nil {
			result.Err = fmt.Errorf("sandbox tunnel pty relay failed: %w", err)
		}
		if session.IsExited() {
			result.PTYSession = nil
		}
		relayResultCh <- result
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

	attachedStreamIDs := map[int]struct{}{
		streamID: {},
	}
	sendWindowsByStreamID := map[int]*streamSendWindow{
		streamID: newStreamSendWindow(),
	}
	ptyOutputCh := make(chan []byte, 8)
	ptyOutputErrCh := make(chan error, 1)
	go readPTYOutput(session, ptyOutputCh, ptyOutputErrCh)

	for {
		select {
		case message := <-incomingMessages:
			switch message.MessageType {
			case websocket.MessageBinary:
				dataFrame, err := sessionprotocol.DecodeDataFrame(message.Payload)
				if err != nil {
					if writeErr := writeStreamReset(relayContext, tunnelConn, sessionprotocol.StreamReset{
						Type:     sessionprotocol.MessageTypeStreamReset,
						StreamID: streamID,
						Code:     streamResetCodeInvalidStreamData,
						Message:  err.Error(),
					}); writeErr != nil {
						return fmt.Errorf("failed to write stream.reset for invalid pty data frame: %w", writeErr)
					}
					return nil
				}
				if _, isAttachedStream := attachedStreamIDs[int(dataFrame.StreamID)]; !isAttachedStream {
					if err := writeStreamReset(relayContext, tunnelConn, sessionprotocol.StreamReset{
						Type:     sessionprotocol.MessageTypeStreamReset,
						StreamID: int(dataFrame.StreamID),
						Code:     streamResetCodeInvalidStreamData,
						Message:  fmt.Sprintf("stream data frame streamId %d is not attached to the active PTY session", dataFrame.StreamID),
					}); err != nil {
						return fmt.Errorf("failed to write stream.reset for mismatched pty data frame: %w", err)
					}
					return nil
				}
				if dataFrame.PayloadKind != sessionprotocol.PayloadKindRawBytes {
					if err := writeStreamReset(relayContext, tunnelConn, sessionprotocol.StreamReset{
						Type:     sessionprotocol.MessageTypeStreamReset,
						StreamID: streamID,
						Code:     streamResetCodeInvalidStreamData,
						Message:  fmt.Sprintf("pty stream payloadKind %d is not supported", dataFrame.PayloadKind),
					}); err != nil {
						return fmt.Errorf("failed to write stream.reset for unsupported pty payload kind: %w", err)
					}
					return nil
				}
				if session.IsExited() {
					continue
				}
				if _, err := session.terminal.Write(dataFrame.Payload); err != nil {
					return fmt.Errorf("failed to write pty stdin payload: %w", err)
				}
				if err := writeStreamWindow(relayContext, tunnelConn, sessionprotocol.StreamWindow{
					Type:     sessionprotocol.MessageTypeStreamWindow,
					StreamID: int(dataFrame.StreamID),
					Bytes:    len(dataFrame.Payload),
				}); err != nil {
					return fmt.Errorf("failed to write stream.window for consumed pty data: %w", err)
				}
			case websocket.MessageText:
				controlMessageType, err := parseControlMessageType(message.Payload)
				if err == nil && controlMessageType == sessionprotocol.MessageTypeStreamWindow {
					streamWindow, windowErr := parseStreamWindow(message.Payload)
					if windowErr != nil {
						return windowErr
					}
					sendWindow := sendWindowsByStreamID[streamWindow.StreamID]
					if sendWindow == nil {
						if err := writeStreamReset(relayContext, tunnelConn, sessionprotocol.StreamReset{
							Type:     sessionprotocol.MessageTypeStreamReset,
							StreamID: streamWindow.StreamID,
							Code:     streamResetCodeInvalidStreamData,
							Message:  fmt.Sprintf("stream.window streamId %d is not attached to the active PTY session", streamWindow.StreamID),
						}); err != nil {
							return fmt.Errorf("failed to write stream.reset for mismatched pty stream.window: %w", err)
						}
						return nil
					}
					if err := sendWindow.add(streamWindow.Bytes); err != nil {
						if writeErr := writeStreamReset(relayContext, tunnelConn, sessionprotocol.StreamReset{
							Type:     sessionprotocol.MessageTypeStreamReset,
							StreamID: streamWindow.StreamID,
							Code:     streamResetCodeInvalidStreamWindow,
							Message:  err.Error(),
						}); writeErr != nil {
							return fmt.Errorf("failed to write stream.reset for excessive pty stream.window: %w", writeErr)
						}
						if streamWindow.StreamID != streamID {
							delete(attachedStreamIDs, streamWindow.StreamID)
							delete(sendWindowsByStreamID, streamWindow.StreamID)
							continue
						}
						return nil
					}
					continue
				}
				controlAction, err := handlePTYControlMessage(
					relayContext,
					tunnelConn,
					session,
					streamID,
					attachedStreamIDs,
					sendWindowsByStreamID,
					message.Payload,
				)
				if err != nil {
					return err
				}
				if controlAction == ptyControlActionDetachStream {
					continue
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
			for attachedStreamID := range attachedStreamIDs {
				sendWindow := sendWindowsByStreamID[attachedStreamID]
				if sendWindow == nil {
					continue
				}
				if !sendWindow.tryConsume(len(outputPayload)) {
					if err := writeStreamReset(relayContext, tunnelConn, sessionprotocol.StreamReset{
						Type:     sessionprotocol.MessageTypeStreamReset,
						StreamID: attachedStreamID,
						Code:     streamResetCodeStreamWindowExhausted,
						Message:  "pty stream send window is exhausted",
					}); err != nil {
						return fmt.Errorf("failed to write stream.reset for exhausted pty send window: %w", err)
					}
					delete(attachedStreamIDs, attachedStreamID)
					delete(sendWindowsByStreamID, attachedStreamID)
					if attachedStreamID == streamID {
						_ = session.CloseTerminal()
						return nil
					}
					continue
				}
				if err := writeBinaryDataFrame(
					relayContext,
					tunnelConn,
					uint32(attachedStreamID),
					sessionprotocol.PayloadKindRawBytes,
					outputPayload,
				); err != nil {
					return fmt.Errorf("failed to write pty output data frame: %w", err)
				}
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
			for attachedStreamID := range attachedStreamIDs {
				if err := writeStreamEvent(relayContext, tunnelConn, sessionprotocol.StreamEvent{
					Type:     sessionprotocol.MessageTypeStreamEvent,
					StreamID: attachedStreamID,
					Event: sessionprotocol.PTYExitEvent{
						Type:     sessionprotocol.MessageTypePTYExit,
						ExitCode: session.ExitCode(),
					},
				}); err != nil {
					return fmt.Errorf("failed to write pty exit message: %w", err)
				}
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
	attachedStreamIDs map[int]struct{},
	sendWindowsByStreamID map[int]*streamSendWindow,
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

		attachedStreamIDs[connectRequest.StreamID] = struct{}{}
		sendWindowsByStreamID[connectRequest.StreamID] = newStreamSendWindow()
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
		if _, isAttachedStream := attachedStreamIDs[signalMessage.StreamID]; !isAttachedStream {
			if err := writeStreamReset(ctx, tunnelConn, sessionprotocol.StreamReset{
				Type:     sessionprotocol.MessageTypeStreamReset,
				StreamID: signalMessage.StreamID,
				Code:     streamResetCodeInvalidStreamSignal,
				Message:  fmt.Sprintf("stream signal streamId %d is not attached to the active PTY session", signalMessage.StreamID),
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
		if _, isAttachedStream := attachedStreamIDs[closeRequest.StreamID]; !isAttachedStream {
			if err := writeStreamReset(ctx, tunnelConn, sessionprotocol.StreamReset{
				Type:     sessionprotocol.MessageTypeStreamReset,
				StreamID: closeRequest.StreamID,
				Code:     streamResetCodeInvalidStreamClose,
				Message:  fmt.Sprintf("stream close streamId %d is not attached to the active PTY session", closeRequest.StreamID),
			}); err != nil {
				return ptyControlActionCloseSession, fmt.Errorf("failed to write stream.reset for mismatched pty close: %w", err)
			}
			return ptyControlActionCloseSession, nil
		}
		if closeRequest.StreamID != streamID {
			delete(attachedStreamIDs, closeRequest.StreamID)
			delete(sendWindowsByStreamID, closeRequest.StreamID)
			return ptyControlActionDetachStream, nil
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

		for attachedStreamID := range attachedStreamIDs {
			if err := writeStreamEvent(ctx, tunnelConn, sessionprotocol.StreamEvent{
				Type:     sessionprotocol.MessageTypeStreamEvent,
				StreamID: attachedStreamID,
				Event: sessionprotocol.PTYExitEvent{
					Type:     sessionprotocol.MessageTypePTYExit,
					ExitCode: exitCode,
				},
			}); err != nil {
				return ptyControlActionCloseSession, fmt.Errorf("failed to write stream.event for pty close: %w", err)
			}
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
