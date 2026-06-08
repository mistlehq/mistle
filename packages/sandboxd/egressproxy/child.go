package egressproxy

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"strings"
)

type ChildConfig struct {
	SandboxInstanceID     string       `json:"sandboxInstanceId"`
	ListenAddr            string       `json:"listenAddr"`
	TransparentListenAddr string       `json:"transparentListenAddr,omitempty"`
	TunnelGatewayWSURL    string       `json:"tunnelGatewayWsUrl"`
	TokenBridgeFD         *int         `json:"tokenBridgeFd"`
	Routes                []ChildRoute `json:"routes"`
	ProxyCACertificateFD  int          `json:"proxyCaCertificateFd"`
	ProxyCAPrivateKeyFD   int          `json:"proxyCaPrivateKeyFd"`
}

type ChildRoute struct {
	EgressRuleID string   `json:"egressRuleId"`
	Hosts        []string `json:"hosts"`
	PathPrefixes []string `json:"pathPrefixes"`
	Methods      []string `json:"methods"`
}

func ReadChildConfig(configPath string) (ChildConfig, error) {
	configFile, err := os.Open(configPath)
	if err != nil {
		return ChildConfig{}, fmt.Errorf("failed to read egress proxy child config %q: %w", configPath, err)
	}
	defer configFile.Close()

	decoder := json.NewDecoder(configFile)
	decoder.DisallowUnknownFields()
	var config ChildConfig
	if err := decoder.Decode(&config); err != nil {
		return ChildConfig{}, fmt.Errorf("failed to parse egress proxy child config %q: %w", configPath, err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return ChildConfig{}, fmt.Errorf("failed to parse egress proxy child config %q: unexpected trailing JSON data", configPath)
		}
		return ChildConfig{}, fmt.Errorf("failed to parse egress proxy child config %q: unexpected trailing JSON data", configPath)
	}
	if _, err := net.ResolveTCPAddr("tcp", config.ListenAddr); err != nil {
		return ChildConfig{}, fmt.Errorf("failed to parse egress proxy child config %q: listenAddr must be a socket address: %w", configPath, err)
	}
	if config.TransparentListenAddr != "" {
		if _, err := net.ResolveTCPAddr("tcp", config.TransparentListenAddr); err != nil {
			return ChildConfig{}, fmt.Errorf("failed to parse egress proxy child config %q: transparentListenAddr must be a socket address: %w", configPath, err)
		}
	}
	if config.SandboxInstanceID == "" {
		return ChildConfig{}, fmt.Errorf("failed to parse egress proxy child config %q: sandboxInstanceId is required", configPath)
	}
	if config.TunnelGatewayWSURL == "" {
		return ChildConfig{}, fmt.Errorf("failed to parse egress proxy child config %q: tunnelGatewayWsUrl is required", configPath)
	}
	if config.TokenBridgeFD == nil {
		return ChildConfig{}, fmt.Errorf("failed to parse egress proxy child config %q: tokenBridgeFd is required", configPath)
	}
	if config.ProxyCACertificateFD < 0 {
		return ChildConfig{}, fmt.Errorf("proxy ca certificate fd must be non-negative")
	}
	if config.ProxyCAPrivateKeyFD < 0 {
		return ChildConfig{}, fmt.Errorf("proxy ca private key fd must be non-negative")
	}
	if config.TokenBridgeFD != nil && *config.TokenBridgeFD < 0 {
		return ChildConfig{}, fmt.Errorf("token bridge fd must be non-negative")
	}
	return config, nil
}

func RunEgressProxyChild(configPath string) error {
	config, err := ReadChildConfig(configPath)
	if err != nil {
		return err
	}
	listener, err := net.Listen("tcp", config.ListenAddr)
	if err != nil {
		return fmt.Errorf("failed to bind local egress proxy listener: %w", err)
	}
	state, err := BuildChildProxyState(config)
	if err != nil {
		listener.Close()
		return err
	}
	if config.TransparentListenAddr == "" {
		return RunProxyServer(listener, state)
	}
	transparentListener, err := net.Listen("tcp", config.TransparentListenAddr)
	if err != nil {
		listener.Close()
		return fmt.Errorf("failed to bind transparent egress proxy listener: %w", err)
	}
	done := make(chan error, 2)
	go func() {
		done <- RunProxyServer(listener, state)
	}()
	go func() {
		done <- RunTransparentProxyServer(transparentListener, state)
	}()
	err = <-done
	_ = listener.Close()
	_ = transparentListener.Close()
	if err != nil {
		return err
	}
	return nil
}

func BuildChildProxyState(config ChildConfig) (*ProxyState, error) {
	if config.TokenBridgeFD == nil {
		return nil, fmt.Errorf("egress proxy child tokenBridgeFd is required")
	}
	directGateway, err := NewDirectGatewayEgressClient(config.TunnelGatewayWSURL)
	if err != nil {
		return nil, err
	}
	tokenProvider, err := NewEgressTokenBridgeClientFromFD(*config.TokenBridgeFD)
	if err != nil {
		return nil, err
	}
	caCertificatePEM, err := ReadPEMFromInheritedFD("proxy ca certificate", config.ProxyCACertificateFD)
	if err != nil {
		tokenProvider.Close()
		return nil, err
	}
	caPrivateKeyPEM, err := ReadPEMFromInheritedFD("proxy ca private key", config.ProxyCAPrivateKeyFD)
	if err != nil {
		tokenProvider.Close()
		return nil, err
	}
	return &ProxyState{
		SandboxInstanceID: config.SandboxInstanceID,
		Routes:            config.EgressRoutes(),
		DirectGateway:     directGateway,
		TokenProvider:     tokenProvider,
		ProxyCACertPEM:    caCertificatePEM,
		ProxyCAKeyPEM:     caPrivateKeyPEM,
	}, nil
}

func (config ChildConfig) EgressRoutes() []Route {
	routes := make([]Route, 0, len(config.Routes))
	for _, route := range config.Routes {
		routes = append(routes, Route{
			EgressRuleID: route.EgressRuleID,
			Hosts:        append([]string(nil), route.Hosts...),
			PathPrefixes: append([]string(nil), route.PathPrefixes...),
			Methods:      append([]string(nil), route.Methods...),
		})
	}
	return routes
}

func ReadPEMFromInheritedFD(name string, fd int) (string, error) {
	if fd < 0 {
		return "", fmt.Errorf("%s fd must be non-negative", name)
	}
	file := os.NewFile(uintptr(fd), name)
	if file == nil {
		return "", fmt.Errorf("failed to read inherited %s fd %d: invalid file descriptor", name, fd)
	}
	defer file.Close()

	payloadBytes, err := io.ReadAll(file)
	if err != nil {
		return "", fmt.Errorf("failed to read inherited %s fd %d: %w", name, fd, err)
	}
	payload := string(payloadBytes)
	if strings.TrimSpace(payload) == "" {
		return "", fmt.Errorf("%s payload is empty", name)
	}
	return payload, nil
}
