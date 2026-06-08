//go:build linux

package tunnel

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/mistle/sandboxd/timeutil"
)

func TestCollectProcessEntriesForProcRootReturnsOnlyLocalBindListeners(t *testing.T) {
	procRoot := t.TempDir()
	requireNoError(t, os.MkdirAll(filepath.Join(procRoot, "net"), 0o755))
	requireNoError(t, os.MkdirAll(filepath.Join(procRoot, "100", "fd"), 0o755))
	requireNoError(t, os.MkdirAll(filepath.Join(procRoot, "101", "fd"), 0o755))
	requireNoError(t, os.WriteFile(
		filepath.Join(procRoot, "net", "tcp"),
		[]byte("  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000   100        0 7001 1 0000000000000000 100 0 0 10 0\n   1: 0200000A:2328 00000000:0000 0A 00000000:00000000 00:00000000 00000000   100        0 7002 1 0000000000000000 100 0 0 10 0\n"),
		0o644,
	))
	requireNoError(t, os.WriteFile(
		filepath.Join(procRoot, "net", "tcp6"),
		[]byte("  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n   0: 00000000000000000000000000000000:2382 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000   100        0 7003 1 0000000000000000 100 0 0 10 0\n"),
		0o644,
	))
	requireNoError(t, os.WriteFile(filepath.Join(procRoot, "100", "cmdline"), []byte("node\x00server.js\x00"), 0o644))
	requireNoError(t, os.WriteFile(filepath.Join(procRoot, "101", "comm"), []byte("idle\n"), 0o644))
	requireNoError(t, os.Symlink("socket:[7001]", filepath.Join(procRoot, "100", "fd", "3")))
	requireNoError(t, os.Symlink("socket:[7003]", filepath.Join(procRoot, "100", "fd", "4")))

	processes, err := collectProcessEntriesForProcRoot(procRoot)
	requireNoError(t, err)

	assertEqual(t, len(processes), 1)
	assertEqual(t, processes[0].PID, uint32(100))
	assertEqual(t, *processes[0].Command, "node server.js")
	assertEqual(t, len(processes[0].Listeners), 2)
	assertEqual(t, processes[0].Listeners[0].Port, uint16(8080))
	assertEqual(t, processes[0].Listeners[0].BindAddress, "127.0.0.1")
	assertEqual(t, processes[0].Listeners[1].Port, uint16(9090))
	assertEqual(t, processes[0].Listeners[1].BindAddress, "::")
}

func TestCollectProcessesSnapshotUsesOneObservedTimestamp(t *testing.T) {
	snapshot, err := CollectProcessesSnapshot(timeutil.NewMutableClock(104))
	requireNoError(t, err)

	assertEqual(t, snapshot.MessageType, "processes.snapshot")
	assertEqual(t, snapshot.ObservedAt, "1970-01-01T00:00:00.104Z")
}
