package sandboxdstate

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/mistle/sandboxd/cgroups"
	"github.com/mistle/sandboxd/egressproxy"
	"github.com/mistle/sandboxd/keepalive"
	"github.com/mistle/sandboxd/process"
	"github.com/mistle/sandboxd/protocol"
	"github.com/mistle/sandboxd/runtime"
	"github.com/mistle/sandboxd/startupdiagnostics"
	"github.com/mistle/sandboxd/supervision"
	"github.com/mistle/sandboxd/timeutil"
)

func TestDefaultProductionActivationOptionsUseCurrentExecutableForManagedEgressProxy(t *testing.T) {
	options, err := DefaultProductionActivationOptions()
	requireNoError(t, err)
	executablePath, err := os.Executable()
	requireNoError(t, err)

	assertEqual(t, options.EgressProxyOptions.ChildBinaryPath, executablePath)
	assertEqual(t, options.EgressProxyOptions.PersistentProxyCACertPath, egressproxy.DefaultPersistentProxyCACertPath)
	assertEqual(t, options.EgressProxyOptions.PersistentProxyCAKeyPath, egressproxy.DefaultPersistentProxyCAKeyPath)
}

func TestStateCloseKillsSandboxUserAndPlatformCgroupScopes(t *testing.T) {
	cgroupRoot := t.TempDir()
	userScope, err := cgroups.CreateUserScope(cgroupRoot, "sbi_lifecycle_close", "pty_1")
	requireNoError(t, err)
	platformScope, err := cgroups.CreatePlatformScope(cgroupRoot, "sbi_lifecycle_close", "runtime_1")
	requireNoError(t, err)
	requireNoError(t, os.WriteFile(userScope.KillFile, []byte(""), 0o644))
	requireNoError(t, os.WriteFile(platformScope.KillFile, []byte(""), 0o644))
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		"sbi_lifecycle_close",
		timeutil.NewMutableClock(1_700_000_000_000),
		[]supervision.SupervisedComponent{supervision.ComponentTunnelSession},
	)
	requireNoError(t, err)
	state := &State{
		sandboxInstanceID: "sbi_lifecycle_close",
		executionMode:     ExecutionModeSession,
		supervisorHandle:  supervisorHandle,
		platformScopeInput: &process.PlatformProcessScopeInput{
			CgroupRoot:        cgroupRoot,
			SandboxInstanceID: "sbi_lifecycle_close",
			Registry:          &process.PlatformProcessRegistry{},
		},
	}

	requireNoError(t, state.Close())

	assertLifecycleFileText(t, userScope.KillFile, "1\n")
	assertLifecycleFileText(t, platformScope.KillFile, "1\n")
}

func TestActivationPolicyAppliesRuntimePlanForBaseImages(t *testing.T) {
	for _, operationKind := range []protocol.ActivationOperationKind{
		protocol.ActivationOperationStart,
		protocol.ActivationOperationResume,
		protocol.ActivationOperationSetupCheck,
		protocol.ActivationOperationSnapshot,
	} {
		t.Run(string(operationKind), func(t *testing.T) {
			assertEqual(t, shouldApplyRuntimePlanForActivation(runtime.CompiledRuntimePlanImageBase, operationKind), true)
		})
	}
}

func TestActivationPolicyOnlyAppliesPrematerializedSnapshotForSnapshotPreparation(t *testing.T) {
	assertEqual(t, shouldApplyRuntimePlanForActivation(runtime.CompiledRuntimePlanImageSnapshot, protocol.ActivationOperationSnapshot), true)
	assertEqual(t, shouldApplyRuntimePlanForActivation(runtime.CompiledRuntimePlanImageSnapshot, protocol.ActivationOperationSetupCheck), true)
	assertEqual(t, shouldApplyRuntimePlanForActivation(runtime.CompiledRuntimePlanImageSnapshot, protocol.ActivationOperationStart), false)
	assertEqual(t, shouldApplyRuntimePlanForActivation(runtime.CompiledRuntimePlanImageSnapshot, protocol.ActivationOperationResume), false)
}

func TestSetupScriptPolicyFollowsRuntimePlanApplication(t *testing.T) {
	assertEqual(t, shouldRunSetupScriptForActivation(runtime.CompiledRuntimePlanImageBase, protocol.ActivationOperationStart), true)
	assertEqual(t, shouldRunSetupScriptForActivation(runtime.CompiledRuntimePlanImageSnapshot, protocol.ActivationOperationStart), false)
}

