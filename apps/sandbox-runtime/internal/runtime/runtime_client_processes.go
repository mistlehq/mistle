package runtime

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/coder/websocket"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/httpclient"
	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/startup"
)

type runtimeClientProcessExit struct {
	ProcessKey string
	Err        error
}

type runtimeClientProcessManager struct {
	processes        []*runtimeClientProcess
	unexpectedExitCh chan runtimeClientProcessExit
	stopCh           chan struct{}
	stopOnce         sync.Once
}

type runtimeClientProcess struct {
	spec      startup.RuntimeClientProcessSpec
	command   *exec.Cmd
	exitedCh  chan struct{}
	exitErr   error
	exitErrMu sync.RWMutex
}

func startRuntimeClientProcesses(
	processes []startup.RuntimeClientProcessSpec,
) (*runtimeClientProcessManager, error) {
	manager := &runtimeClientProcessManager{
		processes:        make([]*runtimeClientProcess, 0, len(processes)),
		unexpectedExitCh: make(chan runtimeClientProcessExit, len(processes)),
		stopCh:           make(chan struct{}),
	}

	for processIndex, processSpec := range processes {
		runningProcess, err := startRuntimeClientProcess(processSpec)
		if err != nil {
			_ = manager.Stop()
			return nil, fmt.Errorf(
				"runtime client process[%d] failed to start (processKey=%s): %w",
				processIndex,
				processSpec.ProcessKey,
				err,
			)
		}

		manager.processes = append(manager.processes, runningProcess)
		go manager.watchForUnexpectedProcessExit(runningProcess)

		if err := waitForRuntimeClientProcessReadiness(runningProcess, processSpec.Readiness); err != nil {
			_ = manager.Stop()
			return nil, fmt.Errorf(
				"runtime client process[%d] readiness check failed (processKey=%s): %w",
				processIndex,
				processSpec.ProcessKey,
				err,
			)
		}
	}

	return manager, nil
}

func (manager *runtimeClientProcessManager) UnexpectedExit() <-chan runtimeClientProcessExit {
	return manager.unexpectedExitCh
}

func (manager *runtimeClientProcessManager) Stop() error {
	var stopErr error

	manager.stopOnce.Do(func() {
		close(manager.stopCh)

		stopErrors := make([]string, 0)
		for processIndex := len(manager.processes) - 1; processIndex >= 0; processIndex-- {
			process := manager.processes[processIndex]
			if err := stopRuntimeClientProcess(process); err != nil {
				stopErrors = append(
					stopErrors,
					fmt.Sprintf("processKey=%s: %v", process.spec.ProcessKey, err),
				)
			}
		}

		if len(stopErrors) > 0 {
			stopErr = fmt.Errorf("failed to stop runtime client processes: %s", strings.Join(stopErrors, "; "))
		}
	})

	return stopErr
}

func (manager *runtimeClientProcessManager) watchForUnexpectedProcessExit(process *runtimeClientProcess) {
	<-process.exitedCh

	select {
	case <-manager.stopCh:
		return
	default:
	}

	processErr := process.exitError()
	if processErr == nil {
		processErr = fmt.Errorf("process exited")
	}

	manager.unexpectedExitCh <- runtimeClientProcessExit{
		ProcessKey: process.spec.ProcessKey,
		Err:        processErr,
	}
}

func startRuntimeClientProcess(
	processSpec startup.RuntimeClientProcessSpec,
) (*runtimeClientProcess, error) {
	if len(processSpec.Command.Args) == 0 {
		return nil, fmt.Errorf("process command args must not be empty")
	}

	command := exec.Command(processSpec.Command.Args[0], processSpec.Command.Args[1:]...)
	if strings.TrimSpace(processSpec.Command.Cwd) != "" {
		command.Dir = processSpec.Command.Cwd
	}
	if len(processSpec.Command.Env) > 0 {
		command.Env = mergedProcessEnvironment(processSpec.Command.Env)
	}
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr

	if err := command.Start(); err != nil {
		return nil, fmt.Errorf("failed to start process command: %w", err)
	}

	process := &runtimeClientProcess{
		spec:     processSpec,
		command:  command,
		exitedCh: make(chan struct{}),
	}

	go func() {
		waitErr := command.Wait()
		process.exitErrMu.Lock()
		process.exitErr = waitErr
		process.exitErrMu.Unlock()
		close(process.exitedCh)
	}()

	return process, nil
}

