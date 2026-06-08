//go:build unix

package bootstrap

import (
	"os"
	"strings"
	"syscall"
	"testing"
)

func TestExecRuntimeRejectsInvalidEnvironmentEntryName(t *testing.T) {
	err := ExecRuntime(ExecRuntimeInput{
		UID:     uint32(os.Geteuid()),
		GID:     uint32(os.Getegid()),
		Command: "/definitely/missing/runtime",
		Args:    []string{"runtime-internal"},
		Env:     []ProcessEnvironmentEntry{{Name: "BAD=NAME", Value: "value"}},
	})

	assertErrorContains(t, err, "runtime environment entry name must not contain '='")
}

func TestExecRuntimeRejectsBlankEnvironmentEntryName(t *testing.T) {
	err := ExecRuntime(ExecRuntimeInput{
		UID:     uint32(os.Geteuid()),
		GID:     uint32(os.Getegid()),
		Command: "/definitely/missing/runtime",
		Args:    []string{"runtime-internal"},
		Env:     []ProcessEnvironmentEntry{{Name: "  ", Value: "value"}},
	})

	assertErrorContains(t, err, "runtime environment entry name is required")
}

func TestExecRuntimeRejectsNULBytesBeforeRuntimeHandoff(t *testing.T) {
	err := ExecRuntime(ExecRuntimeInput{
		UID:     uint32(os.Geteuid()),
		GID:     uint32(os.Getegid()),
		Command: "/definitely/missing/runtime",
		Args:    []string{"runtime\x00internal"},
	})
	assertErrorContains(t, err, "runtime args must not contain NUL bytes")

	err = ExecRuntime(ExecRuntimeInput{
		UID:     uint32(os.Geteuid()),
		GID:     uint32(os.Getegid()),
		Command: "/definitely/missing/runtime",
		Args:    []string{"runtime-internal"},
		Env:     []ProcessEnvironmentEntry{{Name: "RUNTIME", Value: "bad\x00value"}},
	})
	assertErrorContains(t, err, "runtime environment entries must not contain NUL bytes")
}

func TestExecRuntimeRequiresRootForRuntimeHandoff(t *testing.T) {
	err := ExecRuntime(ExecRuntimeInput{
		UID:     uint32(os.Geteuid()),
		GID:     uint32(os.Getegid()),
		Command: "/definitely/missing/runtime",
		Args:    []string{"runtime-internal"},
	})

	if os.Geteuid() == 0 {
		assertErrorContains(t, err, "failed to exec sandbox runtime")
	} else {
		assertErrorContains(t, err, "sandbox bootstrap must still be running as root")
	}
}

func TestClearCloseOnExecForDescriptor(t *testing.T) {
	file, err := os.Open("/dev/null")
	requireNoError(t, err)
	defer file.Close()
	_, _, errno := syscall.Syscall(syscall.SYS_FCNTL, file.Fd(), uintptr(syscall.F_SETFD), uintptr(syscall.FD_CLOEXEC))
	if errno != 0 {
		t.Fatalf("expected setting close-on-exec to succeed, got %v", errno)
	}

	requireNoError(t, ClearCloseOnExec(int(file.Fd())))

	flags, _, errno := syscall.Syscall(syscall.SYS_FCNTL, file.Fd(), uintptr(syscall.F_GETFD), 0)
	if errno != 0 {
		t.Fatalf("expected reading descriptor flags to succeed, got %v", errno)
	}
	if flags&uintptr(syscall.FD_CLOEXEC) != 0 {
		t.Fatalf("expected close-on-exec to be cleared")
	}
}

func assertErrorContains(t *testing.T, err error, expected string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected error containing %q, got nil", expected)
	}
	if !strings.Contains(err.Error(), expected) {
		t.Fatalf("expected error containing %q, got %q", expected, err.Error())
	}
}

func requireNoError(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
}
