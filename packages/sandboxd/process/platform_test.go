package process

import (
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/mistle/sandboxd/runtime"
	"github.com/mistle/sandboxd/supervision"
	"github.com/mistle/sandboxd/timeutil"
)

func TestPlatformScopedProcessManagerAttachesStartedProcessAndCleansRegistryOnStop(t *testing.T) {
	registry := &PlatformProcessRegistry{}
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sandbox-123",
		timeutil.SystemClock{},
		nil,
	)
	requireNoError(t, err)
	processSpec := managerProcessSpec("worker", []string{"/bin/sleep", "30"})

	manager, err := StartRuntimeClientProcessManagerWithPlatformScopes(
		[]RuntimeClientProcessSpec{processSpec},
		timeutil.SystemClock{},
		timeutil.ThreadSleeper{},
		supervisorHandle,
		PlatformProcessScopeInput{
			CgroupRoot:        t.TempDir(),
			SandboxInstanceID: "sbi_123",
			Registry:          registry,
		},
	)
	requireNoError(t, err)

	snapshot := requireOnlyPlatformScopeSnapshot(t, registry)
	assertEqual(t, snapshot.ProcessKey, "worker")
	assertFileText(t, snapshot.ScopePaths.ProcsFile, strconv.Itoa(int(snapshot.SupervisedRootPID))+"\n")

	requireNoError(t, manager.Stop(timeutil.SystemClock{}, timeutil.ThreadSleeper{}))

	assertFileText(t, snapshot.ScopePaths.KillFile, "1\n")
	snapshots, err := registry.Snapshots()
	requireNoError(t, err)
	assertEqual(t, len(snapshots), 0)
}

func TestPlatformScopedCodexRestartUpdatesRegisteredRootPID(t *testing.T) {
	registry := &PlatformProcessRegistry{}
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sandbox-123",
		timeutil.SystemClock{},
		[]supervision.SupervisedComponent{supervision.ComponentCodexAppServer},
	)
	requireNoError(t, err)
	processSpec := managerProcessSpec(CodexAppServerProcessKey, []string{"/bin/sleep", "30"})
	manager, err := StartRuntimeClientProcessManagerWithPlatformScopes(
		[]RuntimeClientProcessSpec{processSpec},
		timeutil.SystemClock{},
		timeutil.ThreadSleeper{},
		supervisorHandle,
		PlatformProcessScopeInput{
			CgroupRoot:        t.TempDir(),
			SandboxInstanceID: "sbi_123",
			Registry:          registry,
		},
	)
	requireNoError(t, err)
	controlHandle := manager.CodexAppServerControlHandle()
	if controlHandle == nil {
		t.Fatalf("expected Codex app-server control handle")
	}
	initialSnapshot := requireOnlyPlatformScopeSnapshot(t, registry)

	requireNoError(t, controlHandle.Restart(timeutil.SystemClock{}, timeutil.ThreadSleeper{}))

	restartedSnapshot := requireOnlyPlatformScopeSnapshot(t, registry)
	if restartedSnapshot.SupervisedRootPID == initialSnapshot.SupervisedRootPID {
		t.Fatalf("expected restart to update supervised root pid %d", initialSnapshot.SupervisedRootPID)
	}
	assertEqual(t, restartedSnapshot.ScopePaths, initialSnapshot.ScopePaths)
	assertFileText(t, restartedSnapshot.ScopePaths.ProcsFile, strconv.Itoa(int(restartedSnapshot.SupervisedRootPID))+"\n")

	requireNoError(t, manager.Stop(timeutil.SystemClock{}, timeutil.ThreadSleeper{}))
}

func TestPlatformScopedProcessManagerKillsScopeAfterReadinessFailure(t *testing.T) {
	registry := &PlatformProcessRegistry{}
	cgroupRoot := t.TempDir()
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sandbox-123",
		timeutil.SystemClock{},
		nil,
	)
	requireNoError(t, err)
	host, port := reserveUnusedLocalPort(t)
	processSpec := managerProcessSpec("not-ready", []string{"/bin/sleep", "30"})
	processSpec.Readiness.Type = runtime.RuntimeClientProcessReadinessHTTP
	processSpec.Readiness.URL = "http://" + host + ":" + strconv.Itoa(int(port)) + "/readyz"
	processSpec.Readiness.ExpectedStatus = 200
	processSpec.Readiness.TimeoutMS = 1

	_, err = StartRuntimeClientProcessManagerWithPlatformScopes(
		[]RuntimeClientProcessSpec{processSpec},
		timeutil.SystemClock{},
		timeutil.ThreadSleeper{},
		supervisorHandle,
		PlatformProcessScopeInput{
			CgroupRoot:        cgroupRoot,
			SandboxInstanceID: "sbi_123",
			Registry:          registry,
		},
	)

	if err == nil {
		t.Fatalf("expected readiness failure")
	}
	killFile := filepath.Join(cgroupRoot, "sbi_123", "platform", "runtime-0", "cgroup.kill")
	assertFileText(t, killFile, "1\n")
	snapshots, err := registry.Snapshots()
	requireNoError(t, err)
	assertEqual(t, len(snapshots), 0)
}

func requireOnlyPlatformScopeSnapshot(t *testing.T, registry *PlatformProcessRegistry) PlatformProcessScopeSnapshot {
	t.Helper()
	snapshots, err := registry.Snapshots()
	requireNoError(t, err)
	if len(snapshots) != 1 {
		t.Fatalf("expected one platform scope snapshot, got %#v", snapshots)
	}
	return snapshots[0]
}

func assertFileText(t *testing.T, path string, expected string) {
	t.Helper()
	content, err := os.ReadFile(path)
	requireNoError(t, err)
	if string(content) != expected {
		t.Fatalf("expected %s to contain %q, got %q", path, expected, string(content))
	}
}
