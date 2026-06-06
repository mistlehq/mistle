package protocol

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
)

func decodeStrict(data []byte, output any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(output); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("json payload must contain exactly one value")
	}
	return nil
}
