package sessionprotocol

import (
	"bytes"
	"testing"
)

func TestEncodeDataFrame(t *testing.T) {
	encoded, err := EncodeDataFrame(struct {
		StreamID    uint32
		PayloadKind byte
		Payload     []byte
	}{
		StreamID:    7,
		PayloadKind: PayloadKindRawBytes,
		Payload:     []byte("hello"),
	})
	if err != nil {
		t.Fatalf("expected data frame encode to succeed: %v", err)
	}

	decoded, err := DecodeDataFrame(encoded)
	if err != nil {
		t.Fatalf("expected data frame decode to succeed: %v", err)
	}

	if decoded.FrameKind != DataFrameKindData {
		t.Fatalf("expected frameKind %d, got %d", DataFrameKindData, decoded.FrameKind)
	}
	if decoded.StreamID != 7 {
		t.Fatalf("expected streamId 7, got %d", decoded.StreamID)
	}
	if decoded.PayloadKind != PayloadKindRawBytes {
		t.Fatalf("expected payloadKind %d, got %d", PayloadKindRawBytes, decoded.PayloadKind)
	}
	if !bytes.Equal(decoded.Payload, []byte("hello")) {
		t.Fatalf("expected payload %q, got %q", "hello", decoded.Payload)
	}
}

func TestDecodeDataFrameRejectsShortPayload(t *testing.T) {
	_, err := DecodeDataFrame(make([]byte, DataFrameHeaderByteLength-1))
	if err == nil {
		t.Fatal("expected short data frame decode to fail")
	}
}

func TestDecodeDataFrameRejectsInvalidFrameKind(t *testing.T) {
	encoded := make([]byte, DataFrameHeaderByteLength)
	encoded[0] = 0x02
	encoded[5] = PayloadKindRawBytes

	_, err := DecodeDataFrame(encoded)
	if err == nil {
		t.Fatal("expected invalid frame kind to fail")
	}
}

func TestDecodeDataFrameRejectsInvalidPayloadKind(t *testing.T) {
	encoded := make([]byte, DataFrameHeaderByteLength)
	encoded[0] = DataFrameKindData
	encoded[4] = 1
	encoded[5] = 0x09

	_, err := DecodeDataFrame(encoded)
	if err == nil {
		t.Fatal("expected invalid payload kind to fail")
	}
}

func TestEncodeDataFrameRejectsStreamIDZero(t *testing.T) {
	_, err := EncodeDataFrame(struct {
		StreamID    uint32
		PayloadKind byte
		Payload     []byte
	}{
		StreamID:    0,
		PayloadKind: PayloadKindRawBytes,
		Payload:     []byte("nope"),
	})
	if err == nil {
		t.Fatal("expected streamId zero to fail")
	}
}
