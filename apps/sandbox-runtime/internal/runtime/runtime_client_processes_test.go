package runtime

import (
	"fmt"
	"net"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/mistlehq/mistle/apps/sandbox-runtime/internal/startup"
)

const (
	runtimeClientProcessHelperEnabledEnv = "SANDBOX_RUNTIME_PROCESS_HELPER_ENABLED"
	runtimeClientProcessHelperModeEnv    = "SANDBOX_RUNTIME_PROCESS_HELPER_MODE"
	runtimeClientProcessHelperPortEnv    = "SANDBOX_RUNTIME_PROCESS_HELPER_PORT"
	runtimeClientProcessHelperDelayMsEnv = "SANDBOX_RUNTIME_PROCESS_HELPER_DELAY_MS"
)

func TestStartRuntimeClientProcesses(t *testing.T) {
	t.Run("starts process and waits for tcp readiness", func(t *testing.T) {
		freePort, err := reserveTCPPort()
		if err != nil {
			t.Fatalf("expected free port reservation to succeed, got %v", err)
		}

		processes := []startup.RuntimeClientProcessSpec{
			{
				ProcessKey: "process_codex",
				ClientID:   "client_codex",
				Command: helperProcessCommand(
					"tcp-listen",
					map[string]string{
						runtimeClientProcessHelperPortEnv: strconv.Itoa(freePort),
					},
				),
				Readiness: startup.RuntimeClientProcessReadiness{
					Type:      "tcp",
					Host:      "127.0.0.1",
					Port:      freePort,
					TimeoutMs: 2000,
				},
				Stop: startup.RuntimeClientProcessStopPolicy{
					Signal:        "sigterm",
					TimeoutMs:     2000,
					GracePeriodMs: 100,
				},
			},
		}

		manager, err := startRuntimeClientProcesses(processes)
		if err != nil {
			t.Fatalf("expected runtime client process startup to succeed, got %v", err)
		}

		if err := manager.Stop(); err != nil {
			t.Fatalf("expected runtime client process stop to succeed, got %v", err)
		}
	})

	t.Run("fails startup when process exits before readiness is reached", func(t *testing.T) {
		processes := []startup.RuntimeClientProcessSpec{
			{
				ProcessKey: "process_exit_early",
				ClientID:   "client_codex",
				Command:    helperProcessCommand("exit-immediately", map[string]string{}),
				Readiness: startup.RuntimeClientProcessReadiness{
					Type:      "tcp",
					Host:      "127.0.0.1",
					Port:      65535,
					TimeoutMs: 1000,
				},
				Stop: startup.RuntimeClientProcessStopPolicy{
					Signal:    "sigterm",
					TimeoutMs: 1000,
				},
			},
		}

		_, err := startRuntimeClientProcesses(processes)
		if err == nil {
			t.Fatal("expected runtime client process startup to fail when process exits early")
		}
		if !strings.Contains(err.Error(), "readiness check failed") {
			t.Fatalf("expected readiness failure message, got %v", err)
		}
		if !strings.Contains(err.Error(), "process exited before readiness") {
			t.Fatalf("expected process exit-before-readiness error, got %v", err)
		}
	})

	t.Run("reports unexpected process exits", func(t *testing.T) {
		processes := []startup.RuntimeClientProcessSpec{
			{
				ProcessKey: "process_exit_later",
				ClientID:   "client_codex",
				Command: helperProcessCommand(
					"exit-after-delay",
					map[string]string{
						runtimeClientProcessHelperDelayMsEnv: "100",
					},
				),
				Readiness: startup.RuntimeClientProcessReadiness{
					Type: "none",
				},
				Stop: startup.RuntimeClientProcessStopPolicy{
					Signal:    "sigterm",
					TimeoutMs: 1000,
				},
			},
		}

		manager, err := startRuntimeClientProcesses(processes)
		if err != nil {
			t.Fatalf("expected runtime client process startup to succeed, got %v", err)
		}
		defer func() {
			_ = manager.Stop()
		}()

		select {
		case processExit := <-manager.UnexpectedExit():
			if processExit.ProcessKey != "process_exit_later" {
				t.Fatalf("expected process key process_exit_later, got %s", processExit.ProcessKey)
			}
			if processExit.Err == nil {
				t.Fatal("expected unexpected process exit error to be present")
			}
		case <-time.After(2 * time.Second):
			t.Fatal("expected unexpected process exit to be reported")
		}
	})

	t.Run("escalates sigterm to sigkill after grace period when process ignores sigterm", func(t *testing.T) {
		processes := []startup.RuntimeClientProcessSpec{
			{
				ProcessKey: "process_ignore_sigterm",
				ClientID:   "client_codex",
				Command:    helperProcessCommand("ignore-sigterm", map[string]string{}),
				Readiness: startup.RuntimeClientProcessReadiness{
					Type: "none",
				},
				Stop: startup.RuntimeClientProcessStopPolicy{
					Signal:        "sigterm",
					TimeoutMs:     1500,
					GracePeriodMs: 100,
				},
			},
		}

		manager, err := startRuntimeClientProcesses(processes)
		if err != nil {
			t.Fatalf("expected runtime client process startup to succeed, got %v", err)
		}

		if err := manager.Stop(); err != nil {
			t.Fatalf("expected stop escalation to succeed, got %v", err)
		}
	})
}

