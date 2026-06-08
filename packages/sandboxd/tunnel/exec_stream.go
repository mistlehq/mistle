package tunnel

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"time"
	"unicode/utf8"

	tunnelprotocol "github.com/mistle/sandboxd/tunnel/protocol"
)

const (
	defaultExecTimeout       = 15 * time.Second
	defaultExecMaxOutputByte = 16 * 1024 * 1024
)

type ExecCommandResult struct {
	ExitCode  int
	Stdout    string
	Stderr    string
	Truncated bool
}

func RunExecStreamCommand(parentContext context.Context, channel tunnelprotocol.StreamChannel, runtimeEnv map[string]string) (ExecCommandResult, error) {
	if channel.Command == "" {
		return ExecCommandResult{}, fmt.Errorf("exec command is required")
	}
	timeout := defaultExecTimeout
	if channel.TimeoutMs != nil {
		timeout = time.Duration(*channel.TimeoutMs) * time.Millisecond
	}
	ctx, cancel := context.WithTimeout(parentContext, timeout)
	defer cancel()

	command := exec.CommandContext(ctx, channel.Command, channel.Args...)
	if channel.CWD != nil {
		command.Dir = *channel.CWD
	}
	command.Env = execEnvironment(runtimeEnv)
	if channel.Stdin != nil {
		command.Stdin = bytes.NewBufferString(*channel.Stdin)
	}
	remainingOutputBytes := execMaxOutputBytes(channel)
	stdout := &boundedBuffer{remaining: &remainingOutputBytes}
	stderr := &boundedBuffer{remaining: &remainingOutputBytes}
	command.Stdout = stdout
	command.Stderr = stderr

	err := command.Run()
	if parentContext.Err() == context.Canceled {
		return ExecCommandResult{}, fmt.Errorf("command was cancelled")
	}
	if ctx.Err() == context.DeadlineExceeded {
		return ExecCommandResult{}, fmt.Errorf("command timed out after %dms", timeout.Milliseconds())
	}
	exitCode := 0
	if err != nil {
		exitErr, ok := err.(*exec.ExitError)
		if !ok {
			return ExecCommandResult{}, fmt.Errorf("failed to run command: %w", err)
		}
		exitCode = exitErr.ExitCode()
	}
	stdoutText, err := stdout.Text()
	if err != nil {
		return ExecCommandResult{}, err
	}
	stderrText, err := stderr.Text()
	if err != nil {
		return ExecCommandResult{}, err
	}
	return ExecCommandResult{
		ExitCode:  exitCode,
		Stdout:    stdoutText,
		Stderr:    stderrText,
		Truncated: stdout.truncated || stderr.truncated,
	}, nil
}

func execMaxOutputBytes(channel tunnelprotocol.StreamChannel) int {
	if channel.MaxOutputBytes == nil {
		return defaultExecMaxOutputByte
	}
	if *channel.MaxOutputBytes > uint64(int(^uint(0)>>1)) {
		return int(^uint(0) >> 1)
	}
	return int(*channel.MaxOutputBytes)
}

func execEnvironment(runtimeEnv map[string]string) []string {
	environment := append([]string(nil), os.Environ()...)
	for name, value := range runtimeEnv {
		environment = append(environment, name+"="+value)
	}
	return environment
}

type boundedBuffer struct {
	buffer    bytes.Buffer
	remaining *int
	truncated bool
}

func (buffer *boundedBuffer) Write(payload []byte) (int, error) {
	if buffer.remaining == nil {
		return 0, fmt.Errorf("bounded buffer remaining byte counter is required")
	}
	allowed := min(len(payload), *buffer.remaining)
	if allowed > 0 {
		if _, err := buffer.buffer.Write(payload[:allowed]); err != nil {
			return 0, err
		}
		*buffer.remaining -= allowed
	}
	if allowed < len(payload) {
		buffer.truncated = true
	}
	return len(payload), nil
}

func (buffer *boundedBuffer) Text() (string, error) {
	payload := buffer.buffer.Bytes()
	if utf8.Valid(payload) {
		return string(payload), nil
	}
	if !buffer.truncated {
		return "", fmt.Errorf("command output was not valid utf-8")
	}
	for len(payload) > 0 && !utf8.Valid(payload) {
		_, size := utf8.DecodeLastRune(payload)
		payload = payload[:len(payload)-size]
	}
	return string(payload), nil
}
