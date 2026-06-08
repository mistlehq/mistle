package tunnel

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/coder/websocket"
	"github.com/mistle/sandboxd/supervision"
	"github.com/mistle/sandboxd/timeutil"
	tunnelprotocol "github.com/mistle/sandboxd/tunnel/protocol"
)

const (
	SandboxTelemetryLogStreamID   = uint32(0xffff_fffe)
	telemetryLogsSignal           = "logs"
	telemetryLogsFormat           = "mistle.sandbox-runtime.log.v1"
	telemetryBufferCapacityBytes  = tunnelprotocol.MaxStreamWindowBytes
	telemetryLogLevelInfo         = "info"
	telemetryLogLevelWarn         = "warn"
	telemetryLogLevelError        = "error"
	telemetryEventEgressStarted   = "egress_token_request_started"
	telemetryEventEgressCompleted = "egress_token_request_completed"
	telemetryEventEgressFailed    = "egress_token_request_failed"
	telemetryEventAgentSummary    = "agent_stream_summary"
	telemetryEventAgentExhausted  = "agent_stream_window_exhausted"
	telemetryEventAgentThreshold  = "agent_stream_window_threshold_crossed"
	telemetryEventControlDropped  = "bootstrap_control_message_dropped"
	telemetryEventFrameDropped    = "bootstrap_data_frame_dropped"
)

var agentStreamWindowThresholdBytes = []uint64{
	1024 * 1024,
	2 * 1024 * 1024,
	4 * 1024 * 1024,
	8 * 1024 * 1024,
	tunnelprotocol.AgentStreamWindowBytes * 95 / 100,
}

type telemetryRelayState struct {
	requested     bool
	opened        bool
	sendWindow    uint64
	bufferedLines [][]byte
	bufferedBytes uint64
}

func (session *LiveTunnelSession) openTelemetryStream(ctx context.Context) error {
	session.mutex.Lock()
	session.telemetry.requested = true
	session.telemetry.opened = false
	session.telemetry.sendWindow = 0
	session.mutex.Unlock()
	payload, err := telemetryOpenPayload()
	if err != nil {
		return err
	}
	return session.writeRawControl(ctx, payload)
}

func (session *LiveTunnelSession) closeTelemetryStream(ctx context.Context) error {
	session.mutex.Lock()
	wasRequested := session.telemetry.requested
	session.telemetry = telemetryRelayState{}
	session.mutex.Unlock()
	if !wasRequested {
		return nil
	}
	payload, err := telemetryClosePayload()
	if err != nil {
		return err
	}
	return session.writeRawControl(ctx, payload)
}

func (session *LiveTunnelSession) handleTelemetryControl(ctx context.Context, payload string) (bool, error) {
	message, err := parseTelemetryControl(payload)
	if err != nil {
		return false, nil
	}
	if message == nil {
		return false, nil
	}
	if message.streamID != SandboxTelemetryLogStreamID {
		return true, nil
	}
	switch message.messageType {
	case "telemetry.open.ok":
		session.mutex.Lock()
		session.telemetry.opened = true
		session.telemetry.sendWindow = message.initialWindowBytes
		session.mutex.Unlock()
		return true, session.flushTelemetry(ctx)
	case "telemetry.window":
		session.mutex.Lock()
		session.telemetry.sendWindow += message.bytes
		session.mutex.Unlock()
		return true, session.flushTelemetry(ctx)
	case "telemetry.open.error":
		session.mutex.Lock()
		session.telemetry = telemetryRelayState{}
		session.mutex.Unlock()
		return true, fmt.Errorf("gateway rejected telemetry stream: %s (%s)", message.message, message.code)
	case "telemetry.reset":
		session.mutex.Lock()
		session.telemetry = telemetryRelayState{}
		session.mutex.Unlock()
		return true, fmt.Errorf("gateway reset telemetry stream: %s (%s)", message.message, message.code)
	default:
		return true, nil
	}
}

func (session *LiveTunnelSession) recordTelemetryLog(ctx context.Context, level string, event string, extraFields map[string]any) error {
	line, err := encodeTelemetryLogLine(session.clock, level, event, extraFields)
	if err != nil {
		return err
	}
	return session.enqueueTelemetryLogLine(ctx, line)
}

