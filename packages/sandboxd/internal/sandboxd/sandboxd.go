package sandboxd

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"

	"github.com/mistle/sandboxd/control"
	"github.com/mistle/sandboxd/egressproxy"
	"github.com/mistle/sandboxd/security"
)

const (
	Version                  = "0.31.0"
	DefaultSignerAliasName   = "mistle-ssh-sign"
	ControlSocketPathEnvName = "MISTLE_SANDBOXD_CONTROL_SOCKET_PATH"
	defaultControlSocketPath = "/run/mistle/sandboxd/control.sock"
)

type CommandKind string

const (
	CommandDaemon      CommandKind = "daemon"
	CommandEgressProxy CommandKind = "egress-proxy"
	CommandReady       CommandKind = "ready"
	CommandShutdown    CommandKind = "shutdown"
	CommandActivate    CommandKind = "activate"
	CommandSign        CommandKind = "sign"
	CommandSkills      CommandKind = "skills"
	CommandVersion     CommandKind = "version"
)

type Command struct {
	Kind                  CommandKind
	EgressProxyConfigPath string
	ActivatePayloadSource StartupPayloadSource
	SkillsArgs            []string
}

func ParseCommand(args []string) (Command, error) {
	if len(args) == 0 {
		return Command{Kind: CommandDaemon}, nil
	}

	command := args[0]
	remaining := args[1:]
	switch command {
	case "egress-proxy":
		configPath, err := parseEgressProxyArgs(remaining)
		if err != nil {
			return Command{}, err
		}
		return Command{Kind: CommandEgressProxy, EgressProxyConfigPath: configPath}, nil
	case "ready":
		if err := rejectUnexpectedArgs(remaining); err != nil {
			return Command{}, err
		}
		return Command{Kind: CommandReady}, nil
	case "shutdown":
		if err := rejectUnexpectedArgs(remaining); err != nil {
			return Command{}, err
		}
		return Command{Kind: CommandShutdown}, nil
	case "activate":
		source, err := parsePayloadSourceArgs(remaining)
		if err != nil {
			return Command{}, err
		}
		return Command{Kind: CommandActivate, ActivatePayloadSource: source}, nil
	case "skills":
		return Command{Kind: CommandSkills, SkillsArgs: remaining}, nil
	case "version":
		if err := rejectUnexpectedArgs(remaining); err != nil {
			return Command{}, err
		}
		return Command{Kind: CommandVersion}, nil
	default:
		return Command{}, fmt.Errorf("unknown sandboxd subcommand '%s' (expected 'ready', 'activate', 'shutdown', 'egress-proxy', 'skills', or 'version')", command)
	}
}

func Run(programName string, args []string, stdin io.Reader, stdout io.Writer, stderr io.Writer) int {
	return runWithControlSocket(programName, args, stdin, stdout, stderr, configuredControlSocketPath())
}

func runWithControlSocket(
	programName string,
	args []string,
	stdin io.Reader,
	stdout io.Writer,
	stderr io.Writer,
	controlSocketPath string,
) int {
	return runWithControlSocketAndHealthEndpoint(programName, args, stdin, stdout, stderr, controlSocketPath, control.DefaultHealthEndpointAddr)
}

