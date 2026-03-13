//go:build linux

package runtime

import (
	"bufio"
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/config"
)

const runDumpabilityHelperModeEnv = "MISTLE_RUN_DUMPABILITY_HELPER_MODE"

const invalidRuntimePlanStartupInputJSON = `{"bootstrapToken":"test-token","tunnelExchangeToken":"test-exchange-token","tunnelGatewayWsUrl":"ws://127.0.0.1:5003/tunnel/sandbox","runtimePlan":{"sandboxProfileId":"sbp_test","version":1,"image":{"source":"base","imageRef":"mistle/sandbox-base:dev"},"egressRoutes":[],"artifacts":[],"artifactRemovals":[],"runtimeClients":[{"clientId":"client_test","setup":{"env":{},"files":[{"fileId":"file_test","path":"/tmp","mode":420,"content":"invalid-target"}]},"processes":[],"endpoints":[]}],"workspaceSources":[],"agentRuntimes":[]}}`

func TestRunMarksCurrentProcessNonDumpableWithoutProxyCA(t *testing.T) {
	helperCommand := exec.Command(
		os.Args[0],
		"-test.run=^TestRunMarksCurrentProcessNonDumpableWithoutProxyCAHelperProcess$",
	)
	helperCommand.Env = append(os.Environ(), runDumpabilityHelperModeEnv+"=enabled")

	helperStdout, err := helperCommand.StdoutPipe()
	if err != nil {
		t.Fatalf("expected helper stdout pipe creation to succeed, got %v", err)
	}
	var helperStderr bytes.Buffer
	helperCommand.Stderr = &helperStderr

	if err := helperCommand.Start(); err != nil {
		t.Fatalf("expected helper process start to succeed, got %v", err)
	}

	readinessLine, err := bufio.NewReader(helperStdout).ReadString('\n')
	if err != nil {
		_ = helperCommand.Process.Kill()
		_ = helperCommand.Wait()
		t.Fatalf(
			"expected helper readiness line, got read error %v and stderr %s",
			err,
			helperStderr.String(),
		)
	}

	if err := helperCommand.Wait(); err != nil {
		t.Fatalf("expected helper process exit to succeed, got %v and stderr %s", err, helperStderr.String())
	}

	trimmedReadinessLine := strings.TrimSpace(readinessLine)
	if trimmedReadinessLine != "ready dumpable=false" {
		t.Fatalf("expected helper readiness line ready dumpable=false, got %q", trimmedReadinessLine)
	}
}

func TestRunMarksCurrentProcessNonDumpableWithoutProxyCAHelperProcess(t *testing.T) {
	if os.Getenv(runDumpabilityHelperModeEnv) == "" {
		return
	}

	err := Run(RunInput{
		LookupEnv: func(key string) (string, bool) {
			switch key {
			case config.ListenAddrEnv:
				return ":0", true
			case config.TokenizerProxyEgressBaseURLEnv:
				return "http://127.0.0.1:5004/tokenizer-proxy/egress", true
			default:
				return "", false
			}
		},
		Stdin: bytes.NewBufferString(invalidRuntimePlanStartupInputJSON),
	})
	if err == nil {
		fmt.Fprintln(os.Stderr, "expected runtime run to fail")
		os.Exit(1)
	}
	if !strings.Contains(err.Error(), "failed to apply runtime plan") {
		fmt.Fprintf(os.Stderr, "expected runtime plan apply failure, got %v\n", err)
		os.Exit(1)
	}

	dumpable, dumpableErr := currentProcessDumpable()
	if dumpableErr != nil {
		fmt.Fprintf(os.Stderr, "failed to inspect helper dumpable state: %v\n", dumpableErr)
		os.Exit(1)
	}

	if _, printErr := fmt.Fprintf(os.Stdout, "ready dumpable=%t\n", dumpable); printErr != nil {
		fmt.Fprintf(os.Stderr, "failed to write helper readiness line: %v\n", printErr)
		os.Exit(1)
	}

	os.Exit(0)
}
