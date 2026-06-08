package security

import "fmt"

func errUnixSocketConnectionRequired() error {
	return fmt.Errorf("unix socket connection is required")
}
