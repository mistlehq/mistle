package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestRun(t *testing.T) {
	t.Run("writes schema to stdout by default", func(t *testing.T) {
		var output bytes.Buffer
		if err := run([]string{}, &output); err != nil {
			t.Fatalf("expected run to succeed, got %v", err)
		}

		outputText := output.String()
		if !strings.Contains(outputText, "\"SandboxSessionControlMessage\"") {
			t.Fatalf("expected schema output to include schema title, got %s", outputText)
		}
	})

	t.Run("fails on unexpected args", func(t *testing.T) {
		var output bytes.Buffer
		err := run([]string{"unexpected"}, &output)
		if err == nil {
			t.Fatal("expected run to fail on unexpected args")
		}
		if !strings.Contains(err.Error(), "unexpected args") {
			t.Fatalf("expected unexpected args error, got %v", err)
		}
	})
}