func (session *LiveTunnelSession) recordBufferedTelemetryLog(level string, event string, extraFields map[string]any) error {
	line, err := encodeTelemetryLogLine(session.clock, level, event, extraFields)
	if err != nil {
		return err
	}
	return session.bufferTelemetryLogLine(line)
}

func (session *LiveTunnelSession) enqueueTelemetryLogLine(ctx context.Context, line string) error {
	if err := session.bufferTelemetryLogLine(line); err != nil {
		return err
	}
	return session.flushTelemetry(ctx)
}

func (session *LiveTunnelSession) bufferTelemetryLogLine(line string) error {
	session.mutex.Lock()
	if session.telemetry.bufferedBytes+uint64(len(line)) > telemetryBufferCapacityBytes {
		session.mutex.Unlock()
		return fmt.Errorf("telemetry buffer exceeded the configured capacity")
	}
	session.telemetry.bufferedLines = append(session.telemetry.bufferedLines, []byte(line))
	session.telemetry.bufferedBytes += uint64(len(line))
	session.mutex.Unlock()
	return nil
}

func (session *LiveTunnelSession) forwardSupervisorLifecycleEvents(ctx context.Context) {
	if session.supervisorHandle == nil {
		return
	}
	for _, line := range session.supervisorHandle.DrainForwardedLifecycleEventLines() {
		forwardedLine, err := supervision.EncodeForwardedLifecycleEventLogLine(line)
		if err != nil {
			fmt.Fprintf(os.Stderr, "sandboxd failed to encode forwarded lifecycle telemetry: %v\n", err)
			continue
		}
		if err := session.enqueueTelemetryLogLine(ctx, forwardedLine); err != nil {
			fmt.Fprintf(os.Stderr, "sandboxd failed to publish supervisor lifecycle telemetry: %v\n", err)
		}
	}
}

func (session *LiveTunnelSession) flushTelemetry(ctx context.Context) error {
	for {
		session.mutex.Lock()
		if !session.telemetry.opened || len(session.telemetry.bufferedLines) == 0 {
			session.mutex.Unlock()
			return nil
		}
		line := session.telemetry.bufferedLines[0]
		if session.telemetry.sendWindow < uint64(len(line)) {
			session.mutex.Unlock()
			return nil
		}
		session.telemetry.sendWindow -= uint64(len(line))
		session.telemetry.bufferedBytes -= uint64(len(line))
		session.telemetry.bufferedLines = session.telemetry.bufferedLines[1:]
		session.mutex.Unlock()
		encoded, err := tunnelprotocol.EncodeStreamDataFrame(SandboxTelemetryLogStreamID, tunnelprotocol.PayloadKindRawBytes, line)
		if err != nil {
			return err
		}
		session.writeMutex.Lock()
		err = session.connection.Write(ctx, websocket.MessageBinary, encoded)
		session.writeMutex.Unlock()
		if err != nil {
			return err
		}
	}
}

func (session *LiveTunnelSession) recordEgressTokenEvent(ctx context.Context, event string, requestID string, extraFields map[string]any) {
	fields := map[string]any{
		"component":         "TunnelSession",
		"sandboxInstanceId": session.sandboxInstanceID,
		"requestId":         requestID,
	}
	for key, value := range extraFields {
		fields[key] = value
	}
	level := telemetryLogLevelInfo
	if event == telemetryEventEgressFailed {
		level = telemetryLogLevelWarn
	}
	if err := session.recordTelemetryLog(ctx, level, event, fields); err != nil {
		fmt.Fprintf(os.Stderr, "sandboxd failed to publish telemetry event %q: %v\n", event, err)
	}
}

