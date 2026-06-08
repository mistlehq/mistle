package tunnel

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net"
	"time"

	tunnelprotocol "github.com/mistle/sandboxd/tunnel/protocol"
)

const portAccessTCPReadBufferBytes = 16 * 1024

type closeWriter interface {
	CloseWrite() error
}

func (session *LiveTunnelSession) openPortAccessTCPStream(ctx context.Context, message tunnelprotocol.PortsTCPOpen) error {
	if session.streamActive(message.StreamID) {
		return fmt.Errorf("ports.tcp.open streamId %d already exists", message.StreamID)
	}
	connection, err := connectPortAccessTCP(message)
	if err != nil {
		payload, payloadErr := tunnelprotocol.PortsTCPErrorPayload(message.StreamID, "upstream_connect_failed", err.Error())
		return session.writeControl(ctx, payload, payloadErr)
	}
	streamCtx, cancel := context.WithCancel(context.Background())
	session.mutex.Lock()
	session.streams[message.StreamID] = &liveTunnelStream{
		kind:             "portAccessTCP",
		cancel:           cancel,
		tcpConnection:    connection,
		tcpRequestWindow: tunnelprotocol.DefaultStreamWindowBytes,
		window:           tunnelprotocol.DefaultStreamWindowBytes,
	}
	session.mutex.Unlock()
	payload, payloadErr := tunnelprotocol.PortsTCPConnectedPayload(message.StreamID)
	if err := session.writeControl(ctx, payload, payloadErr); err != nil {
		session.closeStream(message.StreamID)
		return err
	}
	go session.runPortAccessTCPReader(streamCtx, message.StreamID, connection)
	return nil
}

func (session *LiveTunnelSession) runPortAccessTCPReader(ctx context.Context, streamID uint32, connection net.Conn) {
	buffer := make([]byte, portAccessTCPReadBufferBytes)
	for {
		if err := connection.SetReadDeadline(time.Now().Add(defaultPortAccessProbeTimeout)); err != nil {
			session.publishPortAccessTCPError(streamID, "upstream_io_error", err.Error())
			return
		}
		bytesRead, err := connection.Read(buffer)
		if bytesRead > 0 {
			if err := session.writeStreamFrame(ctx, streamID, tunnelprotocol.PayloadKindRawBytes, buffer[:bytesRead]); err != nil {
				return
			}
		}
		if err == nil {
			continue
		}
		if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
			select {
			case <-ctx.Done():
				return
			default:
				continue
			}
		}
		if errors.Is(err, io.EOF) {
			session.markPortAccessTCPClose(streamID, "response")
			return
		}
		session.publishPortAccessTCPError(streamID, "upstream_io_error", err.Error())
		return
	}
}

func (session *LiveTunnelSession) handlePortAccessTCPFrame(ctx context.Context, frame tunnelprotocol.StreamDataFrame, stream *liveTunnelStream) error {
	if frame.PayloadKind != tunnelprotocol.PayloadKindRawBytes {
		session.closeStream(frame.StreamID)
		payload, payloadErr := tunnelprotocol.StreamReset(
			frame.StreamID,
			tunnelprotocol.StreamResetCodeInvalidStreamData,
			"port access tcp stream only accepts raw byte data frames",
		)
		return session.writeControl(ctx, payload, payloadErr)
	}
	session.mutex.Lock()
	currentStream := session.streams[frame.StreamID]
	if currentStream == nil {
		session.mutex.Unlock()
		return nil
	}
	if currentStream.tcpRequestWindow < uint64(len(frame.Payload)) {
		delete(session.streams, frame.StreamID)
		session.mutex.Unlock()
		stream.tcpConnection.Close()
		payload, payloadErr := tunnelprotocol.StreamReset(
			frame.StreamID,
			tunnelprotocol.StreamResetCodeStreamWindowExhausted,
			"port access tcp request stream window is exhausted",
		)
		return session.writeControl(ctx, payload, payloadErr)
	}
	currentStream.tcpRequestWindow -= uint64(len(frame.Payload))
	session.mutex.Unlock()
	if _, err := stream.tcpConnection.Write(frame.Payload); err != nil {
		session.publishPortAccessTCPError(frame.StreamID, "upstream_io_error", err.Error())
		return nil
	}
	payload, payloadErr := tunnelprotocol.StreamWindowCredit(frame.StreamID, len(frame.Payload))
	if err := session.writeControl(ctx, payload, payloadErr); err != nil {
		return err
	}
	session.mutex.Lock()
	if currentStream := session.streams[frame.StreamID]; currentStream != nil {
		currentStream.tcpRequestWindow += uint64(len(frame.Payload))
	}
	session.mutex.Unlock()
	return nil
}

