package sandboxdstate

import (
	"fmt"

	"github.com/mistle/sandboxd/cgroups"
	"github.com/mistle/sandboxd/idempotency"
	"github.com/mistle/sandboxd/keepalive"
	"github.com/mistle/sandboxd/opencodeproxy"
	"github.com/mistle/sandboxd/piproxy"
	"github.com/mistle/sandboxd/process"
	"github.com/mistle/sandboxd/runtime"
	"github.com/mistle/sandboxd/supervision"
	"github.com/mistle/sandboxd/timeutil"
)

type RuntimeAdapters struct {
	codexProxies       []*CodexProxyHandle
	codexControlHandle *CodexProxyControlHandle
	openCodeProxies    []*opencodeproxy.Proxy
	piProxies          []*piproxy.Proxy
	runtimeAgentProbes []*RuntimeAgentProbeHandle
	idempotencyStore   *idempotency.Store
	platformScopeInput *RuntimeAdapterPlatformScopeInput
}

type RuntimeAdapterOptions struct {
	IdempotencyStoreRoot string
	PlatformScopeInput   *RuntimeAdapterPlatformScopeInput
}

type RuntimeAdapterLifecycleObserver interface {
	RecordAdapterStarted(runtimeID string)
	RecordAdapterCompleted(runtimeID string)
}

type RuntimeAdapterError struct {
	RuntimeID string
	Cause     error
}

func (err *RuntimeAdapterError) Error() string {
	if err == nil || err.Cause == nil {
		return "runtime adapter startup failed"
	}
	return err.Cause.Error()
}

func (err *RuntimeAdapterError) Unwrap() error {
	if err == nil {
		return nil
	}
	return err.Cause
}

type RuntimeAdapterPlatformScopeInput struct {
	CgroupRoot        string
	SandboxInstanceID string
	Registry          *process.PlatformProcessRegistry
}

func DefaultRuntimeAdapterOptions() RuntimeAdapterOptions {
	return RuntimeAdapterOptions{IdempotencyStoreRoot: idempotency.DefaultStoreDir}
}

func StartRuntimeAdapters(
	runtimePlan runtime.CompiledRuntimePlan,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	keepaliveManager *keepalive.SharedManager,
	options RuntimeAdapterOptions,
) (*RuntimeAdapters, error) {
	return StartRuntimeAdaptersWithObserver(runtimePlan, supervisorHandle, keepaliveManager, options, nil)
}

func StartRuntimeAdaptersWithObserver(
	runtimePlan runtime.CompiledRuntimePlan,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	keepaliveManager *keepalive.SharedManager,
	options RuntimeAdapterOptions,
	observer RuntimeAdapterLifecycleObserver,
) (*RuntimeAdapters, error) {
	adapters := &RuntimeAdapters{platformScopeInput: options.PlatformScopeInput}
	if len(runtimePlan.AgentRuntimes) == 0 {
		return adapters, nil
	}
	if err := validateUniqueAgentRuntimeIDs(runtimePlan.AgentRuntimes); err != nil {
		return nil, err
	}
	if options.IdempotencyStoreRoot == "" {
		return nil, fmt.Errorf("runtime adapter idempotency store root is required")
	}
	idempotencyStore, err := idempotency.LoadStore(options.IdempotencyStoreRoot)
	if err != nil {
		return nil, fmt.Errorf("failed to load runtime adapter idempotency store: %w", err)
	}
	adapters.idempotencyStore = idempotencyStore
	for _, agentRuntime := range runtimePlan.AgentRuntimes {
		if observer != nil {
			observer.RecordAdapterStarted(agentRuntime.RuntimeID)
		}
		switch agentRuntime.RuntimeID {
		case "codex":
			if err := adapters.startCodex(runtimePlan, supervisorHandle, keepaliveManager); err != nil {
				adapters.Close()
				return nil, runtimeAdapterError(agentRuntime.RuntimeID, err)
			}
		case "opencode":
			if err := adapters.startOpenCode(agentRuntime, runtimePlan, supervisorHandle, keepaliveManager); err != nil {
				adapters.Close()
				return nil, runtimeAdapterError(agentRuntime.RuntimeID, err)
			}
		case "pi":
			if err := adapters.startPi(agentRuntime, runtimePlan, supervisorHandle, keepaliveManager); err != nil {
				adapters.Close()
				return nil, runtimeAdapterError(agentRuntime.RuntimeID, err)
			}
		default:
			adapters.Close()
			return nil, runtimeAdapterError(
				agentRuntime.RuntimeID,
				fmt.Errorf("sandboxd has no platform-activity adapter for runtime %q", agentRuntime.RuntimeID),
			)
		}
		if observer != nil {
			observer.RecordAdapterCompleted(agentRuntime.RuntimeID)
		}
	}
	return adapters, nil
}