func (session *LiveTunnelSession) publishAgentStreamSummary(ctx context.Context, streamID uint32, stream *liveTunnelStream, outcome string, closeSource string, resetCode string, reason string) {
	if stream == nil || stream.agentStats == nil {
		return
	}
	fields := agentStreamSummaryFields(session.clock, streamID, stream, outcome, closeSource, resetCode, reason)
	if err := session.recordTelemetryLog(ctx, telemetryLogLevelInfo, telemetryEventAgentSummary, fields); err != nil {
		fmt.Fprintf(os.Stderr, "sandboxd failed to publish telemetry event %q: %v\n", telemetryEventAgentSummary, err)
	}
}

func (session *LiveTunnelSession) bufferAgentStreamSummary(streamID uint32, stream *liveTunnelStream, outcome string, closeSource string, resetCode string, reason string) {
	if stream == nil || stream.agentStats == nil {
		return
	}
	fields := agentStreamSummaryFields(session.clock, streamID, stream, outcome, closeSource, resetCode, reason)
	if err := session.recordBufferedTelemetryLog(telemetryLogLevelInfo, telemetryEventAgentSummary, fields); err != nil {
		fmt.Fprintf(os.Stderr, "sandboxd failed to buffer telemetry event %q: %v\n", telemetryEventAgentSummary, err)
	}
}

func agentStreamSummaryFields(clock timeutil.Clock, streamID uint32, stream *liveTunnelStream, outcome string, closeSource string, resetCode string, reason string) map[string]any {
	fields := map[string]any{
		"streamId":            uint64(streamID),
		"channelKind":         "agent",
		"outcome":             outcome,
		"closeSource":         closeSource,
		"durationMs":          clock.NowMS() - stream.agentStats.openedAtMS,
		"messageCountOut":     stream.agentStats.messageCountOut,
		"messageCountIn":      stream.agentStats.messageCountIn,
		"totalBytesOut":       stream.agentStats.totalBytesOut,
		"totalBytesIn":        stream.agentStats.totalBytesIn,
		"maxMessageBytesOut":  stream.agentStats.maxMessageBytesOut,
		"maxMessageBytesIn":   stream.agentStats.maxMessageBytesIn,
		"maxOutstandingBytes": stream.agentStats.maxOutstandingBytes,
		"avgCreditReturnMs":   stream.agentStats.avgCreditReturnMS(),
		"creditReturnCount":   stream.agentStats.creditReturnCount,
		"resetCode":           nil,
		"reason":              nil,
	}
	if resetCode != "" {
		fields["resetCode"] = resetCode
	}
	if reason != "" {
		fields["reason"] = reason
	}
	return fields
}

func (session *LiveTunnelSession) publishAgentWindowExhausted(ctx context.Context, streamID uint32, stream *liveTunnelStream, payloadKind byte, payloadBytes int) {
	if stream == nil || stream.agentStats == nil {
		return
	}
	fields := map[string]any{
		"streamId":                      uint64(streamID),
		"channelKind":                   "agent",
		"payloadKind":                   telemetryPayloadKindName(payloadKind),
		"payloadBytes":                  uint64(payloadBytes),
		"availableBytes":                stream.window,
		"outstandingBytes":              uint64(tunnelprotocol.AgentStreamWindowBytes) - stream.window,
		"maxWindowBytes":                uint64(tunnelprotocol.AgentStreamWindowBytes),
		"payloadExceedsMaxWindow":       uint64(payloadBytes) > uint64(tunnelprotocol.AgentStreamWindowBytes),
		"payloadExceedsAvailableWindow": uint64(payloadBytes) > stream.window,
		"messageCountOut":               stream.agentStats.messageCountOut,
		"streamAgeMs":                   session.clock.NowMS() - stream.agentStats.openedAtMS,
		"oldestUnackedMs":               stream.agentStats.oldestUnackedAgeMS(session.clock.NowMS()),
	}
	if err := session.recordTelemetryLog(ctx, telemetryLogLevelWarn, telemetryEventAgentExhausted, fields); err != nil {
		fmt.Fprintf(os.Stderr, "sandboxd failed to publish telemetry event %q: %v\n", telemetryEventAgentExhausted, err)
	}
}

