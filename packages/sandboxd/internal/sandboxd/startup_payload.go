package sandboxd

import (
	"fmt"
	"io"
)

type StartupPayloadSourceKind string

const (
	StartupPayloadUntilEOF StartupPayloadSourceKind = "stdin-until-eof"
	StartupPayloadBytes    StartupPayloadSourceKind = "stdin-bytes"
)

type StartupPayloadSource struct {
	Kind      StartupPayloadSourceKind
	ByteCount int
}

func ReadStartupPayload(reader io.Reader, source StartupPayloadSource) ([]byte, error) {
	switch source.Kind {
	case StartupPayloadUntilEOF:
		return io.ReadAll(reader)
	case StartupPayloadBytes:
		return readExactBytes(reader, source.ByteCount)
	default:
		return nil, fmt.Errorf("unsupported startup payload source: %s", source.Kind)
	}
}

func readExactBytes(reader io.Reader, byteCount int) ([]byte, error) {
	if byteCount < 0 {
		return nil, fmt.Errorf("startup payload byte count cannot be negative: %d", byteCount)
	}
	buffer := make([]byte, byteCount)
	bytesRead, err := io.ReadFull(reader, buffer)
	if err != nil {
		if err == io.ErrUnexpectedEOF || err == io.EOF {
			return nil, fmt.Errorf("startup payload stdin ended after %d bytes, expected %d", bytesRead, byteCount)
		}
		return nil, err
	}
	return buffer, nil
}