func TestActivateNewSnapshotWithPrematerializedImageConnectsBootstrapTunnel(t *testing.T) {
	requests := make(chan string, 1)
	gatewayURL, closeGateway := startLifecycleBootstrapGateway(t, requests)
	defer closeGateway()
	rawServer := startLifecycleRawWebSocketServer()
	defer rawServer.Close()
	activationInput := lifecycleActivationInput(protocol.ActivationOperationStart, runtime.CompiledRuntimePlanImageSnapshot)
	activationInput.TunnelGatewayWSURL = gatewayURL
	activationInput.RuntimePlan = lifecycleRuntimePlanJSONWithProcess(
		runtime.CompiledRuntimePlanImageSnapshot,
		"ws"+strings.TrimPrefix(rawServer.URL, "http"),
		reserveLifecycleWebSocketURL(t),
	)
	options := lifecycleActivationOptions(t)

	state, err := ActivateNewWithOptions(
		activationInput,
		timeutil.NewMutableClock(1_700_000_000_000),
		options,
	)

	requireNoError(t, err)
	assertEqual(t, state.SandboxInstanceID(), "sbi_lifecycle")
	assertEqual(t, string(state.ExecutionMode()), "session")
	runtimeEnv := state.RuntimeEnvironment()
	assertEqual(t, runtimeEnv[MistleSandboxInstanceIDEnvName], "sbi_lifecycle")
	assertEqual(t, runtimeEnv[MistleSandboxProfileIDEnvName], "profile_lifecycle")
	assertEqual(t, runtimeEnv[MistleSandboxProfileVersionEnvName], "7")
	assertEqual(t, runtimeEnv[GlobalGitConfigEnvName], DefaultGlobalGitConfigPath)
	snapshot := state.HealthSnapshot()
	assertEqual(t, snapshot.Components[0].Component, supervision.ComponentSandboxd)
	assertEqual(t, snapshot.Components[0].State, supervision.ComponentStopped)
	assertEqual(t, snapshot.Components[1].Component, supervision.ComponentTunnelSession)
	assertEqual(t, receiveLifecycleBootstrapRequest(t, requests), "bootstrap_token=bootstrap-token")
	tunnelSnapshot := state.HealthSnapshot().Components[1]
	assertEqual(t, tunnelSnapshot.Component, supervision.ComponentTunnelSession)
	assertEqual(t, tunnelSnapshot.State, supervision.ComponentHealthy)
	processSnapshot := state.HealthSnapshot().Components[3]
	assertEqual(t, processSnapshot.Component, supervision.ComponentCodexAppServer)
	assertEqual(t, processSnapshot.State, supervision.ComponentHealthy)
	proxySnapshot := state.HealthSnapshot().Components[2]
	assertEqual(t, proxySnapshot.Component, supervision.ComponentCodexProxy)
	assertEqual(t, proxySnapshot.State, supervision.ComponentHealthy)
	assertEqual(t, proxySnapshot.Details["rawConnectivityState"], "Connected")
	agentEndpointSnapshot := waitForComponentState(
		t,
		state.supervisorHandle,
		supervision.ComponentRuntimeAgentEndpoint,
		supervision.ComponentHealthy,
	)
	assertEqual(t, agentEndpointSnapshot.Details["connectivityState"], "Connected")
	scopeSnapshot := requireOnlyLifecyclePlatformScopeSnapshot(t, options.PlatformRegistry)
	assertEqual(t, scopeSnapshot.ProcessKey, "codex-app-server")
	assertLifecycleFileText(t, scopeSnapshot.ScopePaths.ProcsFile, intString(scopeSnapshot.SupervisedRootPID)+"\n")

	requireNoError(t, state.Close())
	assertLifecycleFileText(t, scopeSnapshot.ScopePaths.KillFile, "1\n")
	snapshots, err := options.PlatformRegistry.Snapshots()
	requireNoError(t, err)
	assertEqual(t, len(snapshots), 0)
}

func TestActivateNewStartConnectsBootstrapTunnel(t *testing.T) {
	requests := make(chan string, 1)
	gatewayURL, closeGateway := startLifecycleBootstrapGateway(t, requests)
	defer closeGateway()
	activationInput := lifecycleActivationInput(protocol.ActivationOperationStart, runtime.CompiledRuntimePlanImageBase)
	activationInput.TunnelGatewayWSURL = gatewayURL

	state, err := ActivateNew(activationInput, timeutil.NewMutableClock(1_700_000_000_000))

	requireNoError(t, err)
	defer state.Close()
	assertEqual(t, receiveLifecycleBootstrapRequest(t, requests), "bootstrap_token=bootstrap-token")
	tunnelSnapshot := state.HealthSnapshot().Components[1]
	assertEqual(t, tunnelSnapshot.Component, supervision.ComponentTunnelSession)
	assertEqual(t, tunnelSnapshot.State, supervision.ComponentHealthy)
}

func TestActivateNewSnapshotOperationStopsBootstrapTunnelAfterMaterialization(t *testing.T) {
	requests := make(chan string, 1)
	gatewayURL, closeGateway := startLifecycleBootstrapGateway(t, requests)
	defer closeGateway()
	activationInput := lifecycleActivationInput(protocol.ActivationOperationSnapshot, runtime.CompiledRuntimePlanImageBase)
	activationInput.TunnelGatewayWSURL = gatewayURL
	activationInput.GitIdentity = lifecycleGitIdentity()
	options := lifecycleActivationOptions(t)
	globalGitConfigPath := options.GlobalGitConfigPath

	state, err := ActivateNewWithOptions(activationInput, timeutil.NewMutableClock(1_700_000_000_000), options)

	requireNoError(t, err)
	defer state.Close()
	if _, err := os.Lstat(globalGitConfigPath); !os.IsNotExist(err) {
		t.Fatalf("expected snapshot operation not to write global Git config, got %v", err)
	}
	assertEqual(t, state.ExecutionMode(), ExecutionModeSnapshot)
	assertEqual(t, receiveLifecycleBootstrapRequest(t, requests), "bootstrap_token=bootstrap-token")
	tunnelSnapshot := state.HealthSnapshot().Components[1]
	assertEqual(t, tunnelSnapshot.Component, supervision.ComponentTunnelSession)
	assertEqual(t, tunnelSnapshot.State, supervision.ComponentStopped)
	if state.liveTunnelSession != nil {
		t.Fatalf("expected snapshot operation to close live tunnel session")
	}
	if state.bootstrapTunnel != nil {
		t.Fatalf("expected snapshot operation to close bootstrap tunnel")
	}
}

