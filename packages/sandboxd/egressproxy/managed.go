package egressproxy

import (
	"context"
	"crypto"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/mistle/sandboxd/protocol"
	"github.com/mistle/sandboxd/runtime"
	"github.com/mistle/sandboxd/supervision"
	"github.com/mistle/sandboxd/timeutil"
)

const (
	DefaultLoopbackProxyAddr         = "127.0.0.1:38513"
	DefaultTransparentProxyAddr      = "127.0.0.1:38514"
	DefaultTransparentProxyPort      = 38514
	DefaultRuntimeProxyCACertPath    = "/run/mistle/sandboxd/egress-proxy-ca.pem"
	DefaultRuntimeProxyCABundlePath  = "/run/mistle/sandboxd/egress-proxy-ca-bundle.pem"
	DefaultPersistentProxyCACertPath = "/var/lib/mistle/sandboxd/egress-proxy-ca.pem"
	DefaultPersistentProxyCAKeyPath  = "/var/lib/mistle/sandboxd/egress-proxy-ca-key.pem"
	DefaultTrustStoreProxyCACertPath = "/usr/local/share/ca-certificates/mistle-egress-proxy-ca.crt"
	DefaultSystemCABundlePath        = "/etc/ssl/certs/ca-certificates.crt"
	DefaultTrustStoreRefreshCommand  = "update-ca-certificates"
	managedProxyHealthcheckInterval  = 250 * time.Millisecond
)

var managedProxyRestartBackoff = []time.Duration{
	0,
	250 * time.Millisecond,
	500 * time.Millisecond,
	time.Second,
	2 * time.Second,
	5 * time.Second,
}

var errManagedProxySupervisorShutdown = errors.New("egress proxy supervisor shutdown requested")

type ManagedProxyOptions struct {
	ListenAddr                string
	TransparentListenAddr     string
	RuntimeProxyCACertPath    string
	RuntimeProxyCABundlePath  string
	PersistentProxyCACertPath string
	PersistentProxyCAKeyPath  string
	TrustStoreProxyCACertPath string
	SystemCABundlePath        string
	TrustStoreRefreshCommand  string
	ChildBinaryPath           string
	ChildEnv                  []string
	HTTPClient                *http.Client
}

type ManagedProxy struct {
	runtimeEnv       map[string]string
	mode             managedProxyMode
	config           managedProxyStartConfig
	active           any
	packetRules      *TransparentPacketRules
	runtimeCACert    string
	runtimeCABundle  string
	trustStoreCACert string
	shutdown         chan struct{}
	done             chan error
	closeOnce        sync.Once
	supervisorHandle *supervision.SandboxdSupervisorHandle
}

type managedProxyMode string

const (
	managedProxyModeInProcess managedProxyMode = "in_process"
	managedProxyModeChild     managedProxyMode = "child_process"
)

type managedProxyStartConfig struct {
	listenAddr         string
	transparentAddr    string
	routes             []Route
	directGateway      DirectGatewayEgressClient
	tokenProvider      EgressTokenProvider
	httpClient         *http.Client
	sandboxInstanceID  string
	tunnelGatewayWSURL string
	proxyCACertPEM     string
	proxyCAKeyPEM      string
	childBinaryPath    string
	childEnv           []string
}

