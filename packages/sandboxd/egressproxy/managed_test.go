package egressproxy

import (
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/mistle/sandboxd/protocol"
	"github.com/mistle/sandboxd/runtime"
	"github.com/mistle/sandboxd/supervision"
	"github.com/mistle/sandboxd/timeutil"
)

func TestManagedProxyStartsLoopbackProxyWithRuntimeEnvironment(t *testing.T) {
	var gatewayTarget string
	gateway := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		assertEqual(t, request.URL.Path, DirectEgressHTTPRoutePath)
		gatewayTarget = request.URL.Query().Get("target")
		assertEqual(t, request.Header.Get(DirectGatewayEgressAuthorizationHeaderName), "Bearer gateway-token")
		responseWriter.WriteHeader(http.StatusAccepted)
		_, _ = responseWriter.Write([]byte("gateway response"))
	}))
	defer gateway.Close()
	gatewayURL, err := url.Parse(gateway.URL)
	requireNoError(t, err)
	gatewayURL.Scheme = "ws"
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sbi_egress",
		timeutil.NewMutableClock(1_700_000_000_000),
		[]supervision.SupervisedComponent{supervision.ComponentEgressProxy},
	)
	requireNoError(t, err)
	caBundlePath := filepath.Join(t.TempDir(), "egress-proxy-ca-bundle.pem")

	proxy, err := StartManagedProxy(
		managedProxyRuntimePlan(),
		protocol.SessionRuntimeInput{TunnelGatewayWSURL: gatewayURL.String()},
		StaticEgressTokenProvider{TokenValue: "gateway-token"},
		timeutil.NewMutableClock(1_700_000_000_000),
		supervisorHandle,
		ManagedProxyOptions{ListenAddr: "127.0.0.1:0", RuntimeProxyCABundlePath: caBundlePath},
	)
	requireNoError(t, err)
	defer proxy.Close()

	env := proxy.RuntimeEnvironment()
	assertEqual(t, env[SSL_CERT_FILE], caBundlePath)
	assertEqual(t, env[NODE_EXTRA_CA_CERTS], caBundlePath)
	snapshot := supervisorHandle.Snapshot().Components[0]
	assertEqual(t, snapshot.Component, supervision.ComponentEgressProxy)
	assertEqual(t, snapshot.State, supervision.ComponentHealthy)
	proxyURL, err := url.Parse("http://" + snapshot.Details["listenAddr"])
	requireNoError(t, err)
	client := http.Client{Transport: &http.Transport{Proxy: http.ProxyURL(proxyURL)}}
	request, err := http.NewRequest(http.MethodPost, "http://api.example.test/v1/allowed", strings.NewReader("gateway body"))
	requireNoError(t, err)

	response, err := client.Do(request)

	requireNoError(t, err)
	defer response.Body.Close()
	assertEqual(t, response.StatusCode, http.StatusAccepted)
	body, err := io.ReadAll(response.Body)
	requireNoError(t, err)
	assertEqual(t, string(body), "gateway response")
	assertEqual(t, gatewayTarget, "http://api.example.test/v1/allowed")
}

func TestManagedProxyRestartsInProcessProxyAfterServerExit(t *testing.T) {
	gateway := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		assertEqual(t, request.URL.Path, DirectEgressHTTPRoutePath)
		assertEqual(t, request.Header.Get(DirectGatewayEgressAuthorizationHeaderName), "Bearer gateway-token")
		responseWriter.WriteHeader(http.StatusAccepted)
		_, _ = responseWriter.Write([]byte("gateway response"))
	}))
	defer gateway.Close()
	gatewayURL, err := url.Parse(gateway.URL)
	requireNoError(t, err)
	gatewayURL.Scheme = "ws"
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sbi_egress_restart",
		timeutil.NewMutableClock(1_700_000_000_000),
		[]supervision.SupervisedComponent{supervision.ComponentEgressProxy},
	)
	requireNoError(t, err)
	listenAddr := reserveManagedProxyListenAddr(t)
	caBundlePath := filepath.Join(t.TempDir(), "egress-proxy-ca-bundle.pem")
	proxy, err := StartManagedProxy(
		managedProxyRuntimePlan(),
		protocol.SessionRuntimeInput{TunnelGatewayWSURL: gatewayURL.String()},
		StaticEgressTokenProvider{TokenValue: "gateway-token"},
		timeutil.NewMutableClock(1_700_000_000_000),
		supervisorHandle,
		ManagedProxyOptions{ListenAddr: listenAddr, RuntimeProxyCABundlePath: caBundlePath},
	)
	requireNoError(t, err)
	defer proxy.Close()
	initialEnv := proxy.RuntimeEnvironment()
	initialSnapshot := supervisorHandle.Snapshot().Components[0]
	assertEqual(t, initialSnapshot.Details["listenAddr"], listenAddr)
	assertEqual(t, initialSnapshot.Details["stablePort"], mustPortFromAddr(t, listenAddr))

	forceManagedProxyInProcessServerExit(t, proxy)
	restartedSnapshot := waitForManagedProxyRestart(t, supervisorHandle, initialSnapshot.RestartCount)
	assertEqual(t, restartedSnapshot.Details["listenAddr"], listenAddr)
	assertEqual(t, restartedSnapshot.Details["stablePort"], mustPortFromAddr(t, listenAddr))
	assertEqual(t, proxy.RuntimeEnvironment()[SSL_CERT_FILE], initialEnv[SSL_CERT_FILE])

	proxyURL, err := url.Parse("http://" + restartedSnapshot.Details["listenAddr"])
	requireNoError(t, err)
	client := http.Client{Transport: &http.Transport{Proxy: http.ProxyURL(proxyURL)}}
	request, err := http.NewRequest(http.MethodPost, "http://api.example.test/v1/allowed", strings.NewReader("gateway body"))
	requireNoError(t, err)
	response, err := client.Do(request)
	requireNoError(t, err)
	defer response.Body.Close()
	assertEqual(t, response.StatusCode, http.StatusAccepted)
}

