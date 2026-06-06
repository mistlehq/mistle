package protocol

import (
	"encoding/binary"
	"fmt"
)

const (
	DefaultStreamWindowBytes = 16 * 1024 * 1024
	AgentStreamWindowBytes   = 16 * 1024 * 1024
	MaxStreamWindowBytes     = AgentStreamWindowBytes

	DataFrameKind      = byte(0x01)
	DataFrameHeaderLen = 6

	PayloadKindRawBytes        = byte(0x01)
	PayloadKindWebSocketText   = byte(0x02)
	PayloadKindWebSocketBinary = byte(0x03)
)

type StreamDataFrame struct {
	StreamID    uint32
	PayloadKind byte
	Payload     []byte
}

func EncodeStreamDataFrame(streamID uint32, payloadKind byte, payload []byte) ([]byte, error) {
	if err := validateStreamID(streamID); err != nil {
		return nil, err
	}
	if err := validatePayloadKind(payloadKind); err != nil {
		return nil, err
	}

	encoded := make([]byte, DataFrameHeaderLen+len(payload))
	encoded[0] = DataFrameKind
	binary.BigEndian.PutUint32(encoded[1:5], streamID)
	encoded[5] = payloadKind
	copy(encoded[DataFrameHeaderLen:], payload)
	return encoded, nil
}

func DecodeStreamDataFrame(payload []byte) (StreamDataFrame, error) {
	if len(payload) < DataFrameHeaderLen {
		return StreamDataFrame{}, fmt.Errorf("data frame must be at least %d bytes long", DataFrameHeaderLen)
	}
	if payload[0] != DataFrameKind {
		return StreamDataFrame{}, fmt.Errorf("frameKind is not supported: %d", payload[0])
	}
	streamID := binary.BigEndian.Uint32(payload[1:5])
	if err := validateStreamID(streamID); err != nil {
		return StreamDataFrame{}, err
	}
	payloadKind := payload[5]
	if err := validatePayloadKind(payloadKind); err != nil {
		return StreamDataFrame{}, err
	}

	framePayload := make([]byte, len(payload)-DataFrameHeaderLen)
	copy(framePayload, payload[DataFrameHeaderLen:])
	return StreamDataFrame{
		StreamID:    streamID,
		PayloadKind: payloadKind,
		Payload:     framePayload,
	}, nil
}

func validateStreamID(streamID uint32) error {
	if streamID == 0 {
		return fmt.Errorf("streamId must be an integer between 1 and 4294967295")
	}
	return nil
}

func validatePayloadKind(payloadKind byte) error {
	switch payloadKind {
	case PayloadKindRawBytes, PayloadKindWebSocketText, PayloadKindWebSocketBinary:
		return nil
	default:
		return fmt.Errorf("payloadKind is not supported: %d", payloadKind)
	}
}
