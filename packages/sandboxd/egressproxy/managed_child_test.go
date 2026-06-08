package egressproxy

import (
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/mistle/sandboxd/protocol"
	"github.com/mistle/sandboxd/supervision"
	"github.com/mistle/sandboxd/timeutil"
)

func TestMain(m *testing.M) {
	if os.Getenv("MISTLE_EGRESS_PROXY_CHILD_TEST") == "1" {
		if len(os.Args) != 4 || os.Args[1] != "egress-proxy" || os.Args[2] != "--config" {
			os.Exit(2)
		}
		if err := RunEgressProxyChild(os.Args[3]); err != nil {
			os.Exit(1)
		}
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func TestManagedProxyStartsChildProcessWithTokenBridge(t *testing.T) {
	var gatewayTarget string
	gateway := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		assertEqual(t, request.URL.Path, DirectEgressHTTPRoutePath)
		gatewayTarget = request.URL.Query().Get("target")
		assertEqual(t, request.Header.Get(DirectGatewayEgressAuthorizationHeaderName), "Bearer bridge-token")
		responseWriter.WriteHeader(http.StatusAccepted)
		_, _ = responseWriter.Write([]byte("gateway response"))
	}))
	defer gateway.Close()
	gatewayURL, err := url.Parse(gateway.URL)
	requireNoError(t, err)
	gatewayURL.Scheme = "ws"
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sbi_egress_child",
		timeutil.NewMutableClock(1_700_000_000_000),
		[]supervision.SupervisedComponent{supervision.ComponentEgressProxy},
	)
	requireNoError(t, err)
	listenAddr := reserveManagedChildListenAddr(t)

	proxy, err := StartManagedProxy(
		managedProxyRuntimePlan(),
		protocol.SessionRuntimeInput{TunnelGatewayWSURL: gatewayURL.String()},
		StaticEgressTokenProvider{TokenValue: "bridge-token"},
		timeutil.NewMutableClock(1_700_000_000_000),
		supervisorHandle,
		ManagedProxyOptions{
			ListenAddr:               listenAddr,
			RuntimeProxyCABundlePath: t.TempDir() + "/egress-proxy-ca-bundle.pem",
			ChildBinaryPath:          os.Args[0],
			ChildEnv:                 []string{"MISTLE_EGRESS_PROXY_CHILD_TEST=1"},
		},
	)
	requireNoError(t, err)
	defer proxy.Close()

	snapshot := supervisorHandle.Snapshot().Components[0]
	assertEqual(t, snapshot.State, supervision.ComponentHealthy)
	assertEqual(t, snapshot.Details["runtimeMode"], "child_process")
	if snapshot.Details["childPid"] == "" {
		t.Fatalf("expected child pid in egress proxy supervision details")
	}
	proxyURL, err := url.Parse("http://" + snapshot.Details["listenAddr"])
	requireNoError(t, err)
	client := http.Client{Transport: &http.Transport{Proxy: http.ProxyURL(proxyURL)}}
	request, err := http.NewRequest(http.MethodPost, "http://api.example.test/v1/allowed", strings.NewReader("gateway body"))
	requireNoError(t, err)

	response, err := client.Do(request)

	requireNoError(t, err)
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	requireNoError(t, err)
	assertEqual(t, response.StatusCode, http.StatusAccepted)
	assertEqual(t, string(body), "gateway response")
	assertEqual(t, gatewayTarget, "http://api.example.test/v1/allowed")
}

func TestManagedProxyRestartsChildProcessAfterExit(t *testing.T) {
	gateway := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		assertEqual(t, request.URL.Path, DirectEgressHTTPRoutePath)
		assertEqual(t, request.Header.Get(DirectGatewayEgressAuthorizationHeaderName), "Bearer bridge-token")
		responseWriter.WriteHeader(http.StatusAccepted)
		_, _ = responseWriter.Write([]byte("gateway response"))
	}))
	defer gateway.Close()
	gatewayURL, err := url.Parse(gateway.URL)
	requireNoError(t, err)
	gatewayURL.Scheme = "ws"
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sbi_egress_child_restart",
		timeutil.NewMutableClock(1_700_000_000_000),
		[]supervision.SupervisedComponent{supervision.ComponentEgressProxy},
	)
	requireNoError(t, err)
	listenAddr := reserveManagedChildListenAddr(t)
	proxy, err := StartManagedProxy(
		managedProxyRuntimePlan(),
		protocol.SessionRuntimeInput{TunnelGatewayWSURL: gatewayURL.String()},
		StaticEgressTokenProvider{TokenValue: "bridge-token"},
		timeutil.NewMutableClock(1_700_000_000_000),
		supervisorHandle,
		ManagedProxyOptions{
			ListenAddr:               listenAddr,
			RuntimeProxyCABundlePath: t.TempDir() + "/egress-proxy-ca-bundle.pem",
			ChildBinaryPath:          os.Args[0],
			ChildEnv:                 []string{"MISTLE_EGRESS_PROXY_CHILD_TEST=1"},
		},
	)
	requireNoError(t, err)
	defer proxy.Close()
	initialSnapshot := supervisorHandle.Snapshot().Components[0]
	initialPID, err := strconv.Atoi(initialSnapshot.Details["childPid"])
	requireNoError(t, err)
	requireNoError(t, syscall.Kill(initialPID, syscall.SIGTERM))

	restartedSnapshot := waitForEgressChildPIDChange(t, supervisorHandle, initialSnapshot.Details["childPid"])
	assertEqual(t, restartedSnapshot.State, supervision.ComponentHealthy)
	assertEqual(t, restartedSnapshot.Details["runtimeMode"], "child_process")
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

