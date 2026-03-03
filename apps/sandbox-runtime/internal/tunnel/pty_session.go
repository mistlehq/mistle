package tunnel

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/sessionprotocol"
)

const ptyTerminateTimeout = 2 * time.Second
const ptyForceKillTimeout = 2 * time.Second
const defaultPTYShell = "/bin/sh"

type ptySession struct {
	command   *exec.Cmd
	terminal  *os.File
	exitedCh  chan struct{}
	exitCode  int
	exitCodeM sync.RWMutex
	closeOnce sync.Once
}

func startPTYSession(connectRequest sessionprotocol.PTYConnectRequest) (*ptySession, error) {
	command := exec.Command(defaultPTYShell, "-i")
	if connectRequest.Channel.Cwd != "" {
		command.Dir = connectRequest.Channel.Cwd
	}
	command.Env = append(os.Environ(), "TERM=xterm-256color")

	var (
		terminalFile *os.File
		err          error
	)
	if connectRequest.Channel.Cols > 0 && connectRequest.Channel.Rows > 0 {
		terminalFile, err = pty.StartWithSize(command, &pty.Winsize{
			Cols: uint16(connectRequest.Channel.Cols),
			Rows: uint16(connectRequest.Channel.Rows),
		})
	} else {
		terminalFile, err = pty.Start(command)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to start pty process: %w", err)
	}

	session := &ptySession{
		command:  command,
		terminal: terminalFile,
		exitedCh: make(chan struct{}),
	}

	go func() {
		waitErr := command.Wait()
		session.exitCodeM.Lock()
		session.exitCode = processExitCodeFromWaitErr(waitErr)
		session.exitCodeM.Unlock()
		close(session.exitedCh)
	}()

	return session, nil
}

func processExitCodeFromWaitErr(waitErr error) int {
	if waitErr == nil {
		return 0
	}

	var exitErr *exec.ExitError
	if errors.As(waitErr, &exitErr) {
		status, ok := exitErr.Sys().(syscall.WaitStatus)
		if ok {
			return status.ExitStatus()
		}
	}

	return 1
}

func (session *ptySession) IsExited() bool {
	select {
	case <-session.exitedCh:
		return true
	default:
		return false
	}
}

func (session *ptySession) ExitCode() int {
	session.exitCodeM.RLock()
	defer session.exitCodeM.RUnlock()
	return session.exitCode
}

func (session *ptySession) Resize(cols int, rows int) error {
	if cols < 1 || rows < 1 || cols > 65535 || rows > 65535 {
		return fmt.Errorf("pty resize cols and rows must be between 1 and 65535")
	}
	if session.IsExited() {
		return fmt.Errorf("pty session has already exited")
	}

	if err := pty.Setsize(session.terminal, &pty.Winsize{
		Cols: uint16(cols),
		Rows: uint16(rows),
	}); err != nil {
		return fmt.Errorf("failed to apply pty resize: %w", err)
	}

	return nil
}

func (session *ptySession) CloseTerminal() error {
	var closeErr error
	session.closeOnce.Do(func() {
		if session.terminal == nil {
			return
		}
		closeErr = session.terminal.Close()
	})

	return closeErr
}

func (session *ptySession) Terminate() (int, error) {
	if session.IsExited() {
		_ = session.CloseTerminal()
		return session.ExitCode(), nil
	}
	if session.command.Process == nil {
		return 0, fmt.Errorf("pty process is not running")
	}

	if err := session.command.Process.Signal(syscall.SIGTERM); err != nil && !errors.Is(err, os.ErrProcessDone) {
		return 0, fmt.Errorf("failed to send SIGTERM to pty process: %w", err)
	}

	select {
	case <-session.exitedCh:
		_ = session.CloseTerminal()
		return session.ExitCode(), nil
	case <-time.After(ptyTerminateTimeout):
	}

	if err := session.command.Process.Signal(syscall.SIGKILL); err != nil && !errors.Is(err, os.ErrProcessDone) {
		return 0, fmt.Errorf("failed to send SIGKILL to pty process: %w", err)
	}

	select {
	case <-session.exitedCh:
		_ = session.CloseTerminal()
		return session.ExitCode(), nil
	case <-time.After(ptyForceKillTimeout):
		return 0, fmt.Errorf("pty process did not exit after termination signals")
	}
}
