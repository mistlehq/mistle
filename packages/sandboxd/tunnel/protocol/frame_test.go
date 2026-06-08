package protocol

import (
	"bytes"
	"testing"
)

func TestEncodeStreamDataFrameUsesBinaryHeader(t *testing.T) {
	encoded, err := EncodeStreamDataFrame(7, PayloadKindWebSocketText, []byte(`{"jsonrpc":"2.0"}`))
	requireNoError(t, err)

	expected := []byte{
		0x01, 0x00, 0x00, 0x00, 0x07, 0x02, '{', '"', 'j', 's', 'o', 'n', 'r', 'p',
		'c', '"', ':', '"', '2', '.', '0', '"', '}',
	}
	if !bytes.Equal(encoded, expected) {
		t.Fatalf("expected %v, got %v", expected, encoded)
	}
}

func TestDecodeStreamDataFrameReadsBinaryPayload(t *testing.T) {
	decoded, err := DecodeStreamDataFrame([]byte{0x01, 0x00, 0x00, 0x00, 0x09, 0x03, 0xaa, 0xbb})
	requireNoError(t, err)

	assertEqual(t, decoded.StreamID, uint32(9))
	assertEqual(t, decoded.PayloadKind, PayloadKindWebSocketBinary)
	if !bytes.Equal(decoded.Payload, []byte{0xaa, 0xbb}) {
		t.Fatalf("expected binary payload, got %v", decoded.Payload)
	}
}

func TestStreamDataFramePreservesRawBytesPayloadKind(t *testing.T) {
	encoded, err := EncodeStreamDataFrame(2, PayloadKindRawBytes, []byte("bytes"))
	requireNoError(t, err)

	decoded, err := DecodeStreamDataFrame(encoded)
	requireNoError(t, err)

	assertEqual(t, decoded.StreamID, uint32(2))
	assertEqual(t, decoded.PayloadKind, PayloadKindRawBytes)
	if !bytes.Equal(decoded.Payload, []byte("bytes")) {
		t.Fatalf("expected raw bytes payload, got %v", decoded.Payload)
	}
}

func TestDecodeStreamDataFrameRejectsInvalidFrames(t *testing.T) {
	for _, input := range []struct {
		name     string
		payload  []byte
		expected string
	}{
		{name: "short", payload: []byte{0x01}, expected: "data frame must be at least 6 bytes long"},
		{name: "kind", payload: []byte{0x02, 0, 0, 0, 1, 1}, expected: "frameKind is not supported: 2"},
		{name: "stream", payload: []byte{0x01, 0, 0, 0, 0, 1}, expected: "streamId must be an integer between 1 and 4294967295"},
		{name: "payload", payload: []byte{0x01, 0, 0, 0, 1, 9}, expected: "payloadKind is not supported: 9"},
	} {
		t.Run(input.name, func(t *testing.T) {
			_, err := DecodeStreamDataFrame(input.payload)
			assertError(t, err, input.expected)
		})
	}
}

func TestEncodeStreamDataFrameRejectsInvalidStreamID(t *testing.T) {
	_, err := EncodeStreamDataFrame(0, PayloadKindRawBytes, nil)

	assertError(t, err, "streamId must be an integer between 1 and 4294967295")
}

func requireNoError(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
}

func assertError(t *testing.T, err error, expected string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected error %q, got nil", expected)
	}
	assertEqual(t, err.Error(), expected)
}

func assertEqual[T comparable](t *testing.T, actual T, expected T) {
	t.Helper()
	if actual != expected {
		t.Fatalf("expected %v, got %v", expected, actual)
	}
}