func TestManagedProxyPersistsProxyCAAndReusesItAcrossStarts(t *testing.T) {
	gatewayURL, closeGateway := startManagedProxyGateway(t)
	defer closeGateway()
	supervisorHandle := newManagedProxySupervisor(t, "sbi_egress_persistent_ca")
	paths := managedProxyCAPaths(t)

	firstProxy, err := StartManagedProxy(
		managedProxyRuntimePlan(),
		protocol.SessionRuntimeInput{TunnelGatewayWSURL: gatewayURL},
		StaticEgressTokenProvider{TokenValue: "gateway-token"},
		timeutil.NewMutableClock(1_700_000_000_000),
		supervisorHandle,
		ManagedProxyOptions{
			ListenAddr:                "127.0.0.1:0",
			RuntimeProxyCABundlePath:  paths.runtimeBundlePath,
			PersistentProxyCACertPath: paths.persistentCertificatePath,
			PersistentProxyCAKeyPath:  paths.persistentPrivateKeyPath,
		},
	)
	requireNoError(t, err)

	firstCertificate := readFileText(t, paths.persistentCertificatePath)
	firstPrivateKey := readFileText(t, paths.persistentPrivateKeyPath)
	assertEqual(t, readFileText(t, paths.runtimeBundlePath), firstCertificate)
	requireNoError(t, firstProxy.Close())

	secondProxy, err := StartManagedProxy(
		managedProxyRuntimePlan(),
		protocol.SessionRuntimeInput{TunnelGatewayWSURL: gatewayURL},
		StaticEgressTokenProvider{TokenValue: "gateway-token"},
		timeutil.NewMutableClock(1_700_000_100_000),
		supervisorHandle,
		ManagedProxyOptions{
			ListenAddr:                "127.0.0.1:0",
			RuntimeProxyCABundlePath:  paths.runtimeBundlePath,
			PersistentProxyCACertPath: paths.persistentCertificatePath,
			PersistentProxyCAKeyPath:  paths.persistentPrivateKeyPath,
		},
	)
	requireNoError(t, err)
	defer secondProxy.Close()

	assertEqual(t, readFileText(t, paths.persistentCertificatePath), firstCertificate)
	assertEqual(t, readFileText(t, paths.persistentPrivateKeyPath), firstPrivateKey)
	assertEqual(t, readFileText(t, paths.runtimeBundlePath), firstCertificate)
}