func TestActivateNewStartsEgressProxyWithTunnelBackedTokenProvider(t *testing.T) {
	events := make(chan string, 4)
	gatewayURL, closeGateway := startLifecycleEgressGateway(t, events)
	defer closeGateway()
	caBundlePath := filepath.Join(t.TempDir(), "egress-proxy-ca-bundle.pem")
	activationInput := lifecycleActivationInput(protocol.ActivationOperationStart, runtime.CompiledRuntimePlanImageSnapshot)
	activationInput.TunnelGatewayWSURL = gatewayURL
	activationInput.ActingUserID = ptr("usr_egress")
	activationInput.RuntimePlan = lifecycleRuntimePlanJSONWithEgressRoute()
	options := lifecycleActivationOptions(t)
	options.EgressProxyOptions = egressproxy.ManagedProxyOptions{
		ListenAddr:               "127.0.0.1:0",
		RuntimeProxyCABundlePath: caBundlePath,
	}

	state, err := ActivateNewWithOptions(activationInput, timeutil.NewMutableClock(1_700_000_000_000), options)
	requireNoError(t, err)
	defer state.Close()

	assertEqual(t, receiveLifecycleEvent(t, events), "bootstrap:bootstrap_token=bootstrap-token")
	runtimeEnv := state.RuntimeEnvironment()
	assertEqual(t, runtimeEnv[egressproxy.SSL_CERT_FILE], caBundlePath)
	assertEqual(t, runtimeEnv[egressproxy.NODE_EXTRA_CA_CERTS], caBundlePath)
	egressSnapshot := waitForComponentState(t, state.supervisorHandle, supervision.ComponentEgressProxy, supervision.ComponentHealthy)
	proxyURL, err := url.Parse("http://" + egressSnapshot.Details["listenAddr"])
	requireNoError(t, err)
	client := http.Client{Transport: &http.Transport{Proxy: http.ProxyURL(proxyURL)}}
	request, err := http.NewRequest(http.MethodPost, "http://api.example.test/v1/allowed", strings.NewReader("gateway body"))
	requireNoError(t, err)

	response, err := client.Do(request)

	requireNoError(t, err)
	defer response.Body.Close()
	assertEqual(t, response.StatusCode, http.StatusAccepted)
	assertEqual(t, receiveLifecycleEvent(t, events), "token:egress_token_req_1:usr_egress")
	assertEqual(t, receiveLifecycleEvent(t, events), "gateway:Bearer gateway-jwt:http://api.example.test/v1/allowed")
}

func TestActivateInitializedRefreshesEgressProxyWhenTunnelGatewayChanges(t *testing.T) {
	firstEvents := make(chan string, 4)
	firstGatewayURL, closeFirstGateway := startLifecycleEgressGatewayWithToken(t, firstEvents, "first-gateway-jwt")
	defer closeFirstGateway()
	secondEvents := make(chan string, 4)
	secondGatewayURL, closeSecondGateway := startLifecycleEgressGatewayWithToken(t, secondEvents, "second-gateway-jwt")
	defer closeSecondGateway()
	caBundlePath := filepath.Join(t.TempDir(), "egress-proxy-ca-bundle.pem")
	activationInput := lifecycleActivationInput(protocol.ActivationOperationStart, runtime.CompiledRuntimePlanImageSnapshot)
	activationInput.TunnelGatewayWSURL = firstGatewayURL
	activationInput.ActingUserID = ptr("usr_egress")
	activationInput.RuntimePlan = lifecycleRuntimePlanJSONWithEgressRoute()
	options := lifecycleActivationOptions(t)
	options.EgressProxyOptions = egressproxy.ManagedProxyOptions{
		ListenAddr:               "127.0.0.1:0",
		RuntimeProxyCABundlePath: caBundlePath,
	}
	state, err := ActivateNewWithOptions(activationInput, timeutil.NewMutableClock(1_700_000_000_000), options)
	requireNoError(t, err)
	defer state.Close()
	assertEqual(t, receiveLifecycleEvent(t, firstEvents), "bootstrap:bootstrap_token=bootstrap-token")
	egressSnapshot := waitForComponentState(t, state.supervisorHandle, supervision.ComponentEgressProxy, supervision.ComponentHealthy)
	firstListenAddr := egressSnapshot.Details["listenAddr"]
	firstTunnelSnapshot := state.supervisorHandle.ComponentSnapshot(supervision.ComponentTunnelSession)
	if firstTunnelSnapshot == nil {
		t.Fatalf("expected initial tunnel health snapshot")
	}
	proxyURL, err := url.Parse("http://" + firstListenAddr)
	requireNoError(t, err)
	client := http.Client{Transport: &http.Transport{Proxy: http.ProxyURL(proxyURL)}}
	request, err := http.NewRequest(http.MethodPost, "http://api.example.test/v1/allowed", strings.NewReader("gateway body"))
	requireNoError(t, err)
	response, err := client.Do(request)
	requireNoError(t, err)
	defer response.Body.Close()
	assertEqual(t, response.StatusCode, http.StatusAccepted)
	assertEqual(t, receiveLifecycleEvent(t, firstEvents), "token:egress_token_req_1:usr_egress")
	assertEqual(t, receiveLifecycleEvent(t, firstEvents), "gateway:Bearer first-gateway-jwt:http://api.example.test/v1/allowed")

	resumeInput := activationInput
	resumeInput.OperationKind = protocol.ActivationOperationResume
	resumeInput.BootstrapToken = "bootstrap-token-resumed"
	resumeInput.TunnelExchangeToken = "exchange-token-resumed"
	resumeInput.TunnelGatewayWSURL = secondGatewayURL
	requireNoError(t, state.ActivateInitialized(resumeInput))
	assertEqual(t, receiveLifecycleEvent(t, secondEvents), "bootstrap:bootstrap_token=bootstrap-token-resumed")
	restartedSnapshot := waitForComponentState(t, state.supervisorHandle, supervision.ComponentEgressProxy, supervision.ComponentHealthy)
	assertEqual(t, restartedSnapshot.Details["listenAddr"], firstListenAddr)

	request, err = http.NewRequest(http.MethodPost, "http://api.example.test/v1/allowed", strings.NewReader("gateway body"))
	requireNoError(t, err)
	response, err = client.Do(request)
	requireNoError(t, err)
	defer response.Body.Close()
	assertEqual(t, response.StatusCode, http.StatusAccepted)
	assertEqual(t, receiveLifecycleEvent(t, secondEvents), "token:egress_token_req_1:usr_egress")
	assertEqual(t, receiveLifecycleEvent(t, secondEvents), "gateway:Bearer second-gateway-jwt:http://api.example.test/v1/allowed")
}