func stopRuntimeClientProcess(process *runtimeClientProcess) error {
	if process.hasExited() {
		return nil
	}

	signalToSend, err := stopSignal(process.spec.Stop.Signal)
	if err != nil {
		return err
	}

	deadline := time.Now().Add(time.Duration(process.spec.Stop.TimeoutMs) * time.Millisecond)
	if err := signalRuntimeClientProcess(process, signalToSend); err != nil {
		return err
	}

	if process.spec.Stop.Signal == "sigterm" && process.spec.Stop.GracePeriodMs > 0 {
		graceWaitDuration := time.Duration(process.spec.Stop.GracePeriodMs) * time.Millisecond
		if err := waitForRuntimeClientProcessExit(process, graceWaitDuration); err == nil {
			return nil
		}

		if err := signalRuntimeClientProcess(process, syscall.SIGKILL); err != nil {
			return err
		}
	}

	remainingDuration := time.Until(deadline)
	if remainingDuration <= 0 {
		return fmt.Errorf("stop policy timeout exceeded before process exit")
	}

	if err := waitForRuntimeClientProcessExit(process, remainingDuration); err != nil {
		return fmt.Errorf("process did not exit before stop timeout: %w", err)
	}

	return nil
}

func signalRuntimeClientProcess(process *runtimeClientProcess, signal os.Signal) error {
	if process.hasExited() {
		return nil
	}

	if process.command.Process == nil {
		return fmt.Errorf("runtime client process has no running OS process")
	}

	err := process.command.Process.Signal(signal)
	if err == nil {
		return nil
	}
	if process.hasExited() {
		return nil
	}
	if errors.Is(err, os.ErrProcessDone) {
		return nil
	}

	return fmt.Errorf("failed to signal process: %w", err)
}

func waitForRuntimeClientProcessReadiness(
	process *runtimeClientProcess,
	readiness startup.RuntimeClientProcessReadiness,
) error {
	switch readiness.Type {
	case "none":
		return nil
	case "tcp":
		return waitForRuntimeClientProcessTCPReadiness(process, readiness)
	case "http":
		return waitForRuntimeClientProcessHTTPReadiness(process, readiness)
	case "ws":
		return waitForRuntimeClientProcessWSReadiness(process, readiness)
	default:
		return fmt.Errorf("unsupported readiness type '%s'", readiness.Type)
	}
}

func waitForRuntimeClientProcessTCPReadiness(
	process *runtimeClientProcess,
	readiness startup.RuntimeClientProcessReadiness,
) error {
	address := net.JoinHostPort(readiness.Host, strconv.Itoa(readiness.Port))

	check := func() error {
		connection, err := net.DialTimeout("tcp", address, 250*time.Millisecond)
		if err != nil {
			return err
		}
		_ = connection.Close()
		return nil
	}

	return waitForRuntimeClientProcessCheck(process, readiness.TimeoutMs, check)
}

func waitForRuntimeClientProcessHTTPReadiness(
	process *runtimeClientProcess,
	readiness startup.RuntimeClientProcessReadiness,
) error {
	httpClient := httpclient.NewDirectClient(&http.Client{Timeout: 500 * time.Millisecond})

	check := func() error {
		response, err := httpClient.Get(readiness.URL)
		if err != nil {
			return err
		}
		defer response.Body.Close()
		_, _ = io.Copy(io.Discard, response.Body)

		if response.StatusCode != readiness.ExpectedStatus {
			return fmt.Errorf(
				"http readiness returned status %d, expected %d",
				response.StatusCode,
				readiness.ExpectedStatus,
			)
		}

		return nil
	}

	return waitForRuntimeClientProcessCheck(process, readiness.TimeoutMs, check)
}