func (session *LiveTunnelSession) publishAgentWindowThresholdCrossed(ctx context.Context, telemetry agentStreamThresholdTelemetry) {
	fields := map[string]any{
		"streamId":         uint64(telemetry.streamID),
		"channelKind":      "agent",
		"payloadKind":      telemetryPayloadKindName(telemetry.payloadKind),
		"payloadBytes":     uint64(telemetry.payloadBytes),
		"availableBytes":   telemetry.availableBytes,
		"outstandingBytes": telemetry.outstandingBytes,
		"thresholdBytes":   telemetry.thresholdBytes,
		"maxWindowBytes":   uint64(tunnelprotocol.AgentStreamWindowBytes),
		"messageCountOut":  telemetry.messageCountOut,
		"streamAgeMs":      telemetry.streamAgeMS,
		"oldestUnackedMs":  telemetry.oldestUnackedMS,
	}
	if err := session.recordTelemetryLog(ctx, telemetryLogLevelWarn, telemetryEventAgentThreshold, fields); err != nil {
		fmt.Fprintf(os.Stderr, "sandboxd failed to publish telemetry event %q: %v\n", telemetryEventAgentThreshold, err)
	}
}

func recordAgentInboundMessage(stream *liveTunnelStream, payloadBytes int) {
	if stream == nil || stream.agentStats == nil {
		return
	}
	bytes := uint64(payloadBytes)
	stream.agentStats.messageCountIn++
	stream.agentStats.totalBytesIn += bytes
	stream.agentStats.maxMessageBytesIn = max(stream.agentStats.maxMessageBytesIn, bytes)
}

func recordAgentOutboundMessage(stream *liveTunnelStream, payloadBytes int, sentAtMS uint64, outstandingBytes uint64) {
	if stream == nil || stream.agentStats == nil {
		return
	}
	bytes := uint64(payloadBytes)
	stream.agentStats.messageCountOut++
	stream.agentStats.totalBytesOut += bytes
	stream.agentStats.maxMessageBytesOut = max(stream.agentStats.maxMessageBytesOut, bytes)
	stream.agentStats.maxOutstandingBytes = max(stream.agentStats.maxOutstandingBytes, outstandingBytes)
	stream.agentStats.outstandingSends = append(stream.agentStats.outstandingSends, outstandingAgentSend{
		bytes:    bytes,
		sentAtMS: sentAtMS,
	})
}

func recordAgentCreditRestore(stream *liveTunnelStream, bytes uint64, restoredAtMS uint64) {
	if stream == nil || stream.agentStats == nil {
		return
	}
	remainingBytes := bytes
	for remainingBytes > 0 && len(stream.agentStats.outstandingSends) > 0 {
		frontSend := &stream.agentStats.outstandingSends[0]
		acknowledgedBytes := min(remainingBytes, frontSend.bytes)
		frontSend.bytes -= acknowledgedBytes
		remainingBytes -= acknowledgedBytes
		stream.agentStats.creditReturnCount++
		stream.agentStats.creditReturnTotalMS += restoredAtMS - min(restoredAtMS, frontSend.sentAtMS)
		if frontSend.bytes == 0 {
			stream.agentStats.outstandingSends = stream.agentStats.outstandingSends[1:]
		}
	}
}

func (stats *agentStreamStats) avgCreditReturnMS() any {
	if stats.creditReturnCount == 0 {
		return nil
	}
	return stats.creditReturnTotalMS / stats.creditReturnCount
}

func (stats *agentStreamStats) oldestUnackedAgeMS(nowMS uint64) any {
	if len(stats.outstandingSends) == 0 {
		return nil
	}
	sentAtMS := stats.outstandingSends[0].sentAtMS
	return nowMS - min(nowMS, sentAtMS)
}

func (stats *agentStreamStats) takeNewThresholdCrossings(outstandingBytes uint64) []uint64 {
	var crossed []uint64
	for index, thresholdBytes := range agentStreamWindowThresholdBytes {
		emissionBit := uint8(1 << index)
		if outstandingBytes >= thresholdBytes && stats.thresholdMask&emissionBit == 0 {
			stats.thresholdMask |= emissionBit
			crossed = append(crossed, thresholdBytes)
		}
	}
	return crossed
}