func TestManagedProxyInstallsCombinedCABundleAndCleansRuntimeCAFilesOnClose(t *testing.T) {
	gatewayURL, closeGateway := startManagedProxyGateway(t)
	defer closeGateway()
	paths := managedProxyCAPaths(t)
	systemBundlePath := filepath.Join(t.TempDir(), "system-ca-certificates.crt")
	requireNoError(t, os.WriteFile(systemBundlePath, []byte("-----BEGIN CERTIFICATE-----\nsystem-root\n-----END CERTIFICATE-----\n"), 0o644))
	refreshLogPath := filepath.Join(t.TempDir(), "refresh.log")
	refreshCommandPath := filepath.Join(t.TempDir(), "update-ca-certificates")
	requireNoError(t, os.WriteFile(refreshCommandPath, []byte("#!/bin/sh\nprintf refreshed > '"+refreshLogPath+"'\n"), 0o700))
	trustStorePath := filepath.Join(t.TempDir(), "trust-store", "mistle-egress-proxy-ca.crt")
	runtimeCertificatePath := filepath.Join(t.TempDir(), "runtime", "egress-proxy-ca.pem")

	proxy, err := StartManagedProxy(
		managedProxyRuntimePlan(),
		protocol.SessionRuntimeInput{TunnelGatewayWSURL: gatewayURL},
		StaticEgressTokenProvider{TokenValue: "gateway-token"},
		timeutil.NewMutableClock(1_700_000_000_000),
		newManagedProxySupervisor(t, "sbi_egress_ca_install"),
		ManagedProxyOptions{
			ListenAddr:                "127.0.0.1:0",
			RuntimeProxyCACertPath:    runtimeCertificatePath,
			RuntimeProxyCABundlePath:  paths.runtimeBundlePath,
			PersistentProxyCACertPath: paths.persistentCertificatePath,
			PersistentProxyCAKeyPath:  paths.persistentPrivateKeyPath,
			TrustStoreProxyCACertPath: trustStorePath,
			SystemCABundlePath:        systemBundlePath,
			TrustStoreRefreshCommand:  refreshCommandPath,
		},
	)
	requireNoError(t, err)

	persistentCertificate := readFileText(t, paths.persistentCertificatePath)
	assertEqual(t, readFileText(t, runtimeCertificatePath), persistentCertificate)
	assertEqual(t, readFileText(t, trustStorePath), persistentCertificate)
	runtimeBundle := readFileText(t, paths.runtimeBundlePath)
	assertEqual(t, strings.HasPrefix(runtimeBundle, readFileText(t, systemBundlePath)), true)
	assertEqual(t, strings.HasSuffix(runtimeBundle, persistentCertificate), true)
	assertEqual(t, readFileText(t, refreshLogPath), "refreshed")

	requireNoError(t, proxy.Close())
	if _, err := os.Stat(runtimeCertificatePath); !os.IsNotExist(err) {
		t.Fatalf("expected runtime proxy ca certificate to be removed after close, got %v", err)
	}
	if _, err := os.Stat(paths.runtimeBundlePath); !os.IsNotExist(err) {
		t.Fatalf("expected runtime proxy ca bundle to be removed after close, got %v", err)
	}
	assertEqual(t, readFileText(t, paths.persistentCertificatePath), persistentCertificate)
	assertEqual(t, readFileText(t, trustStorePath), persistentCertificate)
}

func TestManagedProxyCleansRuntimeCAFilesWhenStartupFailsAfterCAInstall(t *testing.T) {
	gatewayURL, closeGateway := startManagedProxyGateway(t)
	defer closeGateway()
	paths := managedProxyCAPaths(t)
	runtimeCertificatePath := filepath.Join(t.TempDir(), "runtime", "egress-proxy-ca.pem")
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	requireNoError(t, err)
	defer listener.Close()

	_, err = StartManagedProxy(
		managedProxyRuntimePlan(),
		protocol.SessionRuntimeInput{TunnelGatewayWSURL: gatewayURL},
		StaticEgressTokenProvider{TokenValue: "gateway-token"},
		timeutil.NewMutableClock(1_700_000_000_000),
		newManagedProxySupervisor(t, "sbi_egress_ca_start_failure"),
		ManagedProxyOptions{
			ListenAddr:                listener.Addr().String(),
			RuntimeProxyCACertPath:    runtimeCertificatePath,
			RuntimeProxyCABundlePath:  paths.runtimeBundlePath,
			PersistentProxyCACertPath: paths.persistentCertificatePath,
			PersistentProxyCAKeyPath:  paths.persistentPrivateKeyPath,
		},
	)

	if err == nil {
		t.Fatalf("expected listener bind failure")
	}
	if !strings.Contains(err.Error(), "failed to bind local egress proxy listener") {
		t.Fatalf("expected listener bind error, got %v", err)
	}
	if _, statErr := os.Stat(runtimeCertificatePath); !os.IsNotExist(statErr) {
		t.Fatalf("expected runtime proxy ca certificate to be removed after failed start, got %v", statErr)
	}
	if _, statErr := os.Stat(paths.runtimeBundlePath); !os.IsNotExist(statErr) {
		t.Fatalf("expected runtime proxy ca bundle to be removed after failed start, got %v", statErr)
	}
}