func TestActivateInitializedRecordsRustCompatibleRefreshLifecyclePhases(t *testing.T) {
	logDir := t.TempDir()
	t.Setenv(startupdiagnostics.TestLogDirEnv, logDir)
	requests := make(chan string, 2)
	firstGatewayURL, closeFirstGateway := startLifecycleBootstrapGateway(t, requests)
	defer closeFirstGateway()
	secondGatewayURL, closeSecondGateway := startLifecycleBootstrapGateway(t, requests)
	defer closeSecondGateway()
	activationInput := lifecycleActivationInput(protocol.ActivationOperationStart, runtime.CompiledRuntimePlanImageSnapshot)
	activationInput.TunnelGatewayWSURL = firstGatewayURL
	options := lifecycleActivationOptions(t)
	state, err := ActivateNewWithOptions(activationInput, timeutil.NewMutableClock(1_700_000_000_000), options)
	requireNoError(t, err)
	defer state.Close()
	assertEqual(t, receiveLifecycleBootstrapRequest(t, requests), "bootstrap_token=bootstrap-token")
	logger, err := startupdiagnostics.InitializeActivationDiagnosticsLogger(
		startupdiagnostics.ActivationOperation{OperationKind: protocol.ActivationOperationResume},
		secondGatewayURL,
	)
	requireNoError(t, err)
	state.SetDiagnosticsLogger(&logger)
	resumeInput := activationInput
	resumeInput.OperationKind = protocol.ActivationOperationResume
	resumeInput.BootstrapToken = "resume-bootstrap-token"
	resumeInput.TunnelGatewayWSURL = secondGatewayURL

	requireNoError(t, state.ActivateInitialized(resumeInput))

	assertEqual(t, receiveLifecycleBootstrapRequest(t, requests), "bootstrap_token=resume-bootstrap-token")
	records := startupdiagnosticsReadLogRecords(t, filepath.Join(logDir, "activate.log"))
	for _, phase := range []string{
		"start_tunnel_session",
		"apply_git_identity",
		"attach_runtime_environment",
		"attach_runtime_agent_endpoint",
		"ready",
	} {
		requireStartupDiagnosticsRecord(t, records, func(record map[string]any) bool {
			return record["event"] == "sandbox_resume_phase_started" &&
				record["phase"] == phase
		})
	}
}

