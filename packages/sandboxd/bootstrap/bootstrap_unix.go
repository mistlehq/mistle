//go:build unix

package bootstrap

import (
	"fmt"
	"os"
	"strings"
	"syscall"
)

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
	if fd < 0 {
		return fmt.Errorf("fd must be non-negative")
	}
	flags, _, errno := syscall.Syscall(syscall.SYS_FCNTL, uintptr(fd), uintptr(syscall.F_GETFD), 0)
	if errno != 0 {
		return fmt.Errorf("failed to read fd flags for %d: %w", fd, errno)
	}
	_, _, errno = syscall.Syscall(syscall.SYS_FCNTL, uintptr(fd), uintptr(syscall.F_SETFD), flags&^uintptr(syscall.FD_CLOEXEC))
	if errno != 0 {
		return fmt.Errorf("failed to clear close-on-exec for fd %d: %w", fd, errno)
	}
	return nil
}

func ExecRuntime(input ExecRuntimeInput) error {
	if strings.TrimSpace(input.Command) == "" {
		return fmt.Errorf("runtime command is required")
	}
	if strings.ContainsRune(input.Command, 0) {
		return fmt.Errorf("runtime command must not contain NUL bytes")
	}
	for _, arg := range input.Args {
		if strings.ContainsRune(arg, 0) {
			return fmt.Errorf("runtime args must not contain NUL bytes")
		}
	}
	argv := append([]string{input.Command}, input.Args...)
	env, err := buildExecEnvironment(input.Env)
	if err != nil {
		return err
	}
	if os.Geteuid() != 0 {
		return fmt.Errorf("sandbox bootstrap must still be running as root")
	}
	if err := syscall.Setgroups([]int{int(input.GID)}); err != nil {
		return fmt.Errorf("failed to set supplementary groups: %w", err)
	}
	if err := syscall.Setgid(int(input.GID)); err != nil {
		return fmt.Errorf("failed to switch to runtime gid: %w", err)
	}
	if err := syscall.Setuid(int(input.UID)); err != nil {
		return fmt.Errorf("failed to switch to runtime uid: %w", err)
	}
	if err := ClearCloseOnExec(0); err != nil {
		return err
	}
	if err := ClearCloseOnExec(1); err != nil {
		return err
	}
	if err := ClearCloseOnExec(2); err != nil {
		return err
	}
	if err := syscall.Exec(input.Command, argv, env); err != nil {
		return fmt.Errorf("failed to exec sandbox runtime: %w", err)
	}
	return nil
}

func buildExecEnvironment(entries []ProcessEnvironmentEntry) ([]string, error) {
	environment := make([]string, 0, len(entries))
	for _, entry := range entries {
		if strings.TrimSpace(entry.Name) == "" {
			return nil, fmt.Errorf("runtime environment entry name is required")
		}
		for _, character := range entry.Name {
			if character == '=' {
				return nil, fmt.Errorf("runtime environment entry name must not contain '='")
			}
		}
		environmentEntry := entry.Name + "=" + entry.Value
		if strings.ContainsRune(environmentEntry, 0) {
			return nil, fmt.Errorf("runtime environment entries must not contain NUL bytes")
		}
		environment = append(environment, environmentEntry)
	}
	return environment, nil
}
