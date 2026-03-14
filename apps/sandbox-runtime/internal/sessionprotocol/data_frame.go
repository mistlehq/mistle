package sessionprotocol

import (
	"encoding/binary"
	"fmt"
)

const (
	DataFrameHeaderByteLength  = 6
	DataFrameKindData          = 0x01
	PayloadKindRawBytes        = 0x01
	PayloadKindWebSocketText   = 0x02
	PayloadKindWebSocketBinary = 0x03
	MaxStreamID                = 0xffff_ffff
	DefaultStreamWindowBytes   = 64 * 1024
)

type StreamDataFrame struct {
	FrameKind   byte
	StreamID    uint32
	PayloadKind byte
	Payload     []byte
}

func validateStreamID(streamID uint32) error {
	if streamID == 0 || streamID > MaxStreamID {
		return fmt.Errorf("streamId must be an integer between 1 and %d", MaxStreamID)
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

func EncodeDataFrame(input struct {
	StreamID    uint32
	PayloadKind byte
	Payload     []byte
}) ([]byte, error) {
	if err := validateStreamID(input.StreamID); err != nil {
		return nil, err
	}
	if err := validatePayloadKind(input.PayloadKind); err != nil {
		return nil, err
	}

	encoded := make([]byte, DataFrameHeaderByteLength+len(input.Payload))
	encoded[0] = DataFrameKindData
	binary.BigEndian.PutUint32(encoded[1:5], input.StreamID)
	encoded[5] = input.PayloadKind
	copy(encoded[DataFrameHeaderByteLength:], input.Payload)
	return encoded, nil
}

func DecodeDataFrame(encoded []byte) (StreamDataFrame, error) {
	if len(encoded) < DataFrameHeaderByteLength {
		return StreamDataFrame{}, fmt.Errorf(
			"data frame must be at least %d bytes long",
			DataFrameHeaderByteLength,
		)
	}

	frameKind := encoded[0]
	if frameKind != DataFrameKindData {
		return StreamDataFrame{}, fmt.Errorf("frameKind is not supported: %d", frameKind)
	}

	streamID := binary.BigEndian.Uint32(encoded[1:5])
	if err := validateStreamID(streamID); err != nil {
		return StreamDataFrame{}, err
	}

	payloadKind := encoded[5]
	if err := validatePayloadKind(payloadKind); err != nil {
		return StreamDataFrame{}, err
	}

	payload := make([]byte, len(encoded)-DataFrameHeaderByteLength)
	copy(payload, encoded[DataFrameHeaderByteLength:])

	return StreamDataFrame{
		FrameKind:   frameKind,
		StreamID:    streamID,
		PayloadKind: payloadKind,
		Payload:     payload,
	}, nil
}
