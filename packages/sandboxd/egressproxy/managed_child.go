package egressproxy

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"syscall"
	"time"
)

const childShutdownGracePeriod = 2 * time.Second

type managedChildProcess struct {
	command     *exec.Cmd
	tokenBridge *EgressTokenBridgeServer
	configFile  *os.File
	childFiles  []*os.File
	waitDone    chan error
	waitErr     error
}

type managedChildConfig struct {
	BinaryPath         string
	ListenAddr         string
	TransparentAddr    string
	SandboxInstanceID  string
	TunnelGatewayWSURL string
	Routes             []Route
	TokenProvider      EgressTokenProvider
	ProxyCACertPEM     string
	ProxyCAKeyPEM      string
	Env                []string
}

func startManagedChildProcess(config managedChildConfig) (*managedChildProcess, error) {
	if config.BinaryPath == "" {
		return nil, fmt.Errorf("egress proxy child binary path is required")
	}
	parentBridge, childBridgeFile, err := createTokenBridgePair()
	if err != nil {
		return nil, err
	}
	tokenBridge, err := StartEgressTokenBridgeServer(parentBridge, config.TokenProvider)
	if err != nil {
		_ = childBridgeFile.Close()
		return nil, err
	}
	certificateFile, err := inheritedPayloadFile("egress proxy ca certificate", config.ProxyCACertPEM)
	if err != nil {
		_ = tokenBridge.Close()
		_ = childBridgeFile.Close()
		return nil, err
	}
	privateKeyFile, err := inheritedPayloadFile("egress proxy ca private key", config.ProxyCAKeyPEM)
	if err != nil {
		_ = tokenBridge.Close()
		_ = childBridgeFile.Close()
		_ = certificateFile.Close()
		return nil, err
	}
	configFile, err := writeManagedChildConfig(config, 3, 4, 5)
	if err != nil {
		_ = tokenBridge.Close()
		_ = childBridgeFile.Close()
		_ = certificateFile.Close()
		_ = privateKeyFile.Close()
		return nil, err
	}
	command := exec.Command(config.BinaryPath, "egress-proxy", "--config", configFile.Name())
	command.Stdin = nil
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	command.ExtraFiles = []*os.File{childBridgeFile, certificateFile, privateKeyFile}
	if len(config.Env) > 0 {
		command.Env = append(os.Environ(), config.Env...)
	}
	if err := command.Start(); err != nil {
		_ = tokenBridge.Close()
		_ = childBridgeFile.Close()
		_ = certificateFile.Close()
		_ = privateKeyFile.Close()
		_ = configFile.Close()
		return nil, fmt.Errorf("failed to spawn local egress proxy child %q: %w", config.BinaryPath, err)
	}
	waitDone := make(chan error, 1)
	go func() {
		waitDone <- command.Wait()
	}()
	_ = childBridgeFile.Close()
	_ = certificateFile.Close()
	_ = privateKeyFile.Close()
	child := &managedChildProcess{
		command:     command,
		tokenBridge: tokenBridge,
		configFile:  configFile,
		childFiles:  []*os.File{childBridgeFile, certificateFile, privateKeyFile},
		waitDone:    waitDone,
	}
	return child, nil
}

func (child *managedChildProcess) PID() int {
	if child == nil || child.command == nil || child.command.Process == nil {
		return 0
	}
	return child.command.Process.Pid
}

func (child *managedChildProcess) WaitExited() (bool, error) {
	if child == nil || child.command == nil || child.command.Process == nil || child.waitDone == nil {
		return true, nil
	}
	select {
	case err := <-child.waitDone:
		child.waitErr = err
		child.waitDone = nil
		return true, err
	default:
		return false, nil
	}
}

