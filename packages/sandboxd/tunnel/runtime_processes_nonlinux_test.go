//go:build !linux

package tunnel

import (
	"testing"

	"github.com/mistle/sandboxd/timeutil"
)

func TestCollectProcessesSnapshotFailsExplicitlyOutsideLinux(t *testing.T) {
	_, err := CollectProcessesSnapshot(timeutil.NewMutableClock(104))

	if err == nil {
		t.Fatalf("expected non-linux process inventory to fail")
	}
	assertEqual(t, err.Error(), "sandboxd processes inventory is only supported in linux sandboxes")
}
