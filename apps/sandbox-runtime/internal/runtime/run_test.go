package runtime

import (
	"bytes"
	"strings"
	"testing"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/config"
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

	t.Run("fails when runtime plan apply fails", func(t *testing.T) {
		startupInputJSON := `{"bootstrapToken":"test-token","tunnelGatewayWsUrl":"ws://127.0.0.1:5003/tunnel/sandbox","runtimePlan":{"sandboxProfileId":"sbp_test","version":1,"image":{"source":"default-base","imageRef":"mistle/sandbox-base:dev"},"egressRoutes":[],"artifacts":[],"runtimeClientSetups":[{"clientId":"client_test","env":{},"files":[{"fileId":"file_test","path":"/tmp","mode":420,"content":"invalid-target"}]}]}}`

		err := Run(RunInput{
			LookupEnv: func(key string) (string, bool) {
				switch key {
				case config.ListenAddrEnv:
					return ":8090", true
				case config.TokenizerProxyEgressBaseURLEnv:
					return "http://127.0.0.1:5004/tokenizer-proxy/egress", true
				default:
					return "", false
				}
			},
			Stdin: bytes.NewBufferString(startupInputJSON),
		})
		if err == nil {
			t.Fatal("expected error when runtime plan apply fails")
		}
		if !strings.Contains(err.Error(), "failed to apply runtime plan") {
			t.Fatalf("expected runtime plan apply failure, got %v", err)
		}
	})
}