func validateUniqueAgentRuntimeIDs(agentRuntimes []runtime.CompiledAgentRuntime) error {
	seenRuntimeIDs := map[string]struct{}{}
	for _, agentRuntime := range agentRuntimes {
		if _, exists := seenRuntimeIDs[agentRuntime.RuntimeID]; exists {
			return runtimeAdapterError(
				agentRuntime.RuntimeID,
				fmt.Errorf("runtime plan declared duplicate agent runtime id %q", agentRuntime.RuntimeID),
			)
		}
		seenRuntimeIDs[agentRuntime.RuntimeID] = struct{}{}
	}
	return nil
}

func runtimeAdapterError(runtimeID string, cause error) *RuntimeAdapterError {
	return &RuntimeAdapterError{RuntimeID: runtimeID, Cause: cause}
}

func (adapters *RuntimeAdapters) startCodex(
	runtimePlan runtime.CompiledRuntimePlan,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	keepaliveManager *keepalive.SharedManager,
) error {
	codexProxyPlan, err := CodexProxyPlanFromRuntimePlan(runtimePlan)
	if err != nil {
		return fmt.Errorf("failed to start Codex runtime adapter: %w", err)
	}
	if codexProxyPlan == nil {
		return fmt.Errorf("Codex runtime adapter plan is required")
	}
	codexProxy, err := StartCodexProxyWithIdempotencyStore(*codexProxyPlan, supervisorHandle, keepaliveManager, adapters.idempotencyStore)
	if err != nil {
		return fmt.Errorf("failed to start Codex runtime adapter: %w", err)
	}
	controlHandle := codexProxy.ControlHandle()
	adapters.codexControlHandle = &controlHandle
	adapters.codexProxies = append(adapters.codexProxies, codexProxy)
	runtimeAgentProbe, err := StartRuntimeAgentProbe(RuntimeAgentProbePlan{
		AgentEndpointURL: codexProxy.ListenURL(),
		RuntimeProbe:     CodexRuntimeProbe{},
	}, supervisorHandle, timeutil.ThreadSleeper{})
	if err != nil {
		return fmt.Errorf("failed to start runtime agent probe: %w", err)
	}
	adapters.runtimeAgentProbes = append(adapters.runtimeAgentProbes, runtimeAgentProbe)
	return nil
}

func (adapters *RuntimeAdapters) CodexProxyControlHandle() *CodexProxyControlHandle {
	if adapters == nil {
		return nil
	}
	return adapters.codexControlHandle
}

func (adapters *RuntimeAdapters) AgentEndpointURL() (string, error) {
	if adapters == nil {
		return "", nil
	}
	agentEndpointURLs := make([]string, 0, len(adapters.codexProxies)+len(adapters.openCodeProxies)+len(adapters.piProxies))
	if len(adapters.codexProxies) > 0 && adapters.codexProxies[0] != nil {
		for _, codexProxy := range adapters.codexProxies {
			if codexProxy != nil {
				agentEndpointURLs = append(agentEndpointURLs, codexProxy.ListenURL())
			}
		}
	}
	if len(adapters.openCodeProxies) > 0 {
		for _, openCodeProxy := range adapters.openCodeProxies {
			if openCodeProxy != nil {
				agentEndpointURLs = append(agentEndpointURLs, openCodeProxy.ListenURL())
			}
		}
	}
	if len(adapters.piProxies) > 0 {
		for _, piProxy := range adapters.piProxies {
			if piProxy != nil {
				agentEndpointURLs = append(agentEndpointURLs, piProxy.ListenURL())
			}
		}
	}
	switch len(agentEndpointURLs) {
	case 0:
		return "", nil
	case 1:
		return agentEndpointURLs[0], nil
	default:
		return "", fmt.Errorf("sandboxd currently supports exactly one runtime adapter endpoint")
	}
}

