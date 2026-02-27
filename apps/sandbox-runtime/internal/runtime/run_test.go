package runtime

import (
	"bytes"
	"testing"
)

func TestRun(t *testing.T) {
	t.Run("fails when lookup env function is missing", func(t *testing.T) {
		err := Run(RunInput{
			Stdin: bytes.NewBufferString("test-token"),
		})
		if err == nil {
			t.Fatal("expected error when lookup env function is missing")
		}
	})

	t.Run("fails when stdin reader is missing", func(t *testing.T) {
		err := Run(RunInput{
			LookupEnv: func(string) (string, bool) {
				return ":8090", true
			},
		})
		if err == nil {
			t.Fatal("expected error when stdin reader is missing")
		}
	})
}
