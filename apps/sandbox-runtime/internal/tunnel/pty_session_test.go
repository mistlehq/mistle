package tunnel

import (
	"io"
	"strings"
	"testing"
	"time"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/sessionprotocol"
)

func TestStartPTYSessionInheritsProcessEnvironment(t *testing.T) {
	t.Setenv("GH_TOKEN", "dummy-token")

	session, err := startPTYSession(sessionprotocol.PTYConnectRequest{
		Channel: sessionprotocol.PTYConnectChannel{
			Kind:    sessionprotocol.ChannelKindPTY,
			Session: sessionprotocol.PTYSessionModeCreate,
			Cols:    80,
			Rows:    24,
		},
	})
	if err != nil {
		t.Fatalf("expected PTY session to start, got %v", err)
	}
	defer func() {
		_, _ = session.Terminate()
	}()

	readChunks := make(chan string, 16)
	readErrs := make(chan error, 1)
	go func() {
		buffer := make([]byte, 1024)
		for {
			readBytes, readErr := session.terminal.Read(buffer)
			if readBytes > 0 {
				readChunks <- string(buffer[:readBytes])
			}
			if readErr != nil {
				readErrs <- readErr
				return
			}
		}
	}()

	_, err = session.terminal.Write([]byte("printf '__MISTLE_GH_TOKEN__%s__\\n' \"$GH_TOKEN\"\nexit\n"))
	deadline := time.After(5 * time.Second)
	var output strings.Builder
	for {
		select {
		case chunk := <-readChunks:
			output.WriteString(chunk)
			if strings.Contains(output.String(), "$ ") {
				_, err = session.terminal.Write([]byte("printf '__MISTLE_GH_TOKEN__%s__\\n' \"$GH_TOKEN\"\nexit\n"))
				if err != nil {
					t.Fatalf("expected PTY command write to succeed, got %v", err)
				}
				goto waitForEnvOutput
			}
		case readErr := <-readErrs:
			t.Fatalf("expected PTY prompt before shell exit, got output %q and read error %v", output.String(), readErr)
		case <-deadline:
			t.Fatalf("timed out waiting for PTY prompt, got %q", output.String())
		}
	}

waitForEnvOutput:
	for {
		if strings.Contains(output.String(), "__MISTLE_GH_TOKEN__dummy-token__") {
			return
		}

		select {
		case chunk := <-readChunks:
			output.WriteString(chunk)
		case readErr := <-readErrs:
			if readErr == io.EOF && strings.Contains(output.String(), "__MISTLE_GH_TOKEN__dummy-token__") {
				return
			}
			t.Fatalf("expected PTY output to include inherited env, got output %q and read error %v", output.String(), readErr)
		case <-deadline:
			t.Fatalf("timed out waiting for PTY env output, got %q", output.String())
		}
	}
}
