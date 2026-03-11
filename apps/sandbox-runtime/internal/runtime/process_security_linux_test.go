//go:build linux

package runtime

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"testing"

	"golang.org/x/sys/unix"
)

const dumpabilityHelperModeEnv = "MISTLE_DUMPABILITY_HELPER_MODE"

func TestMarkCurrentProcessNonDumpable(t *testing.T) {
	t.Run("reports non-dumpable state in a child process", func(t *testing.T) {
		childProcess := startDumpabilityHelperProcess(t, "non-dumpable")
		defer childProcess.close(t)

		if childProcess.dumpable {
			t.Fatal("expected helper process to report non-dumpable state")
		}
	})

	t.Run("blocks ptrace attach after the process is marked non-dumpable", func(t *testing.T) {
		childProcess := startDumpabilityHelperProcess(t, "non-dumpable")
		defer childProcess.close(t)

		err := unix.PtraceAttach(childProcess.pid)
		if err == nil {
			_ = unix.PtraceDetach(childProcess.pid)
			t.Fatal("expected ptrace attach to non-dumpable process to fail")
		}
		if !errors.Is(err, unix.EPERM) {
			t.Fatalf("expected ptrace attach to fail with EPERM, got %v", err)
		}
	})

	t.Run("allows ptrace attach before the process is marked non-dumpable", func(t *testing.T) {
		childProcess := startDumpabilityHelperProcess(t, "dumpable")
		defer childProcess.close(t)

		if !childProcess.dumpable {
			t.Fatal("expected helper process to report dumpable state")
		}

		err := unix.PtraceAttach(childProcess.pid)
		if err != nil {
			t.Fatalf("expected ptrace attach to dumpable process to succeed, got %v", err)
		}

		var waitStatus unix.WaitStatus
		waitedPID, err := unix.Wait4(childProcess.pid, &waitStatus, 0, nil)
		if err != nil {
			t.Fatalf("expected wait for ptraced process to succeed, got %v", err)
		}
		if waitedPID != childProcess.pid {
			t.Fatalf("expected to wait for pid %d, got %d", childProcess.pid, waitedPID)
		}
		if !waitStatus.Stopped() {
			t.Fatalf("expected ptrace-attached process to stop, got status %#v", waitStatus)
		}

		if err := unix.PtraceDetach(childProcess.pid); err != nil {
			t.Fatalf("expected ptrace detach to succeed, got %v", err)
		}
	})
}

func TestDumpabilityHelperProcess(t *testing.T) {
	helperMode := os.Getenv(dumpabilityHelperModeEnv)
	if helperMode == "" {
		return
	}

	switch helperMode {
	case "non-dumpable":
		if err := markCurrentProcessNonDumpable(); err != nil {
			fmt.Fprintf(os.Stderr, "failed to mark helper process non-dumpable: %v\n", err)
			os.Exit(1)
		}
	case "dumpable":
	default:
		fmt.Fprintf(os.Stderr, "unexpected helper mode %q\n", helperMode)
		os.Exit(1)
	}

	dumpable, err := currentProcessDumpable()
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to inspect helper dumpable state: %v\n", err)
		os.Exit(1)
	}

	if _, err := fmt.Fprintf(os.Stdout, "ready dumpable=%t\n", dumpable); err != nil {
		fmt.Fprintf(os.Stderr, "failed to write helper readiness line: %v\n", err)
		os.Exit(1)
	}

	_, _ = bufio.NewReader(os.Stdin).ReadString('\n')
	os.Exit(0)
}

type dumpabilityHelperProcess struct {
	command  *exec.Cmd
	stdin    io.WriteCloser
	pid      int
	dumpable bool
}

func startDumpabilityHelperProcess(t *testing.T, helperMode string) dumpabilityHelperProcess {
	t.Helper()

	command := exec.Command(os.Args[0], "-test.run=^TestDumpabilityHelperProcess$")
	command.Env = append(os.Environ(), dumpabilityHelperModeEnv+"="+helperMode)
	var stderrBuffer bytes.Buffer
	command.Stderr = &stderrBuffer

	stdoutPipe, err := command.StdoutPipe()
	if err != nil {
		t.Fatalf("expected helper stdout pipe creation to succeed, got %v", err)
	}

	stdinPipe, err := command.StdinPipe()
	if err != nil {
		t.Fatalf("expected helper stdin pipe creation to succeed, got %v", err)
	}

	if err := command.Start(); err != nil {
		t.Fatalf("expected helper process start to succeed, got %v", err)
	}

	readinessReader := bufio.NewReader(stdoutPipe)
	readinessLine, err := readinessReader.ReadString('\n')
	if err != nil {
		_ = command.Process.Kill()
		_ = command.Wait()
		t.Fatalf(
			"expected helper readiness line, got read error %v and stderr %s",
			err,
			stderrBuffer.String(),
		)
	}
	if strings.TrimSpace(stderrBuffer.String()) != "" {
		_ = command.Process.Kill()
		_ = command.Wait()
		t.Fatalf("expected empty helper stderr, got %s", stderrBuffer.String())
	}

	dumpable, err := parseHelperReadiness(readinessLine)
	if err != nil {
		_ = command.Process.Kill()
		_ = command.Wait()
		t.Fatalf("expected helper readiness line to parse, got %v", err)
	}

	return dumpabilityHelperProcess{
		command:  command,
		stdin:    stdinPipe,
		pid:      command.Process.Pid,
		dumpable: dumpable,
	}
}

func (process dumpabilityHelperProcess) close(t *testing.T) {
	t.Helper()

	if process.stdin != nil {
		_, _ = io.WriteString(process.stdin, "\n")
		_ = process.stdin.Close()
	}

	if err := process.command.Wait(); err != nil {
		t.Fatalf("expected helper process exit to succeed, got %v", err)
	}
}

func parseHelperReadiness(readinessLine string) (bool, error) {
	const readinessPrefix = "ready dumpable="

	trimmedLine := strings.TrimSpace(readinessLine)
	if !strings.HasPrefix(trimmedLine, readinessPrefix) {
		return false, fmt.Errorf("unexpected readiness line %q", trimmedLine)
	}

	dumpableValue, err := strconv.ParseBool(strings.TrimPrefix(trimmedLine, readinessPrefix))
	if err != nil {
		return false, fmt.Errorf("invalid readiness dumpable value: %w", err)
	}

	return dumpableValue, nil
}