func TestActivateInitializedRestoresPreviousEgressProxyWhenRefreshFails(t *testing.T) {
	firstEvents := make(chan string, 4)
	firstGatewayURL, closeFirstGateway := startLifecycleEgressGatewayWithToken(t, firstEvents, "first-gateway-jwt")
	defer closeFirstGateway()
	secondEvents := make(chan string, 4)
	secondGatewayURL, closeSecondGateway := startLifecycleEgressGatewayWithToken(t, secondEvents, "second-gateway-jwt")
	defer closeSecondGateway()
	caBundlePath := filepath.Join(t.TempDir(), "egress-proxy-ca-bundle.pem")
	activationInput := lifecycleActivationInput(protocol.ActivationOperationStart, runtime.CompiledRuntimePlanImageSnapshot)
	activationInput.TunnelGatewayWSURL = firstGatewayURL
	activationInput.ActingUserID = ptr("usr_egress")
	activationInput.RuntimePlan = lifecycleRuntimePlanJSONWithEgressRoute()
	options := lifecycleActivationOptions(t)
	options.EgressProxyOptions = egressproxy.ManagedProxyOptions{
		ListenAddr:               "127.0.0.1:0",
		RuntimeProxyCABundlePath: caBundlePath,
	}
	state, err := ActivateNewWithOptions(activationInput, timeutil.NewMutableClock(1_700_000_000_000), options)
	requireNoError(t, err)
	defer state.Close()
	assertEqual(t, receiveLifecycleEvent(t, firstEvents), "bootstrap:bootstrap_token=bootstrap-token")
	egressSnapshot := waitForComponentState(t, state.supervisorHandle, supervision.ComponentEgressProxy, supervision.ComponentHealthy)
	firstListenAddr := egressSnapshot.Details["listenAddr"]
	firstTunnelSnapshot := state.supervisorHandle.ComponentSnapshot(supervision.ComponentTunnelSession)
	if firstTunnelSnapshot == nil {
		t.Fatalf("expected initial tunnel health snapshot")
	}
	proxyURL, err := url.Parse("http://" + firstListenAddr)
	requireNoError(t, err)
	client := http.Client{Transport: &http.Transport{Proxy: http.ProxyURL(proxyURL)}}
	state.egressProxyOptions.RuntimeProxyCABundlePath = filepath.Join(os.DevNull, "egress-proxy-ca-bundle.pem")

	resumeInput := activationInput
	resumeInput.OperationKind = protocol.ActivationOperationResume
	resumeInput.BootstrapToken = "bootstrap-token-resumed"
	resumeInput.TunnelExchangeToken = "exchange-token-resumed"
	resumeInput.TunnelGatewayWSURL = secondGatewayURL
	err = state.ActivateInitialized(resumeInput)

	if err == nil {
		t.Fatalf("expected initialized activation to fail while refreshing egress proxy")
	}
	assertEqual(t, strings.Contains(err.Error(), "failed to refresh local egress proxy"), true)
	assertEqual(t, receiveLifecycleEvent(t, secondEvents), "bootstrap:bootstrap_token=bootstrap-token-resumed")
	restoredTunnelSnapshot := state.supervisorHandle.ComponentSnapshot(supervision.ComponentTunnelSession)
	if restoredTunnelSnapshot == nil {
		t.Fatalf("expected restored tunnel health snapshot")
	}
	assertEqual(t, restoredTunnelSnapshot.Details["gatewayWsUrl"], firstTunnelSnapshot.Details["gatewayWsUrl"])
	assertEqual(t, restoredTunnelSnapshot.State, firstTunnelSnapshot.State)
	restoredSnapshot := waitForComponentState(t, state.supervisorHandle, supervision.ComponentEgressProxy, supervision.ComponentHealthy)
	assertEqual(t, restoredSnapshot.Details["listenAddr"], firstListenAddr)
	readyState := state.runtimeReadiness.TakeInitialPublishableState()
	if readyState == nil {
		t.Fatalf("expected restored runtime readiness manager to be publishable")
	}
	var keepaliveState *protocol.KeepaliveState
	state.keepaliveManager.WithLocked(func(manager *keepalive.Manager) {
		keepaliveState = manager.TakePublishableState(timeutil.NewMutableClock(1_700_000_001_000))
	})
	if keepaliveState == nil {
		t.Fatalf("expected restored keepalive manager to be publishable")
	}
	request, err := http.NewRequest(http.MethodPost, "http://api.example.test/v1/allowed", strings.NewReader("gateway body"))
	requireNoError(t, err)
	response, err := client.Do(request)
	requireNoError(t, err)
	defer response.Body.Close()
	assertEqual(t, response.StatusCode, http.StatusAccepted)
	assertEqual(t, receiveLifecycleEvent(t, firstEvents), "token:egress_token_req_1:usr_egress")
	assertEqual(t, receiveLifecycleEvent(t, firstEvents), "gateway:Bearer first-gateway-jwt:http://api.example.test/v1/allowed")
}

func TestActivateInitializedRestoresAcceptedGitIdentityWhenCandidateApplyFails(t *testing.T) {
	requests := make(chan string, 2)
	firstGatewayURL, closeFirstGateway := startLifecycleBootstrapGateway(t, requests)
	defer closeFirstGateway()
	secondGatewayURL, closeSecondGateway := startLifecycleBootstrapGateway(t, requests)
	defer closeSecondGateway()
	activationInput := lifecycleActivationInput(protocol.ActivationOperationStart, runtime.CompiledRuntimePlanImageSnapshot)
	activationInput.TunnelGatewayWSURL = firstGatewayURL
	activationInput.GitIdentity = &protocol.GitIdentity{
		Name:  "Accepted User",
		Email: "accepted@example.com",
	}
	options := lifecycleActivationOptions(t)
	globalGitConfigPath := options.GlobalGitConfigPath
	state, err := ActivateNewWithOptions(activationInput, timeutil.NewMutableClock(1_700_000_000_000), options)
	requireNoError(t, err)
	defer state.Close()
	assertEqual(t, receiveLifecycleBootstrapRequest(t, requests), "bootstrap_token=bootstrap-token")

	resumeInput := activationInput
	resumeInput.OperationKind = protocol.ActivationOperationResume
	resumeInput.BootstrapToken = "bootstrap-token-resumed"
	resumeInput.TunnelExchangeToken = "exchange-token-resumed"
	resumeInput.TunnelGatewayWSURL = secondGatewayURL
	resumeInput.GitIdentity = &protocol.GitIdentity{
		Name:  "Rejected User",
		Email: "rejected@example.com\x00invalid",
	}
	err = state.ActivateInitialized(resumeInput)

	if err == nil {
		t.Fatalf("expected initialized activation to fail while applying candidate Git identity")
	}
	assertEqual(t, strings.Contains(err.Error(), "failed to apply Git identity"), true)
	assertEqual(t, receiveLifecycleBootstrapRequest(t, requests), "bootstrap_token=bootstrap-token-resumed")
	gitConfig := readLifecycleFile(t, globalGitConfigPath)
	assertEqual(t, strings.Contains(gitConfig, "name = Accepted User"), true)
	assertEqual(t, strings.Contains(gitConfig, "email = accepted@example.com"), true)
	if strings.Contains(gitConfig, "Rejected User") || strings.Contains(gitConfig, "rejected@example.com") {
		t.Fatalf("expected failed candidate Git identity to be restored, got %s", gitConfig)
	}
}

