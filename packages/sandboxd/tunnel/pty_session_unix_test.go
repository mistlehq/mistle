//go:build unix

package tunnel

import (
	"bytes"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestPTYSessionRunsCommandAndReportsExit(t *testing.T) {
	command := "/bin/sh"
	session, err := StartPTYSession(PTYSpawnRequest{
		Command: &command,
		Args:    []string{"-lc", "printf 'pty-ok'"},
	})
	requireNoError(t, err)
	defer session.Close()

	var output bytes.Buffer
	exitCode := waitForPTYExit(t, session, &output)

	assertEqual(t, exitCode, 0)
	if !bytes.Contains(output.Bytes(), []byte("pty-ok")) {
		t.Fatalf("expected pty output to contain pty-ok, got %q", output.String())
	}
}

func TestScopedPTYSessionAttachesProcessToUserScope(t *testing.T) {
	command := "/bin/sh"
	cgroupRoot := t.TempDir()
	session, err := StartScopedPTYSession(PTYSpawnRequest{
		Command: &command,
		Args:    []string{"-lc", "printf scoped"},
	}, cgroupRoot, "sbi_pty_scope")
	requireNoError(t, err)
	defer session.Close()

	if session.scopePaths == nil {
		t.Fatalf("expected pty user scope")
	}
	assertEqual(t, readPTYTestFile(t, session.scopePaths.ProcsFile), strconv.FormatUint(uint64(session.ProcessID()), 10)+"\n")
	if scopeName := filepath.Base(session.scopePaths.ScopeRoot); !strings.HasPrefix(scopeName, "pty-") {
		t.Fatalf("expected pty user scope name, got %q", scopeName)
	}
	waitForPTYExit(t, session, nil)
}

func readPTYTestFile(t *testing.T, path string) string {
	t.Helper()
	content, err := os.ReadFile(path)
	requireNoError(t, err)
	return string(content)
}

func waitForPTYExit(t *testing.T, session *PTYSession, output *bytes.Buffer) int {
	t.Helper()
	deadline := time.After(2 * time.Second)
	for {
		select {
		case event := <-session.Events():
			switch event.Kind {
			case PTYEventOutput:
				if output != nil {
					_, _ = output.Write(event.Output)
				}
			case PTYEventExit:
				return event.ExitCode
			case PTYEventError:
				t.Fatalf("unexpected pty error: %s", event.Error)
			}
		case <-deadline:
			t.Fatalf("timed out waiting for pty exit")
		}
	}
}