func TestRuntimeClientProcessHelper(t *testing.T) {
	if os.Getenv(runtimeClientProcessHelperEnabledEnv) != "1" {
		return
	}

	switch os.Getenv(runtimeClientProcessHelperModeEnv) {
	case "tcp-listen":
		port := os.Getenv(runtimeClientProcessHelperPortEnv)
		if strings.TrimSpace(port) == "" {
			_, _ = fmt.Fprintln(os.Stderr, "missing helper TCP listen port")
			os.Exit(2)
		}

		listener, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", port))
		if err != nil {
			_, _ = fmt.Fprintf(os.Stderr, "failed to listen on helper TCP port: %v\n", err)
			os.Exit(2)
		}
		defer listener.Close()

		for {
			connection, err := listener.Accept()
			if err != nil {
				return
			}
			_ = connection.Close()
		}
	case "exit-immediately":
		os.Exit(17)
	case "exit-after-delay":
		delayMs, err := strconv.Atoi(os.Getenv(runtimeClientProcessHelperDelayMsEnv))
		if err != nil || delayMs < 0 {
			_, _ = fmt.Fprintln(os.Stderr, "invalid helper delay")
			os.Exit(2)
		}
		time.Sleep(time.Duration(delayMs) * time.Millisecond)
		os.Exit(17)
	case "ignore-sigterm":
		termSignalCh := make(chan os.Signal, 1)
		signal.Notify(termSignalCh, syscall.SIGTERM)
		defer signal.Stop(termSignalCh)

		for {
			<-termSignalCh
		}
	default:
		_, _ = fmt.Fprintf(
			os.Stderr,
			"unsupported runtime process helper mode %q\n",
			os.Getenv(runtimeClientProcessHelperModeEnv),
		)
		os.Exit(2)
	}
}

func helperProcessCommand(mode string, env map[string]string) startup.RuntimeArtifactCommand {
	commandEnv := map[string]string{
		runtimeClientProcessHelperEnabledEnv: "1",
		runtimeClientProcessHelperModeEnv:    mode,
	}
	for key, value := range env {
		commandEnv[key] = value
	}

	return startup.RuntimeArtifactCommand{
		Args: []string{os.Args[0], "-test.run=TestRuntimeClientProcessHelper", "--"},
		Env:  commandEnv,
	}
}

func reserveTCPPort() (int, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer listener.Close()

	tcpAddress, ok := listener.Addr().(*net.TCPAddr)
	if !ok {
		return 0, fmt.Errorf("expected TCP address, got %T", listener.Addr())
	}

	return tcpAddress.Port, nil
}