func (session *LiveTunnelSession) closePortAccessTCPDirection(ctx context.Context, message tunnelprotocol.PortsTCPClose) error {
	if message.Direction != "request" {
		return fmt.Errorf("ports.tcp.close streamId %d must use request direction when sent to sandboxd", message.StreamID)
	}
	stream := session.stream(message.StreamID)
	if stream == nil || stream.kind != "portAccessTCP" {
		return fmt.Errorf("ports.tcp.close streamId %d is not bound to an active port access tcp stream", message.StreamID)
	}
	if closer, ok := stream.tcpConnection.(closeWriter); ok {
		if err := closer.CloseWrite(); err != nil {
			return err
		}
	} else {
		if err := stream.tcpConnection.Close(); err != nil {
			return err
		}
	}
	payload, payloadErr := tunnelprotocol.PortsTCPClosePayload(message.StreamID, "request")
	if err := session.writeControl(ctx, payload, payloadErr); err != nil {
		return err
	}
	session.markPortAccessTCPDirectionClosed(message.StreamID, "request")
	return nil
}

func (session *LiveTunnelSession) markPortAccessTCPClose(streamID uint32, direction string) {
	payload, payloadErr := tunnelprotocol.PortsTCPClosePayload(streamID, direction)
	_ = session.writeControl(context.Background(), payload, payloadErr)
	session.markPortAccessTCPDirectionClosed(streamID, direction)
}

func (session *LiveTunnelSession) markPortAccessTCPDirectionClosed(streamID uint32, direction string) {
	session.mutex.Lock()
	stream := session.streams[streamID]
	if stream == nil || stream.kind != "portAccessTCP" {
		session.mutex.Unlock()
		return
	}
	switch direction {
	case "request":
		stream.tcpRequestClosed = true
	case "response":
		stream.tcpResponseClosed = true
	}
	shouldRelease := stream.tcpRequestClosed && stream.tcpResponseClosed
	session.mutex.Unlock()
	if shouldRelease {
		session.closeStream(streamID)
	}
}

func (session *LiveTunnelSession) publishPortAccessTCPError(streamID uint32, code string, message string) {
	payload, payloadErr := tunnelprotocol.PortsTCPErrorPayload(streamID, code, message)
	_ = session.writeControl(context.Background(), payload, payloadErr)
	session.closeStream(streamID)
}

func connectPortAccessTCP(message tunnelprotocol.PortsTCPOpen) (net.Conn, error) {
	connection, err := net.DialTimeout("tcp", net.JoinHostPort("localhost", fmt.Sprintf("%d", message.Target.Port)), defaultPortAccessProbeTimeout)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to upstream tcp target on port %d: %w", message.Target.Port, err)
	}
	if message.UpstreamProtocol == "http" {
		return connection, nil
	}
	tlsConnection := tls.Client(connection, &tls.Config{
		ServerName:         "localhost",
		InsecureSkipVerify: true,
	})
	if err := tlsConnection.SetDeadline(time.Now().Add(defaultPortAccessProbeTimeout)); err != nil {
		connection.Close()
		return nil, err
	}
	if err := tlsConnection.Handshake(); err != nil {
		connection.Close()
		return nil, fmt.Errorf("failed to complete upstream tcp tls handshake: %w", err)
	}
	return tlsConnection, nil
}