func telemetryPayloadKindName(payloadKind byte) string {
	switch payloadKind {
	case tunnelprotocol.PayloadKindWebSocketText:
		return "websocket_text"
	case tunnelprotocol.PayloadKindWebSocketBinary:
		return "websocket_binary"
	case tunnelprotocol.PayloadKindRawBytes:
		return "raw_bytes"
	default:
		return "unknown"
	}
}

func encodeTelemetryLogLine(clock timeutil.Clock, level string, event string, extraFields map[string]any) (string, error) {
	if clock == nil {
		return "", fmt.Errorf("telemetry log clock is required")
	}
	switch level {
	case telemetryLogLevelInfo, telemetryLogLevelWarn, telemetryLogLevelError:
	default:
		return "", fmt.Errorf("sandbox telemetry log level %q is unsupported", level)
	}
	if event == "" {
		return "", fmt.Errorf("sandbox telemetry log event must not be empty")
	}
	payload := map[string]any{
		"timestamp": timeutil.FormatRFC3339Timestamp(clock.NowSystemTime()),
		"level":     level,
		"event":     event,
	}
	for key, value := range extraFields {
		if key == "" {
			return "", fmt.Errorf("sandbox telemetry log field name must not be empty")
		}
		switch key {
		case "timestamp", "level", "event":
			return "", fmt.Errorf("sandbox telemetry log field %q is reserved", key)
		}
		if !telemetryScalar(value) {
			return "", fmt.Errorf("sandbox telemetry log field %q must be scalar", key)
		}
		payload[key] = value
	}
	serialized, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return string(serialized) + "\n", nil
}

func telemetryScalar(value any) bool {
	switch value.(type) {
	case nil, bool, string, float64, float32, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64, json.Number:
		return true
	default:
		return false
	}
}

type telemetryControlMessage struct {
	messageType        string
	streamID           uint32
	initialWindowBytes uint64
	bytes              uint64
	code               string
	message            string
}

func parseTelemetryControl(payload string) (*telemetryControlMessage, error) {
	var raw struct {
		Type               string `json:"type"`
		StreamID           uint32 `json:"streamId"`
		InitialWindowBytes uint64 `json:"initialWindowBytes"`
		Bytes              uint64 `json:"bytes"`
		Code               string `json:"code"`
		Message            string `json:"message"`
	}
	if err := json.Unmarshal([]byte(payload), &raw); err != nil {
		return nil, err
	}
	switch raw.Type {
	case "telemetry.open.ok":
		if raw.InitialWindowBytes == 0 {
			return nil, fmt.Errorf("telemetry.open.ok initialWindowBytes must be a positive integer")
		}
	case "telemetry.window":
		if raw.Bytes == 0 {
			return nil, fmt.Errorf("telemetry.window bytes must be a positive integer")
		}
	case "telemetry.open.error", "telemetry.reset":
		if raw.Code == "" || raw.Message == "" {
			return nil, fmt.Errorf("%s code and message are required", raw.Type)
		}
	default:
		if len(raw.Type) >= len("telemetry.") && raw.Type[:len("telemetry.")] == "telemetry." {
			return &telemetryControlMessage{messageType: raw.Type, streamID: raw.StreamID}, nil
		}
		return nil, nil
	}
	return &telemetryControlMessage{
		messageType:        raw.Type,
		streamID:           raw.StreamID,
		initialWindowBytes: raw.InitialWindowBytes,
		bytes:              raw.Bytes,
		code:               raw.Code,
		message:            raw.Message,
	}, nil
}

func telemetryOpenPayload() (string, error) {
	return marshalTelemetryControlPayload(map[string]any{
		"type":     "telemetry.open",
		"streamId": SandboxTelemetryLogStreamID,
		"signal":   telemetryLogsSignal,
		"format":   telemetryLogsFormat,
	})
}

func telemetryClosePayload() (string, error) {
	return marshalTelemetryControlPayload(map[string]any{
		"type":     "telemetry.close",
		"streamId": SandboxTelemetryLogStreamID,
	})
}

func marshalTelemetryControlPayload(payload map[string]any) (string, error) {
	serialized, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return string(serialized), nil
}