func (adapters *RuntimeAdapters) startOpenCode(
	agentRuntime runtime.CompiledAgentRuntime,
	runtimePlan runtime.CompiledRuntimePlan,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	keepaliveManager *keepalive.SharedManager,
) error {
	runtimeClient, err := findRuntimeClient(runtimePlan, agentRuntime.RuntimeID, agentRuntime.ClientID)
	if err != nil {
		return err
	}
	endpoint, err := findRuntimeClientWSEndpoint(runtimeClient, agentRuntime.RuntimeID, agentRuntime.EndpointKey)
	if err != nil {
		return err
	}
	if endpoint.ConnectionMode != "dedicated" {
		return fmt.Errorf("runtime %q endpoint uses unsupported connection mode %q", agentRuntime.RuntimeID, endpoint.ConnectionMode)
	}
	processSpec, err := findRuntimeClientProcess(runtimeClient, agentRuntime.RuntimeID, agentRuntime.RuntimeKey)
	if err != nil {
		return err
	}
	if processSpec.Readiness.Type != runtime.RuntimeClientProcessReadinessHTTP {
		return fmt.Errorf("runtime %q process %q must use http readiness so sandboxd can attach its OpenCode proxy adapter", agentRuntime.RuntimeID, processSpec.ProcessKey)
	}
	if processSpec.Readiness.URL == "" {
		return fmt.Errorf("runtime %q process %q readiness URL is required", agentRuntime.RuntimeID, processSpec.ProcessKey)
	}
	rawServerURL, err := opencodeproxy.DeriveRawServerURL(processSpec.Readiness.URL)
	if err != nil {
		return fmt.Errorf("failed to start OpenCode runtime adapter: %w", err)
	}
	openCodeProxy, err := opencodeproxy.StartOpenCodeProxyWithIdempotencyStore(endpoint.Transport.URL, rawServerURL, keepaliveManager, supervisorHandle, adapters.idempotencyStore)
	if err != nil {
		return fmt.Errorf("failed to start OpenCode runtime adapter: %w", err)
	}
	adapters.openCodeProxies = append(adapters.openCodeProxies, openCodeProxy)
	runtimeAgentProbe, err := StartRuntimeAgentProbe(RuntimeAgentProbePlan{
		AgentEndpointURL: openCodeProxy.ListenURL(),
		RuntimeProbe: OpenCodeRuntimeProbe{
			ProxyURL:       openCodeProxy.ListenURL(),
			HealthPath:     "/global/health",
			ExpectedStatus: processSpec.Readiness.ExpectedStatus,
		},
	}, supervisorHandle, timeutil.ThreadSleeper{})
	if err != nil {
		return fmt.Errorf("failed to start runtime agent probe: %w", err)
	}
	adapters.runtimeAgentProbes = append(adapters.runtimeAgentProbes, runtimeAgentProbe)
	return nil
}

func (adapters *RuntimeAdapters) startPi(
	agentRuntime runtime.CompiledAgentRuntime,
	runtimePlan runtime.CompiledRuntimePlan,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
	keepaliveManager *keepalive.SharedManager,
) error {
	runtimeClient, err := findRuntimeClient(runtimePlan, agentRuntime.RuntimeID, agentRuntime.ClientID)
	if err != nil {
		return err
	}
	endpoint, err := findRuntimeClientWSEndpoint(runtimeClient, agentRuntime.RuntimeID, agentRuntime.EndpointKey)
	if err != nil {
		return err
	}
	if endpoint.ConnectionMode != "dedicated" {
		return fmt.Errorf("runtime %q endpoint uses unsupported connection mode %q", agentRuntime.RuntimeID, endpoint.ConnectionMode)
	}
	piCLIPath := runtimeClient.Setup.Env["MISTLE_PI_CLI_PATH"]
	if piCLIPath == "" {
		return fmt.Errorf("Pi runtime client setup must define MISTLE_PI_CLI_PATH")
	}
	piConfig := piproxy.Config{
		PiCLIPath: piCLIPath,
		Env:       runtimeClient.Setup.Env,
	}
	var piProxy *piproxy.Proxy
	if adapters.optionsPlatformScopeInput() == nil {
		piProxy, err = piproxy.StartPiProxyWithIdempotencyStore(endpoint.Transport.URL, piConfig, keepaliveManager, supervisorHandle, adapters.idempotencyStore)
	} else {
		platformScope, scopeErr := createPiRuntimePlatformScope(*adapters.optionsPlatformScopeInput())
		if scopeErr != nil {
			return fmt.Errorf("failed to start Pi runtime adapter: %w", scopeErr)
		}
		piProxy, err = piproxy.StartPiProxyWithIdempotencyStoreAndPlatformScope(endpoint.Transport.URL, piConfig, keepaliveManager, supervisorHandle, adapters.idempotencyStore, platformScope)
	}
	if err != nil {
		return fmt.Errorf("failed to start Pi runtime adapter: %w", err)
	}
	adapters.piProxies = append(adapters.piProxies, piProxy)
	runtimeAgentProbe, err := StartRuntimeAgentProbe(RuntimeAgentProbePlan{
		AgentEndpointURL: piProxy.ListenURL(),
		RuntimeProbe: PiRuntimeProbe{
			ProxyURL: piProxy.ListenURL(),
		},
	}, supervisorHandle, timeutil.ThreadSleeper{})
	if err != nil {
		return fmt.Errorf("failed to start runtime agent probe: %w", err)
	}
	adapters.runtimeAgentProbes = append(adapters.runtimeAgentProbes, runtimeAgentProbe)
	return nil
}

