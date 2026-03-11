//go:build !linux

package runtime

func markCurrentProcessNonDumpable() error {
	return nil
}

func currentProcessDumpable() (bool, error) {
	return true, nil
}