func TestActivateNewConnectsBootstrapTunnelBeforeRuntimeSetupFiles(t *testing.T) {
	requests := make(chan string, 1)
	fileExistsAtConnect := make(chan bool, 1)
	activationInput := lifecycleActivationInput(protocol.ActivationOperationStart, runtime.CompiledRuntimePlanImageBase)
	targetPath := filepath.Join(t.TempDir(), "runtime/settings.json")
	gatewayURL, closeGateway := startLifecycleBootstrapGatewayWithConnectCheck(t, requests, func() bool {
		_, err := os.Stat(targetPath)
		exists := err == nil
		fileExistsAtConnect <- exists
		return exists
	})
	defer closeGateway()
	activationInput.RuntimePlan = lifecycleRuntimePlanJSONWithFiles(runtime.CompiledRuntimePlanImageBase, targetPath)
	activationInput.TunnelGatewayWSURL = gatewayURL

	state, err := ActivateNew(activationInput, timeutil.NewMutableClock(1_700_000_000_000))

	requireNoError(t, err)
	defer state.Close()
	assertEqual(t, receiveLifecycleBootstrapRequest(t, requests), "bootstrap_token=bootstrap-token")
	select {
	case exists := <-fileExistsAtConnect:
		assertEqual(t, exists, false)
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for bootstrap connect file check")
	}
	assertEqual(t, readLifecycleFile(t, targetPath), "{\"ready\":true}\n")
}

func TestActivateNewRejectsInvalidRuntimePlanBeforeStateInitialization(t *testing.T) {
	activationInput := lifecycleActivationInput(protocol.ActivationOperationStart, runtime.CompiledRuntimePlanImageSnapshot)
	activationInput.RuntimePlan = []byte(`{"version":7}`)

	_, err := ActivateNew(activationInput, timeutil.NewMutableClock(1_700_000_000_000))

	if err == nil {
		t.Fatalf("expected invalid runtime plan to fail")
	}
	assertEqual(t, err.Error(), "failed to apply session input: runtime plan image source is required")
}

func TestActivateInitializedRejectsRuntimePlanChanges(t *testing.T) {
	acceptedActivationInput := lifecycleActivationInput(protocol.ActivationOperationStart, runtime.CompiledRuntimePlanImageBase)
	candidateActivationInput := acceptedActivationInput
	candidateActivationInput.RuntimePlan = lifecycleRuntimePlanJSONWithProfileID(runtime.CompiledRuntimePlanImageBase, "profile_replacement")
	state := &State{
		sandboxInstanceID:   "sbi_lifecycle",
		executionMode:       ExecutionModeSession,
		acceptedRuntimePlan: cloneJSONRawMessage(acceptedActivationInput.RuntimePlan),
	}

	err := state.ActivateInitialized(candidateActivationInput)

	if err == nil {
		t.Fatalf("expected initialized activation to reject runtime plan changes")
	}
	assertEqual(t, err.Error(), "initialized activation cannot change runtime plan")
}

func TestActivateInitializedRejectsTransparentProxyChanges(t *testing.T) {
	acceptedActivationInput := lifecycleActivationInput(protocol.ActivationOperationStart, runtime.CompiledRuntimePlanImageBase)
	candidateActivationInput := acceptedActivationInput
	candidateActivationInput.TransparentProxy = &protocol.TransparentProxyConfiguration{
		PassthroughBypass: protocol.TransparentProxyBypass{
			Kind: protocol.TransparentProxyBypassSocketMark,
			Mark: 38514,
		},
	}
	state := &State{
		sandboxInstanceID:   "sbi_lifecycle",
		executionMode:       ExecutionModeSession,
		acceptedRuntimePlan: cloneJSONRawMessage(acceptedActivationInput.RuntimePlan),
	}

	err := state.ActivateInitialized(candidateActivationInput)

	if err == nil {
		t.Fatalf("expected initialized activation to reject transparent proxy changes")
	}
	assertEqual(t, err.Error(), "initialized activation cannot change egress proxy input")
}

func lifecycleActivationInput(
	operationKind protocol.ActivationOperationKind,
	imageSource runtime.CompiledRuntimePlanImageSource,
) protocol.ActivationInput {
	return protocol.ActivationInput{
		OperationKind:       operationKind,
		BootstrapToken:      "bootstrap-token",
		TunnelExchangeToken: "exchange-token",
		TunnelGatewayWSURL:  "ws://gateway.example.test/bootstrap/sbi_lifecycle",
		RuntimePlan:         lifecycleRuntimePlanJSON(imageSource),
	}
}

func lifecycleGitIdentity() *protocol.GitIdentity {
	return &protocol.GitIdentity{
		Name:  "Mistle User",
		Email: "mistle-user@example.com",
		Signing: &protocol.GitSigningConfig{
			Format:         "ssh",
			Program:        "/opt/mistle/bin/mistle-ssh-sign",
			KeyRef:         "key::ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEXAMPLE",
			OrganizationID: "org_123",
			ProviderFamily: "github",
			ActingUserID:   "usr_123",
			Grant:          "grant-token",
		},
	}
}

func lifecycleActivationOptions(t *testing.T) ActivationOptions {
	t.Helper()
	registry := &process.PlatformProcessRegistry{}
	return ActivationOptions{
		RuntimeAdapterOptions: RuntimeAdapterOptions{IdempotencyStoreRoot: t.TempDir()},
		PlatformScopeRoot:     t.TempDir(),
		PlatformRegistry:      registry,
		GlobalGitConfigPath:   filepath.Join(t.TempDir(), "gitconfig"),
	}
}

