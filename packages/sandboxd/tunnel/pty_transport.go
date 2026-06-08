package tunnel

import (
	"context"
	"fmt"
	"os"
	"sync"

	"github.com/coder/websocket"
	tunnelprotocol "github.com/mistle/sandboxd/tunnel/protocol"
)

const directPTYStreamID uint32 = 1
const ptySessionErrorCodeCreateFailed = "pty_create_failed"
const ptySessionErrorCodeAttachFailed = "pty_attach_failed"

func (session *LiveTunnelSession) handlePTYSessionControl(ctx context.Context, payload string) (bool, error) {
	message, err := tunnelprotocol.ParsePTYSessionControlMessage(payload)
	if err != nil {
		return true, nil
	}
	if message == nil {
		return false, nil
	}
	if message.Open != nil {
		session.startDirectPTYTransport(*message.Open)
	}
	return true, nil
}

func (session *LiveTunnelSession) startDirectPTYTransport(message tunnelprotocol.PTYSessionOpen) {
	session.mutex.Lock()
	cgroupRoot := session.cgroupRoot
	runtimeEnv := cloneStringMap(session.runtimeEnv)
	sandboxInstanceID := session.sandboxInstanceID
	session.mutex.Unlock()
	go func() {
		if err := session.runDirectPTYTransport(message, cgroupRoot, runtimeEnv, sandboxInstanceID); err != nil {
			fmt.Fprintf(os.Stderr, "sandboxd direct pty transport failed: %s\n", err.Error())
		}
	}()
}

func (session *LiveTunnelSession) runDirectPTYTransport(message tunnelprotocol.PTYSessionOpen, cgroupRoot string, runtimeEnv map[string]string, sandboxInstanceID string) error {
	if message.Launch.Session != "create" {
		payload, payloadErr := tunnelprotocol.PTYSessionErrorPayload(
			message.RequestID,
			message.PTYSessionID,
			ptySessionErrorCodeAttachFailed,
			"direct PTY transport does not support attaching to an existing PTY session",
		)
		return session.writeControl(context.Background(), payload, payloadErr)
	}
	ptySession, err := StartScopedPTYSession(PTYSpawnRequest{
		CWD:     message.Launch.CWD,
		Cols:    message.Launch.Cols,
		Rows:    message.Launch.Rows,
		Command: message.Launch.Command,
		Args:    message.Launch.Args,
		Env:     runtimeEnv,
	}, cgroupRoot, sandboxInstanceID)
	if err != nil {
		payload, payloadErr := tunnelprotocol.PTYSessionErrorPayload(message.RequestID, message.PTYSessionID, ptySessionErrorCodeCreateFailed, err.Error())
		return session.writeControl(context.Background(), payload, payloadErr)
	}
	defer ptySession.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	transportSocket, _, err := websocket.Dial(ctx, message.TransportURL, nil)
	if err != nil {
		_, _ = ptySession.Terminate(DefaultPTYTerminatePollInterval, DefaultPTYTerminateTimeout)
		payload, payloadErr := tunnelprotocol.PTYSessionErrorPayload(message.RequestID, message.PTYSessionID, ptySessionErrorCodeAttachFailed, err.Error())
		return session.writeControl(context.Background(), payload, payloadErr)
	}
	defer transportSocket.CloseNow()

	payload, payloadErr := tunnelprotocol.PTYSessionOpenedPayload(message.RequestID, message.PTYSessionID)
	if err := session.writeControl(context.Background(), payload, payloadErr); err != nil {
		_, _ = ptySession.Terminate(DefaultPTYTerminatePollInterval, DefaultPTYTerminateTimeout)
		return err
	}

	var socketWriteMutex sync.Mutex
	var finishOnce sync.Once
	finish := func() {
		finishOnce.Do(func() {
			cancel()
			_, _ = ptySession.Terminate(DefaultPTYTerminatePollInterval, DefaultPTYTerminateTimeout)
			_ = transportSocket.Close(websocket.StatusNormalClosure, "")
		})
	}
	done := make(chan error, 2)
	go session.forwardPTYEvents(ctx, transportSocket, ptySession, &socketWriteMutex, done)
	go session.forwardPTYTransportInput(ctx, transportSocket, ptySession, &socketWriteMutex, done)

	err = <-done
	finish()
	return err
}