func runWithControlSocketAndHealthEndpoint(
	programName string,
	args []string,
	stdin io.Reader,
	stdout io.Writer,
	stderr io.Writer,
	controlSocketPath string,
	healthEndpointAddr string,
) int {
	command := Command{Kind: CommandSign}
	var err error
	if !isSignerAlias(programName) {
		command, err = ParseCommand(args)
		if err != nil {
			_, _ = fmt.Fprintln(stderr, err.Error())
			return 1
		}
	}

	switch command.Kind {
	case CommandVersion:
		if _, err := fmt.Fprintln(stdout, Version); err != nil {
			_, _ = fmt.Fprintf(stderr, "failed to write sandboxd version: %v\n", err)
			return 1
		}
		return 0
	case CommandActivate:
		if err := RunActivate(stdin, stdout, controlSocketPath, command.ActivatePayloadSource); err != nil {
			_, _ = fmt.Fprintln(stderr, err.Error())
			return 1
		}
		return 0
	case CommandReady:
		if err := control.SubmitReady(controlSocketPath); err != nil {
			_, _ = fmt.Fprintln(stderr, err.Error())
			return 1
		}
		return 0
	case CommandShutdown:
		if err := control.SubmitShutdown(controlSocketPath); err != nil {
			_, _ = fmt.Fprintln(stderr, err.Error())
			return 1
		}
		return 0
	case CommandSign:
		if err := RunSign(args, controlSocketPath); err != nil {
			_, _ = fmt.Fprintln(stderr, err.Error())
			return 1
		}
		return 0
	case CommandSkills:
		if err := RunSkills(command.SkillsArgs, stdout); err != nil {
			_, _ = fmt.Fprintln(stderr, err.Error())
			return 1
		}
		return 0
	case CommandEgressProxy:
		if err := egressproxy.RunEgressProxyChild(command.EgressProxyConfigPath); err != nil {
			_, _ = fmt.Fprintln(stderr, err.Error())
			return 1
		}
		return 0
	case CommandDaemon:
		if err := security.ApplyCurrentProcessSecurity(); err != nil {
			_, _ = fmt.Fprintln(stderr, err.Error())
			return 1
		}
		server, err := control.StartServerWithHealthEndpoint(controlSocketPath, healthEndpointAddr)
		if err != nil {
			_, _ = fmt.Fprintln(stderr, err.Error())
			return 1
		}
		if err := server.Wait(); err != nil {
			_, _ = fmt.Fprintln(stderr, err.Error())
			return 1
		}
		return 0
	default:
		_, _ = fmt.Fprintf(stderr, "unknown parsed sandboxd command: %s\n", command.Kind)
		return 1
	}
}

func parseEgressProxyArgs(args []string) (string, error) {
	var configPath string
	for index := 0; index < len(args); index++ {
		argument := args[index]
		switch argument {
		case "--config":
			index++
			if index >= len(args) {
				return "", errors.New("sandboxd egress-proxy --config requires a config path")
			}
			configPath = args[index]
		default:
			return "", fmt.Errorf("unexpected sandboxd argument: %s", argument)
		}
	}
	if configPath == "" {
		return "", errors.New("sandboxd egress-proxy --config requires a config path")
	}
	return configPath, nil
}

func parsePayloadSourceArgs(args []string) (StartupPayloadSource, error) {
	source := StartupPayloadSource{Kind: StartupPayloadUntilEOF}
	for index := 0; index < len(args); index++ {
		argument := args[index]
		switch argument {
		case "--stdin-bytes":
			index++
			if index >= len(args) {
				return StartupPayloadSource{}, errors.New("sandboxd --stdin-bytes requires a byte count")
			}
			byteCount, err := strconv.Atoi(args[index])
			if err != nil || byteCount < 0 {
				return StartupPayloadSource{}, fmt.Errorf("sandboxd --stdin-bytes must be a non-negative integer: %s", args[index])
			}
			source = StartupPayloadSource{Kind: StartupPayloadBytes, ByteCount: byteCount}
		default:
			return StartupPayloadSource{}, fmt.Errorf("unexpected sandboxd argument: %s", argument)
		}
	}
	return source, nil
}

func rejectUnexpectedArgs(args []string) error {
	if len(args) > 0 {
		return fmt.Errorf("unexpected sandboxd argument: %s", args[0])
	}
	return nil
}

func isSignerAlias(programName string) bool {
	return filepath.Base(programName) == DefaultSignerAliasName
}

func configuredControlSocketPath() string {
	if path := os.Getenv(ControlSocketPathEnvName); path != "" {
		return path
	}
	return defaultControlSocketPath
}