func StartManagedProxy(
	runtimePlan runtime.CompiledRuntimePlan,
	sessionInput protocol.SessionRuntimeInput,
	tokenProvider EgressTokenProvider,
	clock timeutil.Clock,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	options ManagedProxyOptions,
) (*ManagedProxy, error) {
	if !RequiresManagedProxy(runtimePlan, sessionInput) {
		return nil, nil
	}
	if tokenProvider == nil {
		return nil, fmt.Errorf("gateway egress token provider is required before starting sandbox egress proxy")
	}
	if clock == nil {
		return nil, fmt.Errorf("egress proxy clock is required")
	}
	if supervisorHandle == nil {
		return nil, fmt.Errorf("egress proxy supervisor handle is required")
	}
	listenAddr := options.ListenAddr
	if listenAddr == "" {
		listenAddr = DefaultLoopbackProxyAddr
	}
	transparentAddr := ""
	if sessionInput.TransparentProxy != nil {
		transparentAddr = options.TransparentListenAddr
		if transparentAddr == "" {
			transparentAddr = DefaultTransparentProxyAddr
		}
	}
	caBundlePath := options.RuntimeProxyCABundlePath
	if caBundlePath == "" {
		caBundlePath = DefaultRuntimeProxyCABundlePath
	}
	caCertificatePath := options.RuntimeProxyCACertPath
	if caCertificatePath == "" {
		caCertificatePath = DefaultRuntimeProxyCACertPath
	}
	routes, err := managedProxyRoutes(runtimePlan)
	if err != nil {
		return nil, err
	}
	directGateway, err := NewDirectGatewayEgressClient(sessionInput.TunnelGatewayWSURL)
	if err != nil {
		return nil, err
	}
	generatedCA, err := loadOrCreateProxyCA(options.PersistentProxyCACertPath, options.PersistentProxyCAKeyPath, clock)
	if err != nil {
		return nil, err
	}
	if err := installRuntimeProxyCA(caCertificatePath, caBundlePath, generatedCA.CertificatePEM, options); err != nil {
		return nil, err
	}
	started := false
	defer func() {
		if !started {
			_ = cleanupRuntimeProxyCA(caCertificatePath, caBundlePath, options.TrustStoreProxyCACertPath)
		}
	}()
	actualAddr := listenAddr
	var listener net.Listener
	if options.ChildBinaryPath == "" {
		listener, err = net.Listen("tcp", listenAddr)
		if err != nil {
			return nil, fmt.Errorf("failed to bind local egress proxy listener: %w", err)
		}
		actualAddr = listener.Addr().String()
	}
	stablePort, err := stablePortFromAddr(actualAddr)
	if err != nil {
		if listener != nil {
			_ = listener.Close()
		}
		return nil, err
	}
	runtimeMode := "in_process"
	if options.ChildBinaryPath != "" {
		runtimeMode = "child_process"
	}
	supervisorHandle.ReplaceComponentDetails(supervision.ComponentEgressProxy, map[string]string{
		"listenAddr":  actualAddr,
		"stablePort":  stablePort,
		"runtimeMode": runtimeMode,
	})
	supervisorHandle.MarkComponentStarting(supervision.ComponentEgressProxy)

	mode := managedProxyModeInProcess
	if options.ChildBinaryPath == "" {
		_ = listener.Close()
	} else {
		mode = managedProxyModeChild
	}
	startConfig := managedProxyStartConfig{
		listenAddr:         actualAddr,
		transparentAddr:    transparentAddr,
		routes:             routes,
		directGateway:      directGateway,
		tokenProvider:      tokenProvider,
		httpClient:         options.HTTPClient,
		sandboxInstanceID:  supervisorHandle.SandboxInstanceID(),
		tunnelGatewayWSURL: sessionInput.TunnelGatewayWSURL,
		proxyCACertPEM:     generatedCA.CertificatePEM,
		proxyCAKeyPEM:      generatedCA.PrivateKeyPEM,
		childBinaryPath:    options.ChildBinaryPath,
		childEnv:           options.ChildEnv,
	}
	active, err := startManagedProxyActive(mode, startConfig)
	if err != nil {
		supervisorHandle.MarkComponentRestarting(supervision.ComponentEgressProxy, err.Error())
		return nil, err
	}
	if err := waitForManagedProxyActiveHealth(mode, actualAddr, active); err != nil {
		_ = closeManagedProxyActive(active)
		supervisorHandle.MarkComponentRestarting(supervision.ComponentEgressProxy, err.Error())
		return nil, err
	}
	if transparentAddr != "" {
		if err := waitForManagedProxyTCPHealth(transparentAddr, managedProxyActiveDone(active)); err != nil {
			_ = closeManagedProxyActive(active)
			supervisorHandle.MarkComponentRestarting(supervision.ComponentEgressProxy, err.Error())
			return nil, err
		}
		supervisorHandle.SetComponentDetail(supervision.ComponentEgressProxy, "transparentListenAddr", transparentAddr)
	}
	var packetRules *TransparentPacketRules
	if sessionInput.TransparentProxy != nil {
		packetRules, err = InstallTransparentPacketRules(*sessionInput.TransparentProxy, DefaultTransparentProxyPort)
		if err != nil {
			_ = closeManagedProxyActive(active)
			supervisorHandle.MarkComponentRestarting(supervision.ComponentEgressProxy, err.Error())
			return nil, err
		}
		supervisorHandle.SetComponentDetail(supervision.ComponentEgressProxy, "transparentNftablesTable", packetRules.TableName)
	}
	if child, ok := active.(*managedChildProcess); ok {
		supervisorHandle.SetComponentDetail(supervision.ComponentEgressProxy, "childPid", strconv.Itoa(child.PID()))
	}
	supervisorHandle.MarkComponentHealthy(supervision.ComponentEgressProxy)
	proxy := &ManagedProxy{
		runtimeEnv:       BuildManagedProxyEnv(caBundlePath),
		mode:             mode,
		config:           startConfig,
		active:           active,
		packetRules:      packetRules,
		runtimeCACert:    caCertificatePath,
		runtimeCABundle:  caBundlePath,
		trustStoreCACert: options.TrustStoreProxyCACertPath,
		shutdown:         make(chan struct{}),
		done:             make(chan error, 1),
		supervisorHandle: supervisorHandle,
	}
	started = true
	go proxy.runSupervisor()
	return proxy, nil
}

