//go:build linux

package tunnel

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestForegroundPTYCommandExitsWhenSessionTerminates(t *testing.T) {
	testDir := t.TempDir()
	shellPIDPath := filepath.Join(testDir, "shell.pid")
	command := "/bin/sh"

	session, err := StartScopedPTYSession(PTYSpawnRequest{
		Command: &command,
		Args:    []string{"-lc", "echo $$ > " + shellPIDPath + "; sleep 30"},
	}, filepath.Join(testDir, "cgroup-root"), "sbi_pty_liveness")
	requireNoError(t, err)
	defer session.Close()

	shellPID := readPIDFileWithRetry(t, shellPIDPath)
	_, err = session.Terminate(DefaultPTYTerminatePollInterval, DefaultPTYTerminateTimeout)
	requireNoError(t, err)

	waitForProcessExit(t, shellPID)
}

func TestBackgroundedProcessCanSurvivePTYTermination(t *testing.T) {
	testDir := t.TempDir()
	backgroundPIDPath := filepath.Join(testDir, "background.pid")
	command := "/bin/sh"

	session, err := StartScopedPTYSession(PTYSpawnRequest{
		Command: &command,
		Args: []string{
			"-lc",
			"nohup sh -c 'echo $$ > " + backgroundPIDPath + "; sleep 30' >/dev/null 2>&1 & cat",
		},
	}, filepath.Join(testDir, "cgroup-root"), "sbi_pty_liveness")
	requireNoError(t, err)
	defer session.Close()

	backgroundPID := readPIDFileWithRetry(t, backgroundPIDPath)
	_, err = session.Terminate(DefaultPTYTerminatePollInterval, DefaultPTYTerminateTimeout)
	requireNoError(t, err)

	if !processIsAlive(backgroundPID) {
		t.Fatalf("backgrounded child should survive PTY termination")
	}
	killProcess(backgroundPID)
}

func TestDetachedSessionEquivalentCanSurvivePTYTermination(t *testing.T) {
	testDir := t.TempDir()
	detachedPIDPath := filepath.Join(testDir, "detached.pid")
	command := "/bin/sh"

	session, err := StartScopedPTYSession(PTYSpawnRequest{
		Command: &command,
		Args: []string{
			"-lc",
			"setsid sh -c 'echo $$ > " + detachedPIDPath + "; sleep 30' >/dev/null 2>&1 < /dev/null & cat",
		},
	}, filepath.Join(testDir, "cgroup-root"), "sbi_pty_liveness")
	requireNoError(t, err)
	defer session.Close()

	detachedPID := readPIDFileWithRetry(t, detachedPIDPath)
	_, err = session.Terminate(DefaultPTYTerminatePollInterval, DefaultPTYTerminateTimeout)
	requireNoError(t, err)

	if !processIsAlive(detachedPID) {
		t.Fatalf("detached child should survive PTY termination")
	}
	killProcess(detachedPID)
}

func readPIDFileWithRetry(t *testing.T, path string) int {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		content, err := os.ReadFile(path)
		if err == nil {
			trimmed := strings.TrimSpace(string(content))
			if trimmed != "" {
				pid, parseErr := strconv.Atoi(trimmed)
				requireNoError(t, parseErr)
				return pid
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for pid file %s", path)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func waitForProcessExit(t *testing.T, pid int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		if !processIsAlive(pid) {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for process %d to exit", pid)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func processIsAlive(pid int) bool {
	_, err := os.Stat(filepath.Join("/proc", strconv.Itoa(pid)))
	return err == nil
}

func killProcess(pid int) {
	_ = syscall.Kill(pid, syscall.SIGKILL)
}