func lifecycleRuntimePlanJSON(imageSource runtime.CompiledRuntimePlanImageSource) []byte {
	runtimePlan := runtime.CompiledRuntimePlan{
		SandboxProfileID: "profile_lifecycle",
		Version:          7,
		Image: runtime.CompiledRuntimePlanImage{
			Source:   imageSource,
			ImageRef: "image-ref",
		},
	}
	payload, err := json.Marshal(runtimePlan)
	if err != nil {
		panic(err)
	}
	return payload
}

func lifecycleRuntimePlanJSONWithProfileID(imageSource runtime.CompiledRuntimePlanImageSource, sandboxProfileID string) []byte {
	runtimePlan := runtime.CompiledRuntimePlan{
		SandboxProfileID: sandboxProfileID,
		Version:          7,
		Image: runtime.CompiledRuntimePlanImage{
			Source:   imageSource,
			ImageRef: "image-ref",
		},
	}
	payload, err := json.Marshal(runtimePlan)
	if err != nil {
		panic(err)
	}
	return payload
}

func lifecycleRuntimePlanJSONWithFiles(imageSource runtime.CompiledRuntimePlanImageSource, targetPath string) []byte {
	runtimePlan := runtime.CompiledRuntimePlan{
		SandboxProfileID: "profile_lifecycle",
		Version:          7,
		Image: runtime.CompiledRuntimePlanImage{
			Source:   imageSource,
			ImageRef: "image-ref",
		},
		RuntimeClients: []runtime.RuntimeClient{
			{
				ClientID: "codex-cli",
				Setup: runtime.RuntimeClientSetup{
					Files: []runtime.RuntimeClientSetupFile{
						{
							FileID:  "settings",
							Path:    targetPath,
							Mode:    0o640,
							Content: "{\"ready\":true}\n",
						},
					},
				},
			},
		},
	}
	payload, err := json.Marshal(runtimePlan)
	if err != nil {
		panic(err)
	}
	return payload
}

func lifecycleRuntimePlanJSONWithEgressRoute() []byte {
	payload, err := json.Marshal(managedLifecycleEgressRuntimePlan())
	if err != nil {
		panic(err)
	}
	return payload
}

func managedLifecycleEgressRuntimePlan() runtime.CompiledRuntimePlan {
	return runtime.CompiledRuntimePlan{
		SandboxProfileID: "profile_lifecycle",
		Version:          7,
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
				AuthInjection: runtime.CompiledEgressRouteAuthInjection{
					Type: runtime.CompiledEgressRouteAuthInjectionBearer,
				},
				CredentialResolver: runtime.CompiledEgressRouteCredentialResolver{
					Kind:                    runtime.CompiledEgressRouteCredentialResolverLinkedPrincipal,
					ProviderFamily:          "github",
					IntegrationConnectionID: "conn_github",
					ActingUserRequired:      true,
					ResolutionMode:          runtime.CompiledLinkedPrincipalEgressCredentialResolutionRequired,
				},
			},
		},
	}
}

func lifecycleRuntimePlanJSONWithProcess(
	imageSource runtime.CompiledRuntimePlanImageSource,
	rawURL string,
	listenURL string,
) []byte {
	processKey := "codex-app-server"
	runtimePlan := runtime.CompiledRuntimePlan{
		SandboxProfileID: "profile_lifecycle",
		Version:          7,
		Image: runtime.CompiledRuntimePlanImage{
			Source:   imageSource,
			ImageRef: "image-ref",
		},
		RuntimeClients: []runtime.RuntimeClient{
			{
				ClientID: "codex-cli",
				Processes: []runtime.RuntimeClientProcess{
					{
						ProcessKey: "codex-app-server",
						Command: runtime.RuntimeExecCommand{
							Args: []string{"/bin/sleep", "30"},
						},
						Readiness: runtime.RuntimeClientProcessReadiness{
							Type:      runtime.RuntimeClientProcessReadinessWS,
							URL:       rawURL,
							TimeoutMS: 1000,
						},
						Stop: runtime.RuntimeClientProcessStopPolicy{
							Signal:    runtime.RuntimeClientProcessStopSignalSIGKILL,
							TimeoutMS: 1000,
						},
					},
				},
				Endpoints: []runtime.RuntimeClientEndpoint{
					{
						EndpointKey: "app-server",
						ProcessKey:  &processKey,
						Transport: runtime.RuntimeClientEndpointTransport{
							Type: "ws",
							URL:  listenURL,
						},
						ConnectionMode: "dedicated",
					},
				},
			},
		},
		AgentRuntimes: []runtime.CompiledAgentRuntime{
			{
				RuntimeID:   "codex",
				RuntimeKey:  "codex-app-server",
				ClientID:    "codex-cli",
				EndpointKey: "app-server",
			},
		},
	}
	payload, err := json.Marshal(runtimePlan)
	if err != nil {
		panic(err)
	}
	return payload
}

func readLifecycleFile(t *testing.T, path string) string {
	t.Helper()
	content, err := os.ReadFile(path)
	requireNoError(t, err)
	return string(content)
}

func requireOnlyLifecyclePlatformScopeSnapshot(t *testing.T, registry *process.PlatformProcessRegistry) process.PlatformProcessScopeSnapshot {
	t.Helper()
	snapshots, err := registry.Snapshots()
	requireNoError(t, err)
	if len(snapshots) != 1 {
		t.Fatalf("expected one platform scope snapshot, got %#v", snapshots)
	}
	return snapshots[0]
}