func RequiresManagedProxy(runtimePlan runtime.CompiledRuntimePlan, sessionInput protocol.SessionRuntimeInput) bool {
	return len(runtimePlan.EgressRoutes) > 0 || sessionInput.TransparentProxy != nil
}

func (proxy *ManagedProxy) RuntimeEnvironment() map[string]string {
	if proxy == nil {
		return nil
	}
	env := make(map[string]string, len(proxy.runtimeEnv))
	for key, value := range proxy.runtimeEnv {
		env[key] = value
	}
	return env
}

func (proxy *ManagedProxy) Close() error {
	if proxy == nil {
		return nil
	}
	proxy.closeOnce.Do(func() {
		close(proxy.shutdown)
	})
	err := <-proxy.done
	if err != nil {
		return fmt.Errorf("failed to stop local egress proxy: %w", err)
	}
	return nil
}

func (proxy *ManagedProxy) runSupervisor() {
	defer func() {
		if proxy.supervisorHandle != nil {
			proxy.supervisorHandle.MarkComponentStopped(supervision.ComponentEgressProxy)
		}
	}()
	restartAttempt := 0
	ticker := time.NewTicker(managedProxyHealthcheckInterval)
	defer ticker.Stop()
	active := proxy.active
	for {
		select {
		case <-proxy.shutdown:
			proxy.done <- closeManagedProxyAndPacketRules(active, proxy.packetRules, proxy.runtimeCACert, proxy.runtimeCABundle)
			return
		case <-ticker.C:
		}

		if err := managedProxyActiveFailure(proxy.mode, proxy.config.listenAddr, proxy.config.transparentAddr, active); err != nil {
			if proxy.supervisorHandle != nil {
				proxy.supervisorHandle.MarkComponentRestarting(supervision.ComponentEgressProxy, err.Error())
				emitManagedProxyExited(proxy.supervisorHandle, active, err)
			}
			_ = closeManagedProxyActive(active)
			nextActive, restartErr := proxy.restartAfterFailure(&restartAttempt)
			if restartErr != nil {
				proxy.done <- closeManagedProxyAfterRestartFailure(restartErr, proxy.packetRules)
				return
			}
			active = nextActive
			proxy.active = nextActive
			continue
		}
	}
}

func closeManagedProxyAndPacketRules(active any, packetRules *TransparentPacketRules, runtimeCACert string, runtimeCABundle string) error {
	activeErr := closeManagedProxyActive(active)
	rulesErr := packetRules.Cleanup()
	caErr := cleanupRuntimeProxyCA(runtimeCACert, runtimeCABundle)
	if activeErr != nil {
		return activeErr
	}
	if rulesErr != nil {
		return rulesErr
	}
	return caErr
}

func cleanupRuntimeProxyCA(paths ...string) error {
	var cleanupErrors []error
	for _, path := range paths {
		if path == "" {
			continue
		}
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			cleanupErrors = append(cleanupErrors, err)
		}
	}
	if len(cleanupErrors) > 0 {
		return fmt.Errorf("failed to clean up runtime proxy ca files: %w", cleanupErrors[0])
	}
	return nil
}