func TestManagedProxyFailsWhenPersistentProxyCAStateIsPartial(t *testing.T) {
	gatewayURL, closeGateway := startManagedProxyGateway(t)
	defer closeGateway()
	paths := managedProxyCAPaths(t)
	requireNoError(t, os.MkdirAll(filepath.Dir(paths.persistentCertificatePath), 0o700))
	requireNoError(t, os.WriteFile(paths.persistentCertificatePath, []byte("certificate"), 0o644))

	_, err := StartManagedProxy(
		managedProxyRuntimePlan(),
		protocol.SessionRuntimeInput{TunnelGatewayWSURL: gatewayURL},
		StaticEgressTokenProvider{TokenValue: "gateway-token"},
		timeutil.NewMutableClock(1_700_000_000_000),
		newManagedProxySupervisor(t, "sbi_egress_partial_ca"),
		ManagedProxyOptions{
			ListenAddr:                "127.0.0.1:0",
			RuntimeProxyCABundlePath:  paths.runtimeBundlePath,
			PersistentProxyCACertPath: paths.persistentCertificatePath,
			PersistentProxyCAKeyPath:  paths.persistentPrivateKeyPath,
		},
	)

	if err == nil {
		t.Fatalf("expected partial persistent proxy CA state to fail")
	}
	errorText := err.Error()
	if !strings.Contains(errorText, "certificate exists") || !strings.Contains(errorText, "private key is missing") {
		t.Fatalf("expected explicit partial CA state error, got %q", errorText)
	}
	if _, statErr := os.Stat(paths.persistentPrivateKeyPath); !os.IsNotExist(statErr) {
		t.Fatalf("expected partial persistent CA state not to create a private key, got %v", statErr)
	}
}

func managedProxyRuntimePlan() runtime.CompiledRuntimePlan {
	return runtime.CompiledRuntimePlan{
		SandboxProfileID: "profile_egress",
		Version:          1,
		Image: runtime.CompiledRuntimePlanImage{
			Source:   runtime.CompiledRuntimePlanImageSnapshot,
			ImageRef: "image-ref",
		},
		EgressRoutes: []runtime.CompiledEgressRoute{
			{
				EgressRuleID: "egress-rule-a",
				Match: runtime.CompiledEgressRouteMatch{
					Hosts:        []string{"api.example.test"},
					PathPrefixes: []string{"/v1"},
					Methods:      []string{"POST"},
				},
				Upstream: runtime.CompiledEgressRouteUpstream{
					BaseURL: "https://api.example.test",
				},
			},
		},
	}
}

type managedProxyTestCAPaths struct {
	runtimeBundlePath         string
	persistentCertificatePath string
	persistentPrivateKeyPath  string
}

func managedProxyCAPaths(t *testing.T) managedProxyTestCAPaths {
	t.Helper()
	root := t.TempDir()
	return managedProxyTestCAPaths{
		runtimeBundlePath:         filepath.Join(root, "runtime", "egress-proxy-ca-bundle.pem"),
		persistentCertificatePath: filepath.Join(root, "persistent", "egress-proxy-ca.crt"),
		persistentPrivateKeyPath:  filepath.Join(root, "persistent", "egress-proxy-ca.key"),
	}
}

func startManagedProxyGateway(t *testing.T) (string, func()) {
	t.Helper()
	gateway := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		assertEqual(t, request.URL.Path, DirectEgressHTTPRoutePath)
		assertEqual(t, request.Header.Get(DirectGatewayEgressAuthorizationHeaderName), "Bearer gateway-token")
		responseWriter.WriteHeader(http.StatusAccepted)
	}))
	gatewayURL, err := url.Parse(gateway.URL)
	requireNoError(t, err)
	gatewayURL.Scheme = "ws"
	return gatewayURL.String(), gateway.Close
}

func newManagedProxySupervisor(t *testing.T, sandboxInstanceID string) *supervision.SandboxdSupervisorHandle {
	t.Helper()
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		sandboxInstanceID,
		timeutil.NewMutableClock(1_700_000_000_000),
		[]supervision.SupervisedComponent{supervision.ComponentEgressProxy},
	)
	requireNoError(t, err)
	return supervisorHandle
}

func readFileText(t *testing.T, path string) string {
	t.Helper()
	payload, err := os.ReadFile(path)
	requireNoError(t, err)
	return string(payload)
}

func reserveManagedProxyListenAddr(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	requireNoError(t, err)
	addr := listener.Addr().String()
	requireNoError(t, listener.Close())
	return addr
}

func forceManagedProxyInProcessServerExit(t *testing.T, proxy *ManagedProxy) {
	t.Helper()
	active, ok := proxy.active.(*managedInProcessProxy)
	if !ok {
		t.Fatalf("expected in-process managed proxy active, got %T", proxy.active)
	}
	requireNoError(t, active.server.Close())
}

func waitForManagedProxyRestart(t *testing.T, supervisorHandle *supervision.SandboxdSupervisorHandle, initialRestartCount uint64) supervision.ComponentHealthSnapshot {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		snapshot := supervisorHandle.Snapshot().Components[0]
		if snapshot.State == supervision.ComponentHealthy && snapshot.RestartCount > initialRestartCount {
			return snapshot
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for egress proxy restart; last snapshot %#v", snapshot)
		}
		time.Sleep(25 * time.Millisecond)
	}
}

func mustPortFromAddr(t *testing.T, addr string) string {
	t.Helper()
	_, port, err := net.SplitHostPort(addr)
	requireNoError(t, err)
	return port
}
