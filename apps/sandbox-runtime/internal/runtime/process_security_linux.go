//go:build linux

package runtime

import (
	"fmt"

	"golang.org/x/sys/unix"
)

func markCurrentProcessNonDumpable() error {
	if err := unix.Prctl(unix.PR_SET_DUMPABLE, 0, 0, 0, 0); err != nil {
		return fmt.Errorf("failed to mark sandboxd process non-dumpable: %w", err)
	}

	return nil
}

func currentProcessDumpable() (bool, error) {
	dumpableValue, err := unix.PrctlRetInt(unix.PR_GET_DUMPABLE, 0, 0, 0, 0)
	if err != nil {
		return false, fmt.Errorf("failed to read sandboxd dumpable flag: %w", err)
	}

	return dumpableValue != 0, nil
}