func closeManagedProxyAfterRestartFailure(restartErr error, packetRules *TransparentPacketRules) error {
	cleanupErr := packetRules.Cleanup()
	if errors.Is(restartErr, errManagedProxySupervisorShutdown) {
		return cleanupErr
	}
	if cleanupErr != nil {
		return fmt.Errorf("%w; additionally failed to clean up transparent packet rules: %v", restartErr, cleanupErr)
	}
	return restartErr
}

func emitManagedProxyExited(supervisorHandle *supervision.SandboxdSupervisorHandle, active any, err error) {
	if supervisorHandle == nil || err == nil {
		return
	}
	errorText := err.Error()
	switch typed := active.(type) {
	case *managedChildProcess:
		supervisorHandle.EmitComponentExited(
			supervision.ComponentEgressProxy,
			"process_exited",
			&errorText,
			map[string]any{
				"childPid": typed.PID(),
				"exitKind": "process_exited",
			},
		)
	case *managedInProcessProxy:
		supervisorHandle.EmitComponentExited(
			supervision.ComponentEgressProxy,
			"thread_returned",
			&errorText,
			map[string]any{"exitKind": "thread_returned"},
		)
	}
}

func (proxy *ManagedProxy) restartAfterFailure(restartAttempt *int) (any, error) {
	for {
		select {
		case <-proxy.shutdown:
			return nil, errManagedProxySupervisorShutdown
		default:
		}
		backoff := managedProxyBackoff(*restartAttempt)
		if proxy.supervisorHandle != nil {
			proxy.supervisorHandle.RemoveComponentDetail(supervision.ComponentEgressProxy, "childPid")
			proxy.supervisorHandle.EmitComponentRestartScheduled(
				supervision.ComponentEgressProxy,
				"restart_after_failure",
				uint64(backoff.Milliseconds()),
				nil,
			)
		}
		if !sleepOrShutdown(backoff, proxy.shutdown) {
			return nil, errManagedProxySupervisorShutdown
		}
		if proxy.supervisorHandle != nil {
			proxy.supervisorHandle.MarkComponentStarting(supervision.ComponentEgressProxy)
		}
		active, err := startManagedProxyActive(proxy.mode, proxy.config)
		if err != nil {
			if proxy.supervisorHandle != nil {
				proxy.supervisorHandle.EmitComponentHealthcheckFailed(
					supervision.ComponentEgressProxy,
					"loopback_tcp_failed",
					err.Error(),
					"loopback_tcp",
					nil,
				)
			}
			*restartAttempt = *restartAttempt + 1
			continue
		}
		if child, ok := active.(*managedChildProcess); ok && proxy.supervisorHandle != nil {
			proxy.supervisorHandle.SetComponentDetail(supervision.ComponentEgressProxy, "childPid", strconv.Itoa(child.PID()))
		}
		if err := waitForManagedProxyActiveHealth(proxy.mode, proxy.config.listenAddr, active); err != nil {
			_ = closeManagedProxyActive(active)
			if proxy.supervisorHandle != nil {
				proxy.supervisorHandle.EmitComponentHealthcheckFailed(
					supervision.ComponentEgressProxy,
					"loopback_tcp_failed",
					err.Error(),
					"loopback_tcp",
					nil,
				)
			}
			*restartAttempt = *restartAttempt + 1
			continue
		}
		if proxy.config.transparentAddr != "" {
			if err := waitForManagedProxyTCPHealth(proxy.config.transparentAddr, managedProxyActiveDone(active)); err != nil {
				_ = closeManagedProxyActive(active)
				if proxy.supervisorHandle != nil {
					proxy.supervisorHandle.EmitComponentHealthcheckFailed(
						supervision.ComponentEgressProxy,
						"transparent_tcp_failed",
						err.Error(),
						"transparent_tcp",
						nil,
					)
				}
				*restartAttempt = *restartAttempt + 1
				continue
			}
		}
		if proxy.supervisorHandle != nil {
			proxy.supervisorHandle.MarkComponentHealthy(supervision.ComponentEgressProxy)
		}
		*restartAttempt = *restartAttempt + 1
		return active, nil
	}
}

