package process

import (
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/mistle/sandboxd/runtime"
	"github.com/mistle/sandboxd/timeutil"
)

const (
	DefaultProcessExitPollInterval      = 25 * time.Millisecond
	DefaultProcessReadinessPollInterval = 100 * time.Millisecond
	DefaultProcessMonitorPollInterval   = 1000 * time.Millisecond
	CodexAppServerFailureThreshold      = 3
	OpenCodeServerFailureThreshold      = 3
)

type RunningRuntimeClientProcess struct {
	Spec          RuntimeClientProcessSpec
	child         *exec.Cmd
	outputCapture *OutputCapture
	waitResult    chan processWaitResult
	mutex         sync.Mutex
}

type processWaitResult struct {
	err error
}

func (process *RunningRuntimeClientProcess) PID() uint32 {
	process.mutex.Lock()
	defer process.mutex.Unlock()
	if process.child.Process == nil {
		return 0
	}
	return uint32(process.child.Process.Pid)
}

func (process *RunningRuntimeClientProcess) OutputCapture() *OutputCapture {
	return process.outputCapture
}

func StartRuntimeClientProcess(processSpec RuntimeClientProcessSpec) (*RunningRuntimeClientProcess, error) {
	child, outputCapture, err := SpawnRuntimeClientChild(processSpec)
	if err != nil {
		return nil, err
	}
	return &RunningRuntimeClientProcess{
		Spec:          processSpec,
		child:         child,
		outputCapture: outputCapture,
		waitResult:    startProcessWait(child),
	}, nil
}

func SpawnRuntimeClientChild(processSpec RuntimeClientProcessSpec) (*exec.Cmd, *OutputCapture, error) {
	if len(processSpec.Command.Args) == 0 {
		return nil, nil, fmt.Errorf("process command args must not be empty")
	}
	child := exec.Command(processSpec.Command.Args[0], processSpec.Command.Args[1:]...)
	if processSpec.Command.CWD != nil {
		child.Dir = *processSpec.Command.CWD
	}
	if len(processSpec.Command.Env) > 0 {
		child.Env = append(child.Environ(), mapEnv(processSpec.Command.Env)...)
	}

	stdout, err := child.StdoutPipe()
	if err != nil {
		return nil, nil, fmt.Errorf("failed to attach process stdout: %w", err)
	}
	stderr, err := child.StderrPipe()
	if err != nil {
		return nil, nil, fmt.Errorf("failed to attach process stderr: %w", err)
	}
	child.Stdin = nil

	if err := child.Start(); err != nil {
		return nil, nil, fmt.Errorf("failed to start process command: %w", err)
	}

	outputCapture := NewOutputCapture()
	outputCapture.RegisterCaptureReader(stdout, OutputStreamStdout)
	outputCapture.RegisterCaptureReader(stderr, OutputStreamStderr)
	return child, outputCapture, nil
}

func StopStartedProcesses(processes []*RunningRuntimeClientProcess, clock timeutil.Clock, sleeper timeutil.Sleeper) error {
	stopErrors := make([]string, 0)
	for index := len(processes) - 1; index >= 0; index-- {
		process := processes[index]
		if err := StopRuntimeClientProcess(process, clock, sleeper); err != nil {
			stopErrors = append(stopErrors, fmt.Sprintf("processKey=%s: %s", process.Spec.ProcessKey, err.Error()))
		}
	}
	if len(stopErrors) > 0 {
		return fmt.Errorf("%s", strings.Join(stopErrors, "; "))
	}
	return nil
}

func StopRuntimeClientProcess(process *RunningRuntimeClientProcess, clock timeutil.Clock, sleeper timeutil.Sleeper) error {
	exited, err := ProcessHasExited(process)
	if err != nil {
		return err
	}
	if exited {
		process.outputCapture.FinishCaptureReaders()
		return nil
	}

	deadlineMS := clock.NowMS() + process.Spec.Stop.TimeoutMS
	if err := SignalRuntimeClientProcess(process, process.Spec.Stop.Signal); err != nil {
		return err
	}

	if process.Spec.Stop.Signal == runtime.RuntimeClientProcessStopSignalSIGTERM {
		gracePeriodMS := uint64(0)
		if process.Spec.Stop.GracePeriodMS != nil {
			gracePeriodMS = *process.Spec.Stop.GracePeriodMS
		}
		if gracePeriodMS > 0 {
			if err := WaitForRuntimeClientProcessExit(process, gracePeriodMS, clock, sleeper); err == nil {
				process.outputCapture.FinishCaptureReaders()
				return nil
			}
			if err := SignalRuntimeClientProcess(process, runtime.RuntimeClientProcessStopSignalSIGKILL); err != nil {
				return err
			}
		}
	}

	remainingMS := deadlineMS - clock.NowMS()
	if clock.NowMS() > deadlineMS {
		remainingMS = 0
	}
	err = WaitForRuntimeClientProcessExit(process, remainingMS, clock, sleeper)
	if err == nil {
		process.outputCapture.FinishCaptureReaders()
	}
	return err
}

func ProcessHasExited(process *RunningRuntimeClientProcess) (bool, error) {
	select {
	case <-process.waitResult:
		process.waitResult = closedProcessWaitResult()
		return true, nil
	default:
		return false, nil
	}
}

