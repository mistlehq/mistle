package command

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"syscall"
	"time"
	"unicode/utf8"
)

const (
	DefaultPollInterval       = 10 * time.Millisecond
	defaultStdoutTailMaxBytes = 4 * 1024
	defaultStderrTailMaxBytes = 8 * 1024
)

type Spec struct {
	Args      []string
	Env       map[string]string
	CWD       *string
	TimeoutMS *uint64
}

type OutputStream string

const (
	OutputStreamStdout OutputStream = "stdout"
	OutputStreamStderr OutputStream = "stderr"
)

type OutputSink interface {
	RecordOutput(stream OutputStream, bytes []byte)
}

type OutputTails struct {
	StdoutTail     *string
	StderrTail     *string
	StdoutCaptured bool
	StderrCaptured bool
}

type Failure struct {
	Message     string
	ExitCode    *int
	TimedOut    bool
	OutputTails OutputTails
}

func Run(command Spec) error {
	failure := RunWithDetails(command)
	if failure == nil {
		return nil
	}
	return fmt.Errorf("%s", failure.Message)
}

func RunWithDetails(command Spec) *Failure {
	return RunWithDetailsAndOutputSink(command, nil)
}

func RunWithDetailsAndOutputSink(command Spec, outputSink OutputSink) *Failure {
	if len(command.Args) == 0 {
		return &Failure{Message: "command args must not be empty"}
	}

	ctx := context.Background()
	cancel := func() {}
	if command.TimeoutMS != nil {
		timeout := time.Duration(*command.TimeoutMS) * time.Millisecond
		ctx, cancel = context.WithTimeout(ctx, timeout)
	}
	defer cancel()

	childCommand := exec.CommandContext(ctx, command.Args[0], command.Args[1:]...)
	childCommand.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	childCommand.Cancel = func() error {
		if childCommand.Process == nil {
			return nil
		}
		return syscall.Kill(-childCommand.Process.Pid, syscall.SIGKILL)
	}
	if command.CWD != nil {
		childCommand.Dir = *command.CWD
	}
	if len(command.Env) > 0 {
		childCommand.Env = append(childCommand.Environ(), mapEnv(command.Env)...)
	}

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	childCommand.Stdout = outputWriter(&stdout, outputSink, OutputStreamStdout)
	childCommand.Stderr = outputWriter(&stderr, outputSink, OutputStreamStderr)

	runErr := childCommand.Run()
	stdoutText, stdoutErr := commandOutputString(stdout.Bytes())
	if stdoutErr != nil {
		return &Failure{Message: stdoutErr.Error()}
	}
	stderrText, stderrErr := commandOutputString(stderr.Bytes())
	if stderrErr != nil {
		return &Failure{Message: stderrErr.Error()}
	}
	result := result{
		exitCode: exitCode(runErr),
		stdout:   stdoutText,
		stderr:   stderrText,
		timedOut: ctx.Err() == context.DeadlineExceeded,
	}
	outputTails := collectOutputTails(result)

	if result.timedOut {
		timeoutMS := *command.TimeoutMS
		return &Failure{
			Message:     fmt.Sprintf("command timed out after %dms", timeoutMS),
			ExitCode:    result.exitCode,
			TimedOut:    true,
			OutputTails: outputTails,
		}
	}
	if runErr == nil {
		return nil
	}
	if result.exitCode == nil {
		return &Failure{
			Message:     fmt.Sprintf("failed to run command: %v", runErr),
			ExitCode:    nil,
			TimedOut:    false,
			OutputTails: outputTails,
		}
	}

	failure := describeCommandFailure(result)
	output := combineCommandOutput(result)
	if output == "" {
		return &Failure{
			Message:     failure,
			ExitCode:    result.exitCode,
			TimedOut:    false,
			OutputTails: outputTails,
		}
	}
	return &Failure{
		Message:     fmt.Sprintf("%s (output=%s)", failure, output),
		ExitCode:    result.exitCode,
		TimedOut:    false,
		OutputTails: outputTails,
	}
}

type result struct {
	exitCode *int
	stdout   string
	stderr   string
	timedOut bool
}

type sinkWriter struct {
	target *bytes.Buffer
	sink   OutputSink
	stream OutputStream
}

func (writer sinkWriter) Write(bytes []byte) (int, error) {
	if writer.sink != nil {
		writer.sink.RecordOutput(writer.stream, bytes)
	}
	return writer.target.Write(bytes)
}

func outputWriter(target *bytes.Buffer, outputSink OutputSink, stream OutputStream) io.Writer {
	if outputSink == nil {
		return target
	}
	return sinkWriter{target: target, sink: outputSink, stream: stream}
}

func commandOutputString(bytes []byte) (string, error) {
	if !utf8.Valid(bytes) {
		return "", fmt.Errorf("command output was not valid utf-8")
	}
	return string(bytes), nil
}

func combineCommandOutput(result result) string {
	parts := make([]string, 0, 2)
	for _, output := range []string{strings.TrimSpace(result.stdout), strings.TrimSpace(result.stderr)} {
		if output != "" {
			parts = append(parts, output)
		}
	}
	return strings.Join(parts, "\n")
}

func describeCommandFailure(result result) string {
	if result.exitCode == nil {
		return "command failed"
	}
	return fmt.Sprintf("command failed with exit code %d", *result.exitCode)
}

func collectOutputTails(result result) OutputTails {
	stdoutTail := collectOutputTail(result.stdout, defaultStdoutTailMaxBytes)
	stderrTail := collectOutputTail(result.stderr, defaultStderrTailMaxBytes)
	return OutputTails{
		StdoutCaptured: stdoutTail != nil,
		StderrCaptured: stderrTail != nil,
		StdoutTail:     stdoutTail,
		StderrTail:     stderrTail,
	}
}

func collectOutputTail(output string, maxBytes int) *string {
	if output == "" {
		return nil
	}
	bytes := []byte(output)
	start := len(bytes) - maxBytes
	if start < 0 {
		start = 0
	}
	tail := string(bytes[start:])
	return &tail
}

func exitCode(runErr error) *int {
	if runErr == nil {
		return nil
	}
	var exitError *exec.ExitError
	if !errors.As(runErr, &exitError) {
		return nil
	}
	code := exitError.ExitCode()
	return &code
}

func mapEnv(env map[string]string) []string {
	values := make([]string, 0, len(env))
	for key, value := range env {
		values = append(values, key+"="+value)
	}
	return values
}
