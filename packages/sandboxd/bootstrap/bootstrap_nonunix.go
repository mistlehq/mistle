//go:build !unix

package bootstrap

import "fmt"

type ProcessEnvironmentEntry struct {
	Name  string
	Value string
}

type ExecRuntimeInput struct {
	UID     uint32
	GID     uint32
	Command string
	Args    []string
	Env     []ProcessEnvironmentEntry
}

func ClearCloseOnExec(fd int) error {
	return fmt.Errorf("sandbox bootstrap is only supported in unix sandboxes")
}

func ExecRuntime(input ExecRuntimeInput) error {
	return fmt.Errorf("sandbox bootstrap is only supported in unix sandboxes")
}
