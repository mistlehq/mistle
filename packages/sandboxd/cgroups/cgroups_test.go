package cgroups

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"syscall"
	"testing"
)

func TestCreatesSandboxTreeAndUserScopePaths(t *testing.T) {
	tempRoot := t.TempDir()

	sandboxPaths, err := EnsureSandboxTree(tempRoot, "sbi_123")
	requireNoError(t, err)
	scopePaths, err := CreateUserScope(tempRoot, "sbi_123", "scope_123")
	requireNoError(t, err)

	assertDirectory(t, sandboxPaths.PlatformRoot)
	assertDirectory(t, sandboxPaths.UserRoot)
	assertDirectory(t, scopePaths.ScopeRoot)
	assertEqual(t, scopePaths.ScopeRoot, filepath.Join(tempRoot, "sbi_123", "user", "scope_123"))
}

func TestWritesPIDAndKillRequestsIntoScopeFiles(t *testing.T) {
	scopePaths, err := CreateUserScope(t.TempDir(), "sbi_123", "scope_123")
	requireNoError(t, err)

	requireNoError(t, AttachPIDToScope(scopePaths, 4242))
	requireNoError(t, KillScope(scopePaths))

	assertFileText(t, scopePaths.ProcsFile, "4242\n")
	assertFileText(t, scopePaths.KillFile, "1\n")
}

func TestCreatesPlatformScopePaths(t *testing.T) {
	tempRoot := t.TempDir()

	scopePaths, err := CreatePlatformScope(tempRoot, "sbi_123", "runtime_0")
	requireNoError(t, err)

	assertDirectory(t, scopePaths.ScopeRoot)
	assertEqual(t, scopePaths.ScopeRoot, filepath.Join(tempRoot, "sbi_123", "platform", "runtime_0"))
}

func TestParsesProcessIDsFromScopeProcsFile(t *testing.T) {
	scopePaths, err := CreateUserScope(t.TempDir(), "sbi_123", "scope_123")
	requireNoError(t, err)
	requireNoError(t, os.WriteFile(scopePaths.ProcsFile, []byte("42\n7\n42\n\n"), 0o644))

	processIDs, err := ReadScopeProcessIDs(scopePaths)
	requireNoError(t, err)

	expected := map[uint32]struct{}{7: {}, 42: {}}
	if !reflect.DeepEqual(processIDs, expected) {
		t.Fatalf("expected %#v, got %#v", expected, processIDs)
	}
}

func TestRejectsInvalidProcessIDsFromScopeProcsFile(t *testing.T) {
	scopePaths, err := CreateUserScope(t.TempDir(), "sbi_123", "scope_123")
	requireNoError(t, err)
	requireNoError(t, os.WriteFile(scopePaths.ProcsFile, []byte("not-a-pid\n"), 0o644))

	_, err = ReadScopeProcessIDs(scopePaths)

	var cgroupErr *CgroupError
	if !errors.As(err, &cgroupErr) {
		t.Fatalf("expected cgroup error, got %T: %v", err, err)
	}
	assertEqual(t, cgroupErr.Kind, CgroupInvalidProcessID)
	assertEqual(t, cgroupErr.Value, "not-a-pid")
}

func TestKillsEveryUserScopeForASandbox(t *testing.T) {
	tempRoot := t.TempDir()
	firstScope, err := CreateUserScope(tempRoot, "sbi_123", "scope_1")
	requireNoError(t, err)
	secondScope, err := CreateUserScope(tempRoot, "sbi_123", "scope_2")
	requireNoError(t, err)
	otherScope, err := CreateUserScope(tempRoot, "sbi_other", "scope_3")
	requireNoError(t, err)
	requireNoError(t, os.WriteFile(otherScope.KillFile, []byte(""), 0o644))

	requireNoError(t, KillSandboxUserScopes(tempRoot, "sbi_123"))

	assertFileText(t, firstScope.KillFile, "1\n")
	assertFileText(t, secondScope.KillFile, "1\n")
	assertFileText(t, otherScope.KillFile, "")
}

func TestKillingUserScopesIsIdempotentWhenSandboxTreeIsMissing(t *testing.T) {
	requireNoError(t, KillSandboxUserScopes(t.TempDir(), "sbi_missing"))
}