func startManagedProxyActive(mode managedProxyMode, config managedProxyStartConfig) (any, error) {
	switch mode {
	case managedProxyModeInProcess:
		listener, err := net.Listen("tcp", config.listenAddr)
		if err != nil {
			return nil, fmt.Errorf("failed to bind local egress proxy listener: %w", err)
		}
		var transparentListener net.Listener
		if config.transparentAddr != "" {
			transparentListener, err = net.Listen("tcp", config.transparentAddr)
			if err != nil {
				_ = listener.Close()
				return nil, fmt.Errorf("failed to bind transparent egress proxy listener: %w", err)
			}
		}
		server := &http.Server{Handler: ProxyHandler{State: managedProxyState(config)}}
		active := &managedInProcessProxy{
			listener:            listener,
			server:              server,
			transparentListener: transparentListener,
			done:                make(chan error, 2),
			doneCount:           1,
		}
		go func() {
			err := server.Serve(listener)
			if err == http.ErrServerClosed {
				err = nil
			}
			active.done <- err
		}()
		if transparentListener != nil {
			active.doneCount++
			go func() {
				active.done <- RunTransparentProxyServer(transparentListener, managedProxyState(config))
			}()
		}
		return active, nil
	case managedProxyModeChild:
		return startManagedChildProcess(managedChildConfig{
			BinaryPath:         config.childBinaryPath,
			ListenAddr:         config.listenAddr,
			TransparentAddr:    config.transparentAddr,
			SandboxInstanceID:  config.sandboxInstanceID,
			TunnelGatewayWSURL: config.tunnelGatewayWSURL,
			Routes:             config.routes,
			TokenProvider:      config.tokenProvider,
			ProxyCACertPEM:     config.proxyCACertPEM,
			ProxyCAKeyPEM:      config.proxyCAKeyPEM,
			Env:                config.childEnv,
		})
	default:
		return nil, fmt.Errorf("unsupported managed egress proxy mode %q", mode)
	}
}

type managedInProcessProxy struct {
	listener            net.Listener
	server              *http.Server
	transparentListener net.Listener
	done                chan error
	doneCount           int
	doneReceived        int
	exitErr             error
}

func managedProxyState(config managedProxyStartConfig) *ProxyState {
	return &ProxyState{
		SandboxInstanceID: config.sandboxInstanceID,
		Routes:            config.routes,
		DirectGateway:     config.directGateway,
		TokenProvider:     config.tokenProvider,
		HTTPClient:        config.httpClient,
		ProxyCACertPEM:    config.proxyCACertPEM,
		ProxyCAKeyPEM:     config.proxyCAKeyPEM,
	}
}

func closeManagedProxyActive(active any) error {
	switch typed := active.(type) {
	case nil:
		return nil
	case *managedInProcessProxy:
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		shutdownErr := typed.server.Shutdown(ctx)
		if typed.transparentListener != nil {
			_ = typed.transparentListener.Close()
		}
		doneErr := typed.exitErr
		if typed.done != nil {
			for typed.doneReceived < typed.doneCount {
				err := <-typed.done
				typed.doneReceived++
				if doneErr == nil {
					doneErr = err
				}
			}
			typed.done = nil
			typed.exitErr = doneErr
		}
		if shutdownErr != nil {
			return shutdownErr
		}
		return doneErr
	case *managedChildProcess:
		return typed.Close()
	default:
		return fmt.Errorf("unsupported managed egress proxy active type %T", active)
	}
}

func managedProxyActiveFailure(mode managedProxyMode, addr string, transparentAddr string, active any) error {
	switch typed := active.(type) {
	case *managedInProcessProxy:
		select {
		case err := <-typed.done:
			typed.doneReceived++
			typed.exitErr = err
			if err == nil {
				return fmt.Errorf("local egress proxy thread returned unexpectedly")
			}
			return err
		default:
		}
	case *managedChildProcess:
		exited, err := typed.WaitExited()
		if err != nil {
			return err
		}
		if exited {
			return fmt.Errorf("local egress proxy child pid=%d returned unexpectedly", typed.PID())
		}
	default:
		return fmt.Errorf("unsupported managed egress proxy active type %T", active)
	}
	if err := checkManagedProxyTCP(addr); err != nil {
		return err
	}
	if transparentAddr != "" {
		if err := checkManagedProxyTCP(transparentAddr); err != nil {
			return err
		}
	}
	return nil
}