func assertLifecycleFileText(t *testing.T, path string, expected string) {
	t.Helper()
	content, err := os.ReadFile(path)
	requireNoError(t, err)
	if string(content) != expected {
		t.Fatalf("expected %s to contain %q, got %q", path, expected, string(content))
	}
}

func intString(value uint32) string {
	return strconv.Itoa(int(value))
}

func ptr(value string) *string {
	return &value
}

func startLifecycleBootstrapGateway(t *testing.T, requests chan<- string) (string, func()) {
	t.Helper()
	return startLifecycleBootstrapGatewayWithConnectCheck(t, requests, nil)
}

func startLifecycleBootstrapGatewayWithConnectCheck(t *testing.T, requests chan<- string, connectCheck func() bool) (string, func()) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		connection, err := websocket.Accept(responseWriter, request, nil)
		if err != nil {
			return
		}
		if connectCheck != nil {
			connectCheck()
		}
		requests <- request.URL.RawQuery
		defer connection.Close(websocket.StatusNormalClosure, "")
		for {
			if _, _, err := connection.Read(request.Context()); err != nil {
				return
			}
		}
	}))
	return "ws" + strings.TrimPrefix(server.URL, "http") + "/bootstrap/sbi_lifecycle", server.Close
}

func startLifecycleEgressGateway(t *testing.T, events chan<- string) (string, func()) {
	t.Helper()
	return startLifecycleEgressGatewayWithToken(t, events, "gateway-jwt")
}

func startLifecycleEgressGatewayWithToken(t *testing.T, events chan<- string, token string) (string, func()) {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		if strings.EqualFold(request.Header.Get("Upgrade"), "websocket") {
			connection, err := websocket.Accept(responseWriter, request, nil)
			if err != nil {
				return
			}
			defer connection.Close(websocket.StatusNormalClosure, "")
			events <- "bootstrap:" + request.URL.RawQuery
			for {
				messageType, payload, err := connection.Read(request.Context())
				if err != nil {
					return
				}
				if messageType != websocket.MessageText {
					continue
				}
				var message map[string]any
				if err := json.Unmarshal(payload, &message); err != nil {
					continue
				}
				if message["type"] != "egress.token.request" {
					continue
				}
				requestID := message["requestId"].(string)
				actingUserID := message["actingUserId"].(string)
				events <- "token:" + requestID + ":" + actingUserID
				writeLifecycleWebSocketJSON(request.Context(), connection, map[string]any{
					"type":      "egress.token.response",
					"requestId": requestID,
					"token":     token,
					"expiresAt": "2026-01-02T03:04:05Z",
					"ttlMs":     float64(60000),
				})
			}
		}
		assertEqual(t, request.URL.Path, egressproxy.DirectEgressHTTPRoutePath)
		events <- "gateway:" + request.Header.Get(egressproxy.DirectGatewayEgressAuthorizationHeaderName) + ":" + request.URL.Query().Get("target")
		responseWriter.WriteHeader(http.StatusAccepted)
		_, _ = responseWriter.Write([]byte("gateway response"))
	}))
	return "ws" + strings.TrimPrefix(server.URL, "http") + "/bootstrap/sbi_lifecycle", server.Close
}

func receiveLifecycleEvent(t *testing.T, events <-chan string) string {
	t.Helper()
	select {
	case event := <-events:
		return event
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for lifecycle event")
		return ""
	}
}

func startLifecycleRawWebSocketServer() *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(responseWriter http.ResponseWriter, request *http.Request) {
		connection, err := websocket.Accept(responseWriter, request, nil)
		if err != nil {
			return
		}
		defer connection.Close(websocket.StatusNormalClosure, "")
		ctx, cancel := context.WithTimeout(request.Context(), 100*time.Millisecond)
		defer cancel()
		messageType, payload, err := connection.Read(ctx)
		if err != nil {
			return
		}
		if messageType != websocket.MessageText {
			return
		}
		var message map[string]any
		if err := json.Unmarshal(payload, &message); err != nil {
			return
		}
		if message["method"] != "initialize" {
			return
		}
		writeLifecycleWebSocketJSON(request.Context(), connection, map[string]any{
			"id":     message["id"],
			"result": map[string]any{},
		})
		_, _, _ = connection.Read(request.Context())
		requestMessage := readLifecycleWebSocketJSON(request.Context(), connection)
		if requestMessage["method"] != "thread/loaded/list" {
			return
		}
		writeLifecycleWebSocketJSON(request.Context(), connection, map[string]any{
			"id": requestMessage["id"],
			"result": map[string]any{
				"data": []any{},
			},
		})
		<-request.Context().Done()
	}))
}

func readLifecycleWebSocketJSON(ctx context.Context, connection *websocket.Conn) map[string]any {
	messageType, payload, err := connection.Read(ctx)
	if err != nil || messageType != websocket.MessageText {
		return nil
	}
	var message map[string]any
	if err := json.Unmarshal(payload, &message); err != nil {
		return nil
	}
	return message
}

func writeLifecycleWebSocketJSON(ctx context.Context, connection *websocket.Conn, payload map[string]any) {
	serialized, err := json.Marshal(payload)
	if err != nil {
		return
	}
	_ = connection.Write(ctx, websocket.MessageText, serialized)
}

func reserveLifecycleWebSocketURL(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	requireNoError(t, err)
	address := listener.Addr().String()
	requireNoError(t, listener.Close())
	return "ws://" + address
}

func receiveLifecycleBootstrapRequest(t *testing.T, requests <-chan string) string {
	t.Helper()
	select {
	case request := <-requests:
		return request
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for bootstrap gateway request")
		return ""
	}
}