func TestKillsEveryPlatformScopeForASandbox(t *testing.T) {
	tempRoot := t.TempDir()
	firstScope, err := CreatePlatformScope(tempRoot, "sbi_123", "runtime_1")
	requireNoError(t, err)
	secondScope, err := CreatePlatformScope(tempRoot, "sbi_123", "runtime_2")
	requireNoError(t, err)
	otherScope, err := CreatePlatformScope(tempRoot, "sbi_other", "runtime_3")
	requireNoError(t, err)
	requireNoError(t, os.WriteFile(otherScope.KillFile, []byte(""), 0o644))

	requireNoError(t, KillSandboxPlatformScopes(tempRoot, "sbi_123"))

	assertFileText(t, firstScope.KillFile, "1\n")
	assertFileText(t, secondScope.KillFile, "1\n")
	assertFileText(t, otherScope.KillFile, "")
}

func TestDetectsMissingProcessCgroupWriteErrors(t *testing.T) {
	err := &CgroupError{
		Kind:  CgroupWriteFileError,
		Path:  "/sys/fs/cgroup/mistle/sbi_123/user/scope_123/cgroup.procs",
		Cause: &os.PathError{Op: "write", Path: "cgroup.procs", Err: syscall.Errno(linuxESRCH)},
	}

	assertEqual(t, err.IsMissingProcess(), true)
}

func TestParsesPopulatedFlagFromCgroupEvents(t *testing.T) {
	scopePaths, err := CreateUserScope(t.TempDir(), "sbi_123", "scope_123")
	requireNoError(t, err)

	requireNoError(t, os.WriteFile(scopePaths.EventsFile, []byte("populated 1\nfrozen 0\n"), 0o644))
	populated, err := IsScopePopulated(scopePaths)
	requireNoError(t, err)
	assertEqual(t, populated, true)

	requireNoError(t, os.WriteFile(scopePaths.EventsFile, []byte("populated 0\n"), 0o644))
	populated, err = IsScopePopulated(scopePaths)
	requireNoError(t, err)
	assertEqual(t, populated, false)
}

func TestRejectsInvalidEventsPayloads(t *testing.T) {
	scopePaths, err := CreateUserScope(t.TempDir(), "sbi_123", "scope_123")
	requireNoError(t, err)

	requireNoError(t, os.WriteFile(scopePaths.EventsFile, []byte("populated 2\n"), 0o644))
	_, err = IsScopePopulated(scopePaths)
	assertCgroupErrorKind(t, err, CgroupInvalidPopulatedValue)

	requireNoError(t, os.WriteFile(scopePaths.EventsFile, []byte("frozen 0\n"), 0o644))
	_, err = IsScopePopulated(scopePaths)
	assertCgroupErrorKind(t, err, CgroupMissingPopulatedField)
}

func TestRejectsInvalidPathSegments(t *testing.T) {
	_, err := EnsureSandboxTree(t.TempDir(), "../sbi")
	assertCgroupErrorKind(t, err, CgroupInvalidSandboxInstanceID)

	_, err = CreateUserScope(t.TempDir(), "sbi_123", ".")
	assertCgroupErrorKind(t, err, CgroupInvalidScopeID)
}

func assertCgroupErrorKind(t *testing.T, err error, expected CgroupErrorKind) {
	t.Helper()
	var cgroupErr *CgroupError
	if !errors.As(err, &cgroupErr) {
		t.Fatalf("expected cgroup error kind %s, got %T: %v", expected, err, err)
	}
	assertEqual(t, cgroupErr.Kind, expected)
}

func assertDirectory(t *testing.T, path string) {
	t.Helper()
	info, err := os.Stat(path)
	requireNoError(t, err)
	if !info.IsDir() {
		t.Fatalf("expected %s to be a directory", path)
	}
}

func assertFileText(t *testing.T, path string, expected string) {
	t.Helper()
	content, err := os.ReadFile(path)
	requireNoError(t, err)
	assertEqual(t, string(content), expected)
}

func requireNoError(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
}

func assertEqual[T comparable](t *testing.T, actual T, expected T) {
	t.Helper()
	if actual != expected {
		t.Fatalf("expected %v, got %v", expected, actual)
	}
}