func (session *LiveTunnelSession) forwardPTYEvents(
	ctx context.Context,
	socket *websocket.Conn,
	ptySession *PTYSession,
	socketWriteMutex *sync.Mutex,
	done chan<- error,
) {
	for {
		select {
		case <-ctx.Done():
			done <- nil
			return
		case event := <-ptySession.Events():
			switch event.Kind {
			case PTYEventOutput:
				socketWriteMutex.Lock()
				err := socket.Write(ctx, websocket.MessageBinary, event.Output)
				socketWriteMutex.Unlock()
				if err != nil {
					done <- err
					return
				}
			case PTYEventExit:
				payload, payloadErr := tunnelprotocol.PTYExitEvent(directPTYStreamID, event.ExitCode)
				if payloadErr != nil {
					done <- payloadErr
					return
				}
				socketWriteMutex.Lock()
				err := socket.Write(ctx, websocket.MessageText, []byte(payload))
				socketWriteMutex.Unlock()
				done <- err
				return
			case PTYEventClosed:
				if exitCode := ptySession.ExitCode(); exitCode != nil {
					payload, payloadErr := tunnelprotocol.PTYExitEvent(directPTYStreamID, *exitCode)
					if payloadErr != nil {
						done <- payloadErr
						return
					}
					socketWriteMutex.Lock()
					err := socket.Write(ctx, websocket.MessageText, []byte(payload))
					socketWriteMutex.Unlock()
					done <- err
					return
				}
			case PTYEventError:
				payload, payloadErr := tunnelprotocol.StreamReset(directPTYStreamID, tunnelprotocol.StreamResetCodeTargetClosed, event.Error)
				if payloadErr != nil {
					done <- payloadErr
					return
				}
				socketWriteMutex.Lock()
				err := socket.Write(ctx, websocket.MessageText, []byte(payload))
				socketWriteMutex.Unlock()
				done <- err
				return
			}
		}
	}
}

func (session *LiveTunnelSession) forwardPTYTransportInput(
	ctx context.Context,
	socket *websocket.Conn,
	ptySession *PTYSession,
	socketWriteMutex *sync.Mutex,
	done chan<- error,
) {
	for {
		messageType, payload, err := socket.Read(ctx)
		if err != nil {
			if ctx.Err() != nil || isExpectedWebSocketClose(err) {
				done <- nil
				return
			}
			done <- err
			return
		}
		switch messageType {
		case websocket.MessageBinary:
			if err := ptySession.Write(payload); err != nil {
				done <- err
				return
			}
		case websocket.MessageText:
			message, err := tunnelprotocol.ParsePTYControlMessage(string(payload))
			if err != nil {
				resetPayload, resetErr := tunnelprotocol.StreamReset(directPTYStreamID, tunnelprotocol.StreamResetCodeInvalidStreamSignal, err.Error())
				if resetErr != nil {
					done <- resetErr
					return
				}
				socketWriteMutex.Lock()
				writeErr := socket.Write(ctx, websocket.MessageText, []byte(resetPayload))
				socketWriteMutex.Unlock()
				if writeErr != nil {
					done <- writeErr
					return
				}
				continue
			}
			if message.Signal != nil {
				if err := ptySession.Resize(message.Signal.Signal.Cols, message.Signal.Signal.Rows); err != nil {
					done <- err
					return
				}
			}
			if message.Close != nil {
				exitCode, err := ptySession.Terminate(DefaultPTYTerminatePollInterval, DefaultPTYTerminateTimeout)
				if err != nil {
					resetPayload, resetErr := tunnelprotocol.StreamReset(directPTYStreamID, tunnelprotocol.StreamResetCodeStreamCloseFailed, err.Error())
					if resetErr != nil {
						done <- resetErr
						return
					}
					socketWriteMutex.Lock()
					writeErr := socket.Write(ctx, websocket.MessageText, []byte(resetPayload))
					socketWriteMutex.Unlock()
					done <- writeErr
					return
				}
				exitPayload, exitErr := tunnelprotocol.PTYExitEvent(directPTYStreamID, exitCode)
				if exitErr != nil {
					done <- exitErr
					return
				}
				socketWriteMutex.Lock()
				writeErr := socket.Write(ctx, websocket.MessageText, []byte(exitPayload))
				socketWriteMutex.Unlock()
				done <- writeErr
				return
			}
		}
	}
}