func waitForManagedProxyActiveHealth(mode managedProxyMode, addr string, active any) error {
	switch mode {
	case managedProxyModeInProcess:
		return waitForManagedProxyHealth(addr, active.(*managedInProcessProxy).done)
	case managedProxyModeChild:
		return waitForManagedChildProxyHealth(addr, active.(*managedChildProcess))
	default:
		return fmt.Errorf("unsupported managed egress proxy mode %q", mode)
	}
}

func managedProxyActiveDone(active any) <-chan error {
	if typed, ok := active.(*managedInProcessProxy); ok {
		return typed.done
	}
	return nil
}

func managedProxyBackoff(attempt int) time.Duration {
	if attempt < len(managedProxyRestartBackoff) {
		return managedProxyRestartBackoff[attempt]
	}
	return managedProxyRestartBackoff[len(managedProxyRestartBackoff)-1]
}

func waitForManagedProxyTCPHealth(addr string, done <-chan error) error {
	deadline := time.Now().Add(5 * time.Second)
	for {
		if done != nil {
			select {
			case err := <-done:
				if err == nil {
					return fmt.Errorf("local egress proxy exited during startup")
				}
				return err
			default:
			}
		}
		if err := checkManagedProxyTCP(addr); err == nil {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("timed out waiting for local egress proxy readiness")
		}
		time.Sleep(25 * time.Millisecond)
	}
}

func sleepOrShutdown(duration time.Duration, shutdown <-chan struct{}) bool {
	if duration == 0 {
		select {
		case <-shutdown:
			return false
		default:
			return true
		}
	}
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-shutdown:
		return false
	case <-timer.C:
		return true
	}
}

func managedProxyRoutes(runtimePlan runtime.CompiledRuntimePlan) ([]Route, error) {
	routes := make([]Route, 0, len(runtimePlan.EgressRoutes))
	for _, compiledRoute := range runtimePlan.EgressRoutes {
		route, err := BuildGatewayEgressRoute(compiledRoute)
		if err != nil {
			return nil, err
		}
		routes = append(routes, route)
	}
	return routes, nil
}

func writeRuntimeProxyCABundle(path string, certificatePEM string) error {
	if path == "" {
		return fmt.Errorf("runtime proxy ca bundle path is required")
	}
	if certificatePEM == "" {
		return fmt.Errorf("runtime proxy ca certificate is required")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("failed to create runtime proxy ca directory: %w", err)
	}
	if err := os.WriteFile(path, []byte(certificatePEM), 0o644); err != nil {
		return fmt.Errorf("failed to write runtime proxy ca bundle: %w", err)
	}
	return nil
}

func installRuntimeProxyCA(certificatePath string, bundlePath string, certificatePEM string, options ManagedProxyOptions) error {
	if options.TrustStoreProxyCACertPath == "" && options.SystemCABundlePath == "" && options.TrustStoreRefreshCommand == "" {
		return writeRuntimeProxyCABundle(bundlePath, certificatePEM)
	}
	if certificatePath == "" {
		return fmt.Errorf("runtime proxy ca certificate path is required when trust-store installation is configured")
	}
	if bundlePath == "" {
		return fmt.Errorf("runtime proxy ca bundle path is required when trust-store installation is configured")
	}
	if options.TrustStoreProxyCACertPath == "" {
		return fmt.Errorf("trust-store proxy ca certificate path is required when trust-store installation is configured")
	}
	if options.SystemCABundlePath == "" {
		return fmt.Errorf("system ca bundle path is required when trust-store installation is configured")
	}
	if options.TrustStoreRefreshCommand == "" {
		return fmt.Errorf("trust-store refresh command is required when trust-store installation is configured")
	}
	systemBundle, err := os.ReadFile(options.SystemCABundlePath)
	if err != nil {
		return fmt.Errorf("failed to read system ca bundle %q: %w", options.SystemCABundlePath, err)
	}
	if err := writeProxyCAFile(certificatePath, []byte(certificatePEM), 0o644, "runtime proxy ca certificate"); err != nil {
		return err
	}
	combinedBundle := buildCombinedCertificateBundle(systemBundle, certificatePEM)
	if err := writeProxyCAFile(bundlePath, combinedBundle, 0o644, "runtime proxy ca bundle"); err != nil {
		return err
	}
	if err := writeProxyCAFile(options.TrustStoreProxyCACertPath, []byte(certificatePEM), 0o644, "trust-store proxy ca certificate"); err != nil {
		return err
	}
	if err := runTrustStoreRefreshCommand(options.TrustStoreRefreshCommand); err != nil {
		_ = cleanupRuntimeProxyCA(certificatePath, bundlePath, options.TrustStoreProxyCACertPath)
		return err
	}
	return nil
}