func TestInheritedProxyCAPayloadFileUsesPipeBackedDescriptor(t *testing.T) {
	payloadFile, err := inheritedPayloadFile("egress proxy ca certificate", "certificate-pem")
	requireNoError(t, err)
	defer payloadFile.Close()

	payload, err := io.ReadAll(payloadFile)
	requireNoError(t, err)
	assertEqual(t, string(payload), "certificate-pem")
	if runtime.GOOS != "windows" {
		fileInfo, err := payloadFile.Stat()
		requireNoError(t, err)
		if fileInfo.Mode().IsRegular() {
			t.Fatalf("expected inherited proxy CA payload to use a non-regular descriptor")
		}
	}
}

func TestManagedChildProcessCloseAllowsSignalExitDuringShutdown(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("process signal shutdown is Unix-specific")
	}
	command := exec.Command("sh", "-c", "while true; do sleep 1; done")
	command.Stdin = nil
	command.Stdout = nil
	command.Stderr = nil
	requireNoError(t, command.Start())
	waitDone := make(chan error, 1)
	go func() {
		waitDone <- command.Wait()
	}()
	child := &managedChildProcess{
		command:  command,
		waitDone: waitDone,
	}

	requireNoError(t, child.Close())
}

func TestManagedChildProcessClosesParentCopiesOfInheritedDescriptors(t *testing.T) {
	gateway := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		responseWriter.WriteHeader(http.StatusAccepted)
	}))
	defer gateway.Close()
	gatewayURL, err := url.Parse(gateway.URL)
	requireNoError(t, err)
	gatewayURL.Scheme = "ws"
	generatedCA, err := GenerateProxyCA(time.Now())
	requireNoError(t, err)
	routes, err := managedProxyRoutes(managedProxyRuntimePlan())
	requireNoError(t, err)

	child, err := startManagedChildProcess(managedChildConfig{
		BinaryPath:         os.Args[0],
		ListenAddr:         reserveManagedChildListenAddr(t),
		SandboxInstanceID:  "sbi_egress_child_cleanup",
		TunnelGatewayWSURL: gatewayURL.String(),
		Routes:             routes,
		TokenProvider:      StaticEgressTokenProvider{TokenValue: "bridge-token"},
		ProxyCACertPEM:     generatedCA.CertificatePEM,
		ProxyCAKeyPEM:      generatedCA.PrivateKeyPEM,
		Env:                []string{"MISTLE_EGRESS_PROXY_CHILD_TEST=1"},
	})
	requireNoError(t, err)
	defer child.Close()

	for _, inheritedFile := range child.childFiles {
		if _, err := inheritedFile.Stat(); err == nil {
			t.Fatalf("expected parent copy of inherited descriptor %q to be closed", inheritedFile.Name())
		}
	}
}

func reserveManagedChildListenAddr(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	requireNoError(t, err)
	addr := listener.Addr().String()
	requireNoError(t, listener.Close())
	return addr
}

func waitForEgressChildPIDChange(t *testing.T, supervisorHandle *supervision.SandboxdSupervisorHandle, previousPID string) supervision.ComponentHealthSnapshot {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		snapshot := supervisorHandle.Snapshot().Components[0]
		if snapshot.State == supervision.ComponentHealthy && snapshot.Details["childPid"] != "" && snapshot.Details["childPid"] != previousPID {
			return snapshot
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for egress proxy child restart; last snapshot %#v", snapshot)
		}
		time.Sleep(25 * time.Millisecond)
	}
}