func (child *managedChildProcess) Close() error {
	if child == nil {
		return nil
	}
	var closeErr error
	if child.command != nil && child.command.Process != nil {
		exited, err := child.WaitExited()
		if err != nil {
			closeErr = err
		}
		if !exited {
			if err := child.command.Process.Signal(syscall.SIGTERM); err != nil && closeErr == nil {
				closeErr = fmt.Errorf("failed to signal local egress proxy child: %w", err)
			}
			if !child.waitForExit(childShutdownGracePeriod) {
				_ = child.command.Process.Kill()
			}
		}
		if child.waitDone != nil {
			err := <-child.waitDone
			child.waitDone = nil
			child.waitErr = err
		}
		if child.waitErr != nil && closeErr == nil {
			if _, ok := child.waitErr.(*exec.ExitError); !ok {
				closeErr = fmt.Errorf("failed to wait for local egress proxy child: %w", child.waitErr)
			}
		}
	}
	if child.tokenBridge != nil {
		if err := child.tokenBridge.Close(); err != nil && closeErr == nil {
			closeErr = err
		}
	}
	if child.configFile != nil {
		name := child.configFile.Name()
		_ = child.configFile.Close()
		_ = os.Remove(name)
	}
	return closeErr
}

func (child *managedChildProcess) waitForExit(timeout time.Duration) bool {
	if child.waitDone == nil {
		return true
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case err := <-child.waitDone:
		child.waitDone = nil
		child.waitErr = err
		return true
	case <-timer.C:
		return false
	}
}

func createTokenBridgePair() (net.Conn, *os.File, error) {
	fds, err := syscall.Socketpair(syscall.AF_UNIX, syscall.SOCK_STREAM, 0)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create token bridge pair: %w", err)
	}
	parentFile := os.NewFile(uintptr(fds[0]), "egress token bridge parent")
	childFile := os.NewFile(uintptr(fds[1]), "egress token bridge child")
	parentConnection, err := net.FileConn(parentFile)
	_ = parentFile.Close()
	if err != nil {
		_ = childFile.Close()
		return nil, nil, fmt.Errorf("failed to open parent token bridge connection: %w", err)
	}
	return parentConnection, childFile, nil
}

func inheritedPayloadFile(name string, payload string) (*os.File, error) {
	if payload == "" {
		return nil, fmt.Errorf("%s payload is required", name)
	}
	readFile, writeFile, err := os.Pipe()
	if err != nil {
		return nil, fmt.Errorf("failed to create inherited %s pipe: %w", name, err)
	}
	if _, err := writeFile.WriteString(payload); err != nil {
		_ = readFile.Close()
		_ = writeFile.Close()
		return nil, fmt.Errorf("failed to write inherited %s payload: %w", name, err)
	}
	if err := writeFile.Close(); err != nil {
		_ = readFile.Close()
		return nil, fmt.Errorf("failed to close inherited %s pipe writer: %w", name, err)
	}
	return readFile, nil
}

func writeManagedChildConfig(config managedChildConfig, tokenBridgeFD int, certificateFD int, privateKeyFD int) (*os.File, error) {
	configFile, err := os.CreateTemp("", "mistle-egress-proxy-child-*.json")
	if err != nil {
		return nil, fmt.Errorf("failed to create egress proxy child config: %w", err)
	}
	childRoutes := make([]ChildRoute, 0, len(config.Routes))
	for _, route := range config.Routes {
		childRoutes = append(childRoutes, ChildRoute{
			EgressRuleID: route.EgressRuleID,
			Hosts:        append([]string(nil), route.Hosts...),
			PathPrefixes: append([]string(nil), route.PathPrefixes...),
			Methods:      append([]string(nil), route.Methods...),
		})
	}
	payload := ChildConfig{
		SandboxInstanceID:     config.SandboxInstanceID,
		ListenAddr:            config.ListenAddr,
		TransparentListenAddr: config.TransparentAddr,
		TunnelGatewayWSURL:    config.TunnelGatewayWSURL,
		TokenBridgeFD:         &tokenBridgeFD,
		Routes:                childRoutes,
		ProxyCACertificateFD:  certificateFD,
		ProxyCAPrivateKeyFD:   privateKeyFD,
	}
	encoder := json.NewEncoder(configFile)
	if err := encoder.Encode(payload); err != nil {
		_ = configFile.Close()
		return nil, fmt.Errorf("failed to write egress proxy child config: %w", err)
	}
	if err := configFile.Sync(); err != nil {
		_ = configFile.Close()
		return nil, fmt.Errorf("failed to flush egress proxy child config: %w", err)
	}
	return configFile, nil
}