func writeProxyCAFile(path string, contents []byte, mode os.FileMode, description string) error {
	if path == "" {
		return fmt.Errorf("%s path is required", description)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("failed to create %s directory %q: %w", description, filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, contents, mode); err != nil {
		return fmt.Errorf("failed to write %s %q: %w", description, path, err)
	}
	return nil
}

func buildCombinedCertificateBundle(systemBundle []byte, certificatePEM string) []byte {
	combinedBundle := make([]byte, 0, len(systemBundle)+len(certificatePEM)+1)
	combinedBundle = append(combinedBundle, systemBundle...)
	if !endsWithNewline(combinedBundle) {
		combinedBundle = append(combinedBundle, '\n')
	}
	combinedBundle = append(combinedBundle, []byte(certificatePEM)...)
	return combinedBundle
}

func endsWithNewline(value []byte) bool {
	return len(value) > 0 && value[len(value)-1] == '\n'
}

func runTrustStoreRefreshCommand(commandPath string) error {
	output, err := exec.Command(commandPath).CombinedOutput()
	if err == nil {
		return nil
	}
	return fmt.Errorf("failed to refresh system trust store with %q: %w (output=%s)", commandPath, err, string(output))
}

func loadOrCreateProxyCA(certificatePath string, privateKeyPath string, clock timeutil.Clock) (GeneratedProxyCA, error) {
	if certificatePath == "" && privateKeyPath == "" {
		return GenerateProxyCA(clock.NowSystemTime())
	}
	if certificatePath == "" {
		return GeneratedProxyCA{}, fmt.Errorf("persistent egress proxy CA certificate path is required when private key path is configured")
	}
	if privateKeyPath == "" {
		return GeneratedProxyCA{}, fmt.Errorf("persistent egress proxy CA private-key path is required when certificate path is configured")
	}

	certificateExists, err := fileExists(certificatePath)
	if err != nil {
		return GeneratedProxyCA{}, err
	}
	privateKeyExists, err := fileExists(privateKeyPath)
	if err != nil {
		return GeneratedProxyCA{}, err
	}

	switch {
	case certificateExists && privateKeyExists:
		return loadPersistentProxyCA(certificatePath, privateKeyPath)
	case !certificateExists && !privateKeyExists:
		generatedCA, err := GenerateProxyCA(clock.NowSystemTime())
		if err != nil {
			return GeneratedProxyCA{}, err
		}
		if err := writePersistentProxyCA(certificatePath, privateKeyPath, generatedCA); err != nil {
			return GeneratedProxyCA{}, err
		}
		return generatedCA, nil
	case certificateExists:
		return GeneratedProxyCA{}, fmt.Errorf(
			"persistent egress proxy CA certificate exists at %q but private key is missing at %q",
			certificatePath,
			privateKeyPath,
		)
	default:
		return GeneratedProxyCA{}, fmt.Errorf(
			"persistent egress proxy CA private key exists at %q but certificate is missing at %q",
			privateKeyPath,
			certificatePath,
		)
	}
}

func fileExists(path string) (bool, error) {
	_, err := os.Stat(path)
	if err == nil {
		return true, nil
	}
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	return false, fmt.Errorf("failed to inspect persistent egress proxy CA file %q: %w", path, err)
}

func loadPersistentProxyCA(certificatePath string, privateKeyPath string) (GeneratedProxyCA, error) {
	certificatePEM, err := os.ReadFile(certificatePath)
	if err != nil {
		return GeneratedProxyCA{}, fmt.Errorf("failed to read persistent egress proxy CA certificate %q: %w", certificatePath, err)
	}
	privateKeyPEM, err := os.ReadFile(privateKeyPath)
	if err != nil {
		return GeneratedProxyCA{}, fmt.Errorf("failed to read persistent egress proxy CA private key %q: %w", privateKeyPath, err)
	}
	generatedCA := GeneratedProxyCA{CertificatePEM: string(certificatePEM), PrivateKeyPEM: string(privateKeyPEM)}
	if err := validateProxyCA(generatedCA); err != nil {
		return GeneratedProxyCA{}, err
	}
	return generatedCA, nil
}

func writePersistentProxyCA(certificatePath string, privateKeyPath string, generatedCA GeneratedProxyCA) error {
	if err := validateProxyCA(generatedCA); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(certificatePath), 0o700); err != nil {
		return fmt.Errorf("failed to create persistent egress proxy CA certificate directory %q: %w", filepath.Dir(certificatePath), err)
	}
	if err := os.MkdirAll(filepath.Dir(privateKeyPath), 0o700); err != nil {
		return fmt.Errorf("failed to create persistent egress proxy CA private-key directory %q: %w", filepath.Dir(privateKeyPath), err)
	}
	if err := writeNewProxyCAFile(certificatePath, []byte(generatedCA.CertificatePEM), 0o644); err != nil {
		return fmt.Errorf("failed to write persistent egress proxy CA certificate %q: %w", certificatePath, err)
	}
	if err := writeNewProxyCAFile(privateKeyPath, []byte(generatedCA.PrivateKeyPEM), 0o600); err != nil {
		_ = os.Remove(certificatePath)
		return fmt.Errorf("failed to write persistent egress proxy CA private key %q: %w", privateKeyPath, err)
	}
	return nil
}