func waitForRuntimeClientProcessWSReadiness(
	process *runtimeClientProcess,
	readiness startup.RuntimeClientProcessReadiness,
) error {
	check := func() error {
		dialContext, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
		defer cancel()

		connection, _, err := websocket.Dial(dialContext, readiness.URL, &websocket.DialOptions{
			HTTPClient: httpclient.NewDirectClient(&http.Client{Timeout: 500 * time.Millisecond}),
		})
		if err != nil {
			return err
		}
		connection.CloseNow()

		return nil
	}

	return waitForRuntimeClientProcessCheck(process, readiness.TimeoutMs, check)
}

func waitForRuntimeClientProcessCheck(
	process *runtimeClientProcess,
	timeoutMs int,
	check func() error,
) error {
	deadline := time.Now().Add(time.Duration(timeoutMs) * time.Millisecond)
	var lastErr error

	for {
		if process.hasExited() {
			processErr := process.exitError()
			if processErr != nil {
				return fmt.Errorf("process exited before readiness: %w", processErr)
			}
			return fmt.Errorf("process exited before readiness")
		}

		checkErr := check()
		if checkErr == nil {
			return nil
		}
		lastErr = checkErr

		remainingDuration := time.Until(deadline)
		if remainingDuration <= 0 {
			break
		}

		pollWait := 100 * time.Millisecond
		if remainingDuration < pollWait {
			pollWait = remainingDuration
		}

		timer := time.NewTimer(pollWait)
		select {
		case <-process.exitedCh:
			timer.Stop()
		case <-timer.C:
		}
	}

	if lastErr != nil {
		return fmt.Errorf("timed out after %dms waiting for readiness: %w", timeoutMs, lastErr)
	}

	return fmt.Errorf("timed out after %dms waiting for readiness", timeoutMs)
}

func waitForRuntimeClientProcessExit(process *runtimeClientProcess, waitDuration time.Duration) error {
	if waitDuration <= 0 {
		if process.hasExited() {
			return nil
		}
		return fmt.Errorf("process exit wait timed out")
	}

	timer := time.NewTimer(waitDuration)
	defer timer.Stop()

	select {
	case <-process.exitedCh:
		return nil
	case <-timer.C:
		return fmt.Errorf("process exit wait timed out")
	}
}

func stopSignal(signal string) (os.Signal, error) {
	switch signal {
	case "sigterm":
		return syscall.SIGTERM, nil
	case "sigkill":
		return syscall.SIGKILL, nil
	default:
		return nil, fmt.Errorf("unsupported stop signal '%s'", signal)
	}
}

func mergedProcessEnvironment(overrides map[string]string) []string {
	environmentByKey := make(map[string]string)
	for _, entry := range os.Environ() {
		key, value, found := strings.Cut(entry, "=")
		if !found {
			continue
		}
		environmentByKey[key] = value
	}

	for key, value := range overrides {
		environmentByKey[key] = value
	}

	keys := make([]string, 0, len(environmentByKey))
	for key := range environmentByKey {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	merged := make([]string, 0, len(keys))
	for _, key := range keys {
		merged = append(merged, fmt.Sprintf("%s=%s", key, environmentByKey[key]))
	}

	return merged
}

func (process *runtimeClientProcess) hasExited() bool {
	select {
	case <-process.exitedCh:
		return true
	default:
		return false
	}
}

func (process *runtimeClientProcess) exitError() error {
	process.exitErrMu.RLock()
	defer process.exitErrMu.RUnlock()
	return process.exitErr
}
