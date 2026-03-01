package main

import (
	"bytes"
	"testing"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/config"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/runtime"
)

func TestRunWithInput(t *testing.T) {
	t.Run("fails when runtime listen addr env is missing", func(t *testing.T) {
		err := runWithInput(runtime.RunInput{
			Stdin: bytes.NewBufferString(
				`{"bootstrapToken":"test-token","tunnelGatewayWsUrl":"ws://127.0.0.1:5003/tunnel/sandbox","runtimePlan":{"sandboxProfileId":"sbp_test","version":1,"image":{"source":"default-base","imageRef":"mistle/sandbox-base:dev"},"egressRoutes":[],"artifacts":[],"runtimeClientSetups":[]}}`,
			),
			LookupEnv: func(string) (string, bool) {
				return "", false
			},
		})
		if err == nil {
			t.Fatal("expected error when runtime listen addr env is missing")
		}
	})

	t.Run("fails when bootstrap token stdin is empty", func(t *testing.T) {
		err := runWithInput(runtime.RunInput{
			Stdin: bytes.NewBufferString("\n \t\n"),
			LookupEnv: func(key string) (string, bool) {
				if key == config.ListenAddrEnv {
					return ":8090", true
				}
				return "", false
			},
		})
		if err == nil {
			t.Fatal("expected error when bootstrap token stdin is empty")
		}
	})
}