func writeNewProxyCAFile(path string, contents []byte, mode os.FileMode) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
	if err != nil {
		return err
	}
	defer file.Close()
	if _, err := file.Write(contents); err != nil {
		return err
	}
	return nil
}

func validateProxyCA(generatedCA GeneratedProxyCA) error {
	if _, err := parseCertificatePEM(generatedCA.CertificatePEM, "persistent egress proxy CA certificate"); err != nil {
		return err
	}
	privateKey, err := parsePrivateKeyPEM(generatedCA.PrivateKeyPEM, "persistent egress proxy CA private key")
	if err != nil {
		return err
	}
	if _, ok := privateKey.(crypto.Signer); !ok {
		return fmt.Errorf("persistent egress proxy CA private key does not support signing")
	}
	return nil
}

func waitForManagedProxyHealth(addr string, done <-chan error) error {
	deadline := time.Now().Add(5 * time.Second)
	for {
		select {
		case err := <-done:
			if err == nil {
				return fmt.Errorf("local egress proxy exited during startup")
			}
			return err
		default:
		}
		if err := checkManagedProxyTCP(addr); err == nil {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("timed out waiting for local egress proxy readiness")
		}
		time.Sleep(25 * time.Millisecond)
	}
}

func waitForManagedChildProxyHealth(addr string, child *managedChildProcess) error {
	deadline := time.Now().Add(5 * time.Second)
	for {
		exited, err := child.WaitExited()
		if err != nil {
			return err
		}
		if exited {
			return fmt.Errorf("local egress proxy child exited during startup")
		}
		if err := checkManagedProxyTCP(addr); err == nil {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("timed out waiting for local egress proxy child readiness")
		}
		time.Sleep(25 * time.Millisecond)
	}
}

func checkManagedProxyTCP(addr string) error {
	connection, err := net.DialTimeout("tcp", addr, 100*time.Millisecond)
	if err != nil {
		return fmt.Errorf("loopback tcp healthcheck failed: %w", err)
	}
	_ = connection.Close()
	return nil
}

func stablePortFromAddr(addr string) (string, error) {
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		return "", fmt.Errorf("failed to inspect local egress proxy listener address %q: %w", addr, err)
	}
	if port == "0" {
		return "", fmt.Errorf("egress proxy child process requires a stable listener port")
	}
	return port, nil
}