func (adapters *RuntimeAdapters) optionsPlatformScopeInput() *RuntimeAdapterPlatformScopeInput {
	if adapters == nil {
		return nil
	}
	return adapters.platformScopeInput
}

func createPiRuntimePlatformScope(input RuntimeAdapterPlatformScopeInput) (piproxy.PlatformScope, error) {
	if input.Registry == nil {
		return piproxy.PlatformScope{}, fmt.Errorf("platform process registry is required")
	}
	scopePaths, err := cgroups.CreatePlatformScope(input.CgroupRoot, input.SandboxInstanceID, "pi-rpc")
	if err != nil {
		return piproxy.PlatformScope{}, err
	}
	return piproxy.PlatformScope{
		RegistryKey: "pi-rpc",
		ProcessKey:  "pi-rpc",
		ScopePaths:  scopePaths,
		Registry:    input.Registry,
	}, nil
}

func findRuntimeClient(
	runtimePlan runtime.CompiledRuntimePlan,
	runtimeID string,
	clientID string,
) (runtime.RuntimeClient, error) {
	for _, runtimeClient := range runtimePlan.RuntimeClients {
		if runtimeClient.ClientID == clientID {
			return runtimeClient, nil
		}
	}
	return runtime.RuntimeClient{}, fmt.Errorf("runtime %q references missing runtime client %q", runtimeID, clientID)
}

func findRuntimeClientWSEndpoint(
	runtimeClient runtime.RuntimeClient,
	runtimeID string,
	endpointKey string,
) (runtime.RuntimeClientEndpoint, error) {
	for _, endpoint := range runtimeClient.Endpoints {
		if endpoint.EndpointKey != endpointKey {
			continue
		}
		if endpoint.Transport.Type != "ws" {
			return runtime.RuntimeClientEndpoint{}, fmt.Errorf("runtime %q endpoint %q transport must be ws", runtimeID, endpointKey)
		}
		if endpoint.Transport.URL == "" {
			return runtime.RuntimeClientEndpoint{}, fmt.Errorf("runtime %q endpoint %q transport URL is required", runtimeID, endpointKey)
		}
		return endpoint, nil
	}
	return runtime.RuntimeClientEndpoint{}, fmt.Errorf("runtime %q references missing endpoint %q on runtime client %q", runtimeID, endpointKey, runtimeClient.ClientID)
}

func findRuntimeClientProcess(
	runtimeClient runtime.RuntimeClient,
	runtimeID string,
	processKey string,
) (runtime.RuntimeClientProcess, error) {
	for _, processSpec := range runtimeClient.Processes {
		if processSpec.ProcessKey == processKey {
			return processSpec, nil
		}
	}
	return runtime.RuntimeClientProcess{}, fmt.Errorf("runtime %q references missing process %q on runtime client %q", runtimeID, processKey, runtimeClient.ClientID)
}

func (adapters *RuntimeAdapters) Close() {
	if adapters == nil {
		return
	}
	for _, runtimeAgentProbe := range adapters.runtimeAgentProbes {
		if runtimeAgentProbe != nil {
			runtimeAgentProbe.Close()
		}
	}
	adapters.runtimeAgentProbes = nil
	for _, codexProxy := range adapters.codexProxies {
		if codexProxy != nil {
			_ = codexProxy.Close()
		}
	}
	adapters.codexProxies = nil
	for _, openCodeProxy := range adapters.openCodeProxies {
		if openCodeProxy != nil {
			_ = openCodeProxy.Close()
		}
	}
	adapters.openCodeProxies = nil
	for _, piProxy := range adapters.piProxies {
		if piProxy != nil {
			_ = piProxy.Close()
		}
	}
	adapters.piProxies = nil
}