func WaitForRuntimeClientProcessExit(
	process *RunningRuntimeClientProcess,
	waitDurationMS uint64,
	clock timeutil.Clock,
	sleeper timeutil.Sleeper,
) error {
	deadlineMS := clock.NowMS() + waitDurationMS
	for {
		exited, err := reapExitedProcess(process)
		if err != nil {
			return err
		}
		if exited {
			return nil
		}
		if clock.NowMS() >= deadlineMS {
			return fmt.Errorf("process did not exit before stop timeout")
		}
		sleeper.Sleep(DefaultProcessExitPollInterval)
	}
}

func WaitForRuntimeClientProcessReadiness(
	process *RunningRuntimeClientProcess,
	clock timeutil.Clock,
	sleeper timeutil.Sleeper,
) error {
	if process.Spec.Readiness.Type == runtime.RuntimeClientProcessReadinessNone {
		return nil
	}
	timeoutMS := ReadinessTimeoutMS(process.Spec)
	deadlineMS := clock.NowMS() + timeoutMS

	for {
		exited, err := ProcessHasExited(process)
		if err != nil {
			return err
		}
		if exited {
			return fmt.Errorf("%s", processExitDescription(process))
		}

		readinessErr := CheckRuntimeClientProcessReadinessFromSpec(process.Spec)
		if readinessErr == nil {
			return nil
		}
		if clock.NowMS() >= deadlineMS {
			return fmt.Errorf(
				"timed out after %dms waiting for readiness: %w",
				timeoutMS,
				readinessErr,
			)
		}

		sleeper.Sleep(DefaultProcessReadinessPollInterval)
	}
}

func SignalRuntimeClientProcess(process *RunningRuntimeClientProcess, signal runtime.RuntimeClientProcessStopSignal) error {
	process.mutex.Lock()
	defer process.mutex.Unlock()
	if process.child.Process == nil {
		return nil
	}
	unixSignal, err := unixStopSignal(signal)
	if err != nil {
		return err
	}
	pid := process.child.Process.Pid
	if err := process.child.Process.Signal(unixSignal); err != nil {
		if err == syscall.ESRCH {
			return nil
		}
		return fmt.Errorf("failed to signal process pid=%d signal=%s: %w", pid, unixSignal.String(), err)
	}
	return nil
}

func DescribeProcessExit(processState osProcessState) string {
	return describeProcessExitStatus(processState.ExitCode())
}

func processExitEventFields(process *RunningRuntimeClientProcess) (string, map[string]any) {
	process.mutex.Lock()
	defer process.mutex.Unlock()
	processState := process.child.ProcessState
	if processState == nil {
		return "process_exited", map[string]any{
			"exitKind": "process_exited",
			"exitCode": 0,
		}
	}
	waitStatus, ok := processState.Sys().(syscall.WaitStatus)
	if ok && waitStatus.Signaled() {
		return "process_signaled", map[string]any{
			"exitKind": "process_signaled",
			"signal":   int(waitStatus.Signal()),
		}
	}
	return "process_exited", map[string]any{
		"exitKind": "process_exited",
		"exitCode": processState.ExitCode(),
	}
}

func describeProcessExitStatus(exitCode int) string {
	switch exitCode {
	case 0:
		return "process exited"
	case -1:
		return "process exited with signal"
	default:
		return fmt.Sprintf("process exited with code %d", exitCode)
	}
}

type osProcessState interface {
	ExitCode() int
	String() string
}

func reapExitedProcess(process *RunningRuntimeClientProcess) (bool, error) {
	select {
	case result := <-process.waitResult:
		process.waitResult = closedProcessWaitResult()
		return waitResultExited(result)
	default:
		return false, nil
	}
}

func processExitDescription(process *RunningRuntimeClientProcess) string {
	process.mutex.Lock()
	defer process.mutex.Unlock()
	if process.child.ProcessState == nil {
		return "process exited"
	}
	return DescribeProcessExit(process.child.ProcessState)
}

func startProcessWait(child *exec.Cmd) chan processWaitResult {
	result := make(chan processWaitResult, 1)
	go func() {
		result <- processWaitResult{err: child.Wait()}
		close(result)
	}()
	return result
}

func closedProcessWaitResult() chan processWaitResult {
	channel := make(chan processWaitResult)
	close(channel)
	return channel
}

func waitResultExited(result processWaitResult) (bool, error) {
	if result.err == nil {
		return true, nil
	}
	if _, ok := result.err.(*exec.ExitError); ok {
		return true, nil
	}
	return false, fmt.Errorf("failed to poll process exit: %w", result.err)
}

func unixStopSignal(signal runtime.RuntimeClientProcessStopSignal) (syscall.Signal, error) {
	switch signal {
	case runtime.RuntimeClientProcessStopSignalSIGTERM:
		return syscall.SIGTERM, nil
	case runtime.RuntimeClientProcessStopSignalSIGKILL:
		return syscall.SIGKILL, nil
	default:
		return 0, fmt.Errorf("unsupported process stop signal: %s", signal)
	}
}

func mapEnv(env map[string]string) []string {
	result := make([]string, 0, len(env))
	for name, value := range env {
		result = append(result, name+"="+value)
	}
	return result
}
