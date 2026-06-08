//go:build unix

package tunnel

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/mistle/sandboxd/cgroups"
)

var ptyScopeCounter atomic.Uint64

type PTYSession struct {
	processID  uint32
	scopePaths *cgroups.ScopePaths
	command    *exec.Cmd
	file       *os.File
	events     chan PTYEvent
	mutex      sync.Mutex
	exitCode   *int
}

func StartPTYSession(request PTYSpawnRequest) (*PTYSession, error) {
	return startPTYSession(request, "", "")
}

func StartScopedPTYSession(request PTYSpawnRequest, cgroupRoot string, sandboxInstanceID string) (*PTYSession, error) {
	if cgroupRoot == "" {
		return StartPTYSession(request)
	}
	if sandboxInstanceID == "" {
		return nil, fmt.Errorf("sandbox instance id is required for scoped pty session")
	}
	return startPTYSession(request, cgroupRoot, sandboxInstanceID)
}

func startPTYSession(request PTYSpawnRequest, cgroupRoot string, sandboxInstanceID string) (*PTYSession, error) {
	commandPath := DefaultPTYShell
	args := []string{"-i"}
	if request.Command != nil && *request.Command != "" {
		commandPath = *request.Command
		args = append([]string(nil), request.Args...)
	}
	cmd := exec.Command(commandPath, args...)
	if request.CWD != nil {
		cmd.Dir = *request.CWD
	}
	cmd.Env = buildPTYEnvironment(request.Env)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true, Setctty: true}

	cols := DefaultPTYCols
	rows := DefaultPTYRows
	if request.Cols != nil {
		cols = *request.Cols
	}
	if request.Rows != nil {
		rows = *request.Rows
	}
	if cols == 0 || rows == 0 {
		return nil, fmt.Errorf("pty cols and rows must be between 1 and 65535")
	}
	file, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: rows, Cols: cols})
	if err != nil {
		return nil, fmt.Errorf("failed to start pty process: %w", err)
	}
	session := &PTYSession{
		processID: uint32(cmd.Process.Pid),
		command:   cmd,
		file:      file,
		events:    make(chan PTYEvent, 32),
	}
	if cgroupRoot != "" {
		scopeID := fmt.Sprintf("pty-%d", ptyScopeCounter.Add(1))
		scopePaths, err := cgroups.CreateUserScope(cgroupRoot, sandboxInstanceID, scopeID)
		if err != nil {
			_, _ = session.Terminate(DefaultPTYTerminatePollInterval, DefaultPTYTerminateTimeout)
			return nil, fmt.Errorf("failed to create pty user scope: %w", err)
		}
		if err := cgroups.AttachPIDToScope(scopePaths, session.processID); err != nil {
			_, _ = session.Terminate(DefaultPTYTerminatePollInterval, DefaultPTYTerminateTimeout)
			return nil, fmt.Errorf("failed to attach pty process to user scope: %w", err)
		}
		session.scopePaths = &scopePaths
	}
	go session.readLoop()
	go session.waitLoop()
	return session, nil
}

func buildPTYEnvironment(env map[string]string) []string {
	merged := map[string]string{}
	for _, entry := range os.Environ() {
		key, value, ok := stringsCut(entry, "=")
		if ok {
			merged[key] = value
		}
	}
	for key, value := range env {
		merged[key] = value
	}
	merged["TERM"] = DefaultPTYTerm
	serialized := make([]string, 0, len(merged))
	for key, value := range merged {
		serialized = append(serialized, key+"="+value)
	}
	return serialized
}

func stringsCut(value string, separator string) (string, string, bool) {
	index := -1
	for offset := 0; offset <= len(value)-len(separator); offset++ {
		if value[offset:offset+len(separator)] == separator {
			index = offset
			break
		}
	}
	if index < 0 {
		return value, "", false
	}
	return value[:index], value[index+len(separator):], true
}

func (session *PTYSession) ProcessID() uint32 {
	return session.processID
}

func (session *PTYSession) Events() <-chan PTYEvent {
	return session.events
}

func (session *PTYSession) Resize(cols uint16, rows uint16) error {
	if cols == 0 || rows == 0 {
		return fmt.Errorf("pty resize cols and rows must be between 1 and 65535")
	}
	if session.ExitCode() != nil {
		return fmt.Errorf("pty session has already exited")
	}
	if err := pty.Setsize(session.file, &pty.Winsize{Rows: rows, Cols: cols}); err != nil {
		return fmt.Errorf("failed to apply pty resize: %w", err)
	}
	return nil
}

func (session *PTYSession) Write(payload []byte) error {
	if session.ExitCode() != nil {
		return nil
	}
	if _, err := session.file.Write(payload); err != nil {
		return fmt.Errorf("failed to write pty input: %w", err)
	}
	return nil
}

func (session *PTYSession) ExitCode() *int {
	session.mutex.Lock()
	defer session.mutex.Unlock()
	if session.exitCode == nil {
		return nil
	}
	exitCode := *session.exitCode
	return &exitCode
}

func (session *PTYSession) Terminate(pollInterval time.Duration, timeout time.Duration) (int, error) {
	if exitCode := session.ExitCode(); exitCode != nil {
		return *exitCode, nil
	}
	if session.command.Process != nil {
		_ = session.command.Process.Kill()
	}
	deadline := time.Now().Add(timeout)
	for {
		if exitCode := session.ExitCode(); exitCode != nil {
			return *exitCode, nil
		}
		if time.Now().After(deadline) {
			return 0, fmt.Errorf("pty process did not exit after %dms", timeout.Milliseconds())
		}
		time.Sleep(pollInterval)
	}
}

func (session *PTYSession) Close() error {
	return session.file.Close()
}

func (session *PTYSession) readLoop() {
	buffer := make([]byte, 8192)
	for {
		count, err := session.file.Read(buffer)
		if count > 0 {
			chunk := make([]byte, count)
			copy(chunk, buffer[:count])
			session.events <- PTYEvent{Kind: PTYEventOutput, Output: chunk}
		}
		if err != nil {
			if errors.Is(err, os.ErrClosed) || errors.Is(err, io.EOF) {
				session.events <- PTYEvent{Kind: PTYEventClosed}
			} else {
				session.events <- PTYEvent{Kind: PTYEventError, Error: err.Error()}
			}
			return
		}
	}
}

func (session *PTYSession) waitLoop() {
	err := session.command.Wait()
	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			session.events <- PTYEvent{Kind: PTYEventError, Error: err.Error()}
		}
	}
	session.mutex.Lock()
	session.exitCode = &exitCode
	session.mutex.Unlock()
	session.events <- PTYEvent{Kind: PTYEventExit, ExitCode: exitCode}
	_ = session.file.Close()
}
