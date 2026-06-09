package sandboxdstate

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"reflect"
	"time"

	"github.com/mistle/sandboxd/cgroups"
	"github.com/mistle/sandboxd/egressproxy"
	"github.com/mistle/sandboxd/keepalive"
	"github.com/mistle/sandboxd/process"
	"github.com/mistle/sandboxd/protocol"
	"github.com/mistle/sandboxd/runtime"
	"github.com/mistle/sandboxd/runtime/readiness"
	"github.com/mistle/sandboxd/startupdiagnostics"
	"github.com/mistle/sandboxd/supervision"
	"github.com/mistle/sandboxd/timeutil"
	"github.com/mistle/sandboxd/tunnel"
	tunnelprotocol "github.com/mistle/sandboxd/tunnel/protocol"
)

const DefaultBootstrapTunnelConnectTimeout = 10 * time.Second
const DefaultBootstrapTunnelSigningTimeout = 120 * time.Second

type ExecutionMode string

const (
	ExecutionModeSession  ExecutionMode = "session"
	ExecutionModeSnapshot ExecutionMode = "snapshot"
)

type State struct {
	sandboxInstanceID     string
	executionMode         ExecutionMode
	runtimeEnv            map[string]string
	acceptedSessionInput  protocol.SessionRuntimeInput
	acceptedRuntimePlan   json.RawMessage
	acceptedTunnelGateway string
	acceptedTransparent   *protocol.TransparentProxyConfiguration
	supervisorHandle      *supervision.SandboxdSupervisorHandle
	keepaliveManager      *keepalive.SharedManager
	runtimeReadiness      *readiness.Manager
	readinessProjection   *RuntimeReadinessProjectionHandle
	runtimeAdapterOptions RuntimeAdapterOptions
	egressProxyOptions    egressproxy.ManagedProxyOptions
	platformScopeInput    *process.PlatformProcessScopeInput
	globalGitConfigPath   string
	egressProxy           *egressproxy.ManagedProxy
	egressTokenProvider   *tunnel.LiveTunnelEgressTokenProvider
	processManager        *process.RuntimeClientProcessManager
	runtimeAdapters       *RuntimeAdapters
	runtimeCoordination   *RuntimeCoordinationHandle
	bootstrapTunnel       *tunnel.BootstrapTunnel
	liveTunnelSession     *tunnel.LiveTunnelSession
	diagnosticsLogger     *startupdiagnostics.ActivationDiagnosticsLogger
}

type ActivationOptions struct {
	RuntimeAdapterOptions RuntimeAdapterOptions
	EgressProxyOptions    egressproxy.ManagedProxyOptions
	PlatformScopeRoot     string
	PlatformRegistry      *process.PlatformProcessRegistry
	DiagnosticsLogger     *startupdiagnostics.ActivationDiagnosticsLogger
	GlobalGitConfigPath   string
}

func DefaultActivationOptions() ActivationOptions {
	return ActivationOptions{RuntimeAdapterOptions: DefaultRuntimeAdapterOptions()}
}

func ActivateNew(activationInput protocol.ActivationInput, clock timeutil.Clock) (*State, error) {
	options, err := DefaultProductionActivationOptions()
	if err != nil {
		return nil, err
	}
	return ActivateNewWithOptions(activationInput, clock, options)
}

func DefaultProductionActivationOptions() (ActivationOptions, error) {
	options := DefaultActivationOptions()
	executablePath, err := os.Executable()
	if err != nil {
		return ActivationOptions{}, fmt.Errorf("failed to resolve sandboxd executable for managed egress proxy: %w", err)
	}
	options.EgressProxyOptions.ChildBinaryPath = executablePath
	options.EgressProxyOptions.RuntimeProxyCACertPath = egressproxy.DefaultRuntimeProxyCACertPath
	options.EgressProxyOptions.RuntimeProxyCABundlePath = egressproxy.DefaultRuntimeProxyCABundlePath
	options.EgressProxyOptions.PersistentProxyCACertPath = egressproxy.DefaultPersistentProxyCACertPath
	options.EgressProxyOptions.PersistentProxyCAKeyPath = egressproxy.DefaultPersistentProxyCAKeyPath
	options.EgressProxyOptions.TrustStoreProxyCACertPath = egressproxy.DefaultTrustStoreProxyCACertPath
	options.EgressProxyOptions.SystemCABundlePath = egressproxy.DefaultSystemCABundlePath
	options.EgressProxyOptions.TrustStoreRefreshCommand = egressproxy.DefaultTrustStoreRefreshCommand
	return options, nil
}

func ActivateNewWithOptions(activationInput protocol.ActivationInput, clock timeutil.Clock, options ActivationOptions) (*State, error) {
	if clock == nil {
		return nil, fmt.Errorf("sandboxd state clock is required")
	}
	if options.RuntimeAdapterOptions.IdempotencyStoreRoot == "" {
		return nil, fmt.Errorf("runtime adapter idempotency store root is required")
	}
	if options.PlatformScopeRoot != "" && options.PlatformRegistry == nil {
		return nil, fmt.Errorf("platform process registry is required")
	}
	if options.PlatformScopeRoot == "" && options.PlatformRegistry != nil {
		return nil, fmt.Errorf("platform scope root is required")
	}
	globalGitConfigPath := options.GlobalGitConfigPath
	if globalGitConfigPath == "" {
		globalGitConfigPath = DefaultGlobalGitConfigPath
	}
	sessionInput := protocol.SessionRuntimeInputFromActivationInput(activationInput)
	runtimePlan, err := DecodeRuntimePlan(sessionInput.RuntimePlan)
	if err != nil {
		return nil, fmt.Errorf("failed to apply session input: %w", err)
	}
	sandboxInstanceID, err := tunnel.DeriveSandboxInstanceID(sessionInput.TunnelGatewayWSURL)
	if err != nil {
		return nil, fmt.Errorf("failed to start bootstrap tunnel session: %w", err)
	}
	mistleContextEnv, err := CollectMistleContextRuntimeEnvironment(sessionInput, sandboxInstanceID)
	if err != nil {
		return nil, fmt.Errorf("failed to start runtime processes: %w", err)
	}
	trackedComponents := CollectTrackedComponents(runtimePlan)
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		sandboxInstanceID,
		clock,
		trackedComponents,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to start runtime processes: %w", err)
	}
	runtimeEnv, err := CollectRuntimeEnvironment(runtimePlan)
	if err != nil {
		return nil, fmt.Errorf("failed to start runtime processes: %w", err)
	}
	platformScopeInput := platformScopeInputForActivation(options, sandboxInstanceID)

	state := &State{
		sandboxInstanceID:     sandboxInstanceID,
		executionMode:         executionModeForActivation(activationInput.OperationKind),
		acceptedSessionInput:  cloneSessionRuntimeInput(sessionInput),
		acceptedRuntimePlan:   cloneJSONRawMessage(activationInput.RuntimePlan),
		acceptedTunnelGateway: sessionInput.TunnelGatewayWSURL,
		acceptedTransparent:   cloneTransparentProxyConfiguration(sessionInput.TransparentProxy),
		supervisorHandle:      supervisorHandle,
		keepaliveManager:      keepalive.NewSharedManager(),
		runtimeReadiness:      &readiness.Manager{},
		runtimeAdapterOptions: options.RuntimeAdapterOptions,
		egressProxyOptions:    options.EgressProxyOptions,
		platformScopeInput:    platformScopeInput,
		globalGitConfigPath:   globalGitConfigPath,
		diagnosticsLogger:     options.DiagnosticsLogger,
	}
	state.startRuntimeReadinessProjection(trackedComponents)
	if err := RecordOperationPhaseStartedWithAttributes(
		state.diagnosticsLogger,
		clock,
		"start_tunnel_session",
		TimelineAttributes("tunnel", "Connecting tunnel"),
	); err != nil {
		state.closeStartedRuntimeSupport(clock)
		return nil, err
	}
	bootstrapTunnel, err := connectBootstrapTunnel(sessionInput, supervisorHandle)
	if err != nil {
		_ = RecordOperationPhaseFailure(
			state.diagnosticsLogger,
			clock,
			"start_tunnel_session",
			map[string]any{"error": err.Error()},
		)
		state.closeStartedRuntimeSupport(clock)
		return nil, err
	}
	state.bootstrapTunnel = bootstrapTunnel
	if err := state.startLiveTunnelSession(clock, sessionInput); err != nil {
		_ = RecordOperationPhaseFailure(
			state.diagnosticsLogger,
			clock,
			"start_tunnel_session",
			map[string]any{"error": err.Error()},
		)
		state.closeStartedRuntimeSupport(clock)
		return nil, err
	}
	if state.diagnosticsLogger != nil && state.liveTunnelSession != nil {
		state.diagnosticsLogger.AttachOperationPublisher(state.liveTunnelSession)
	}
	if err := RecordOperationPhaseCompletedWithAttributes(
		state.diagnosticsLogger,
		clock,
		"start_tunnel_session",
		TimelineAttributes("tunnel", "Connecting tunnel"),
	); err != nil {
		state.closeStartedRuntimeSupport(clock)
		return nil, err
	}
	if err := RecordOperationPhaseStartedWithAttributes(
		state.diagnosticsLogger,
		clock,
		"apply_git_identity",
		TimelineAttributes("git-identity", "Configuring Git"),
	); err != nil {
		state.closeStartedRuntimeSupport(clock)
		return nil, err
	}
	if activationInput.OperationKind != protocol.ActivationOperationSnapshot && sessionInput.GitIdentity != nil {
		if err := runtime.ApplyGitIdentity(sessionInput, globalGitConfigPath); err != nil {
			_ = RecordOperationPhaseFailure(
				state.diagnosticsLogger,
				clock,
				"apply_git_identity",
				map[string]any{"error": err.Error()},
			)
			state.closeStartedRuntimeSupport(clock)
			return nil, fmt.Errorf("failed to apply Git identity: %w", err)
		}
	}
	if err := RecordOperationPhaseCompletedWithAttributes(
		state.diagnosticsLogger,
		clock,
		"apply_git_identity",
		TimelineAttributes("git-identity", "Configuring Git"),
	); err != nil {
		state.closeStartedRuntimeSupport(clock)
		return nil, err
	}
	egressProxyEnv, err := state.startEgressProxy(runtimePlan, sessionInput, clock)
	if err != nil {
		state.closeStartedRuntimeSupport(clock)
		return nil, err
	}
	mergedRuntimeEnv, err := MergeManagedRuntimeEnvironment(runtimeEnv, mistleContextEnv, egressProxyEnv)
	if err != nil {
		state.closeStartedRuntimeSupport(clock)
		return nil, fmt.Errorf("failed to start runtime processes: %w", err)
	}
	state.runtimeEnv = mergedRuntimeEnv
	if state.liveTunnelSession != nil {
		state.liveTunnelSession.SetRuntimeEnv(mergedRuntimeEnv)
	}
	if shouldApplyRuntimePlanForActivation(runtimePlan.Image.Source, activationInput.OperationKind) {
		if err := RecordOperationPhaseStartedWithAttributes(
			state.diagnosticsLogger,
			clock,
			"apply_runtime_plan",
			TimelineAttributes("runtime-plan", "Applying runtime plan"),
		); err != nil {
			state.closeStartedRuntimeSupport(clock)
			return nil, err
		}
		if err := runtime.ApplyCompiledRuntimePlanWithEnvironmentOutputSinkAndObserver(
			runtimePlan,
			mergedRuntimeEnv,
			OperationTranscriptOutputSink{
				Logger: state.diagnosticsLogger,
				Clock:  clock,
				Phase:  "apply_runtime_plan",
			},
			RuntimePlanTimelineObserver{Logger: state.diagnosticsLogger, Clock: clock},
		); err != nil {
			_ = RecordRuntimePlanApplyFailure(state.diagnosticsLogger, clock, err)
			state.closeStartedRuntimeSupport(clock)
			return nil, fmt.Errorf("failed to apply runtime plan: %w", err)
		}
		if err := RecordOperationPhaseCompletedWithAttributes(
			state.diagnosticsLogger,
			clock,
			"apply_runtime_plan",
			TimelineAttributes("runtime-plan", "Applying runtime plan"),
		); err != nil {
			state.closeStartedRuntimeSupport(clock)
			return nil, err
		}
	}
	if shouldRunSetupScriptForActivation(runtimePlan.Image.Source, activationInput.OperationKind) {
		if err := RecordOperationPhaseStartedWithAttributes(
			state.diagnosticsLogger,
			clock,
			"run_setup_script",
			TimelineAttributes("setup-script", "Running setup script"),
		); err != nil {
			state.closeStartedRuntimeSupport(clock)
			return nil, err
		}
		failure := RunSetupScriptWithOutputSink(runtimePlan, mergedRuntimeEnv, OperationTranscriptOutputSink{
			Logger: state.diagnosticsLogger,
			Clock:  clock,
			Phase:  "run_setup_script",
		})
		if failure != nil {
			_ = RecordSetupScriptFailure(state.diagnosticsLogger, clock, *failure)
			state.closeStartedRuntimeSupport(clock)
			return nil, fmt.Errorf("failed to run setup script: %s", failure.Message)
		}
		if err := RecordOperationPhaseCompletedWithAttributes(
			state.diagnosticsLogger,
			clock,
			"run_setup_script",
			TimelineAttributes("setup-script", "Running setup script"),
		); err != nil {
			state.closeStartedRuntimeSupport(clock)
			return nil, err
		}
	}
	if activationInput.OperationKind == protocol.ActivationOperationSnapshot {
		if err := state.finishSnapshotActivation(clock); err != nil {
			state.closeStartedRuntimeSupport(clock)
			return nil, err
		}
		return state, nil
	}
	if shouldStartRuntimeProcessesForActivation(activationInput.OperationKind) {
		processSpecs := process.FlattenRuntimeClientProcesses(runtimePlan.RuntimeClients, mergedRuntimeEnv)
		var processManager *process.RuntimeClientProcessManager
		runtimeProcessObserver := RuntimeProcessTimelineObserver{Logger: state.diagnosticsLogger, Clock: clock}
		if platformScopeInput == nil {
			processManager, err = process.StartRuntimeClientProcessManagerWithSupervisorAndObserver(
				processSpecs,
				clock,
				timeutil.ThreadSleeper{},
				supervisorHandle,
				runtimeProcessObserver,
			)
		} else {
			processManager, err = process.StartRuntimeClientProcessManagerWithPlatformScopesAndObserver(
				processSpecs,
				clock,
				timeutil.ThreadSleeper{},
				supervisorHandle,
				*platformScopeInput,
				runtimeProcessObserver,
			)
		}
		if err != nil {
			var processManagerErr *process.ProcessManagerError
			if errors.As(err, &processManagerErr) {
				_ = RecordRuntimeProcessFailure(state.diagnosticsLogger, clock, processManagerErr)
			} else {
				_ = RecordOperationPhaseFailure(
					state.diagnosticsLogger,
					clock,
					"start_runtime_processes",
					map[string]any{"error": err.Error()},
				)
			}
			state.closeStartedRuntimeSupport(clock)
			return nil, fmt.Errorf("failed to start runtime processes: %w", err)
		}
		state.processManager = processManager
	}
	if shouldStartRuntimeSupportForActivation(activationInput.OperationKind) {
		if err := RecordOperationPhaseStartedWithAttributes(
			state.diagnosticsLogger,
			clock,
			"start_runtime_adapters",
			TimelineAttributes("runtime-adapters", "Starting runtime adapters"),
		); err != nil {
			state.closeStartedRuntimeSupport(clock)
			return nil, err
		}
		if err := state.startRuntimeSupport(runtimePlan, clock); err != nil {
			_ = RecordRuntimeAdapterFailure(state.diagnosticsLogger, clock, err)
			state.closeStartedRuntimeSupport(clock)
			return nil, err
		}
		if err := RecordOperationPhaseCompletedWithAttributes(
			state.diagnosticsLogger,
			clock,
			"start_runtime_adapters",
			TimelineAttributes("runtime-adapters", "Starting runtime adapters"),
		); err != nil {
			state.closeStartedRuntimeSupport(clock)
			return nil, err
		}
	}
	state.startRuntimeCoordination(clock)
	if err := RecordOperationPhaseStarted(state.diagnosticsLogger, clock, "ready"); err != nil {
		state.closeStartedRuntimeSupport(clock)
		return nil, err
	}
	if state.diagnosticsLogger != nil {
		state.diagnosticsLogger.CloseOperationStream()
	}
	return state, nil
}

func DecodeRuntimePlan(runtimePlanJSON json.RawMessage) (runtime.CompiledRuntimePlan, error) {
	var runtimePlan runtime.CompiledRuntimePlan
	if err := json.Unmarshal(runtimePlanJSON, &runtimePlan); err != nil {
		return runtime.CompiledRuntimePlan{}, err
	}
	if runtimePlan.SandboxProfileID == "" {
		return runtime.CompiledRuntimePlan{}, fmt.Errorf("runtime plan sandboxProfileId is required")
	}
	if runtimePlan.Version == 0 {
		return runtime.CompiledRuntimePlan{}, fmt.Errorf("runtime plan version is required")
	}
	return runtimePlan, nil
}

func (state *State) SandboxInstanceID() string {
	return state.sandboxInstanceID
}

func (state *State) ExecutionMode() ExecutionMode {
	return state.executionMode
}

func (state *State) RuntimeEnvironment() map[string]string {
	return cloneStringMap(state.runtimeEnv)
}

func (state *State) HealthSnapshot() supervision.HealthSnapshot {
	return state.supervisorHandle.Snapshot()
}

func (state *State) RequestSigning(payload string) (string, error) {
	if state.liveTunnelSession == nil {
		return "", fmt.Errorf("bootstrap tunnel session is not initialized")
	}
	requestMessage, err := tunnelprotocol.ParseSigningControlMessage(payload)
	if err != nil {
		return "", err
	}
	if requestMessage == nil || requestMessage.Request == nil {
		return "", fmt.Errorf("signing request payload is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), DefaultBootstrapTunnelSigningTimeout)
	defer cancel()
	responsePayload, err := state.liveTunnelSession.RequestSigning(ctx, payload)
	if err != nil {
		return "", err
	}
	responseMessage, err := tunnelprotocol.ParseSigningControlMessage(responsePayload)
	if err != nil {
		return "", err
	}
	if responseMessage == nil {
		return "", fmt.Errorf("bootstrap tunnel returned unsupported signing response")
	}
	if responseMessage.SuccessResult != nil {
		if responseMessage.SuccessResult.RequestID != requestMessage.Request.RequestID {
			return "", fmt.Errorf("bootstrap tunnel signing result requestId %s did not match requestId %s", responseMessage.SuccessResult.RequestID, requestMessage.Request.RequestID)
		}
		return responseMessage.SuccessResult.Signature, nil
	}
	if responseMessage.FailureResult != nil {
		if responseMessage.FailureResult.RequestID != requestMessage.Request.RequestID {
			return "", fmt.Errorf("bootstrap tunnel signing result requestId %s did not match requestId %s", responseMessage.FailureResult.RequestID, requestMessage.Request.RequestID)
		}
		return "", fmt.Errorf("bootstrap tunnel signing failed (%s): %s", responseMessage.FailureResult.Code, responseMessage.FailureResult.Message)
	}
	return "", fmt.Errorf("bootstrap tunnel returned unsupported signing response")
}

func (state *State) SetDiagnosticsLogger(logger *startupdiagnostics.ActivationDiagnosticsLogger) {
	if state.diagnosticsLogger != nil {
		state.diagnosticsLogger.CloseOperationStream()
	}
	state.diagnosticsLogger = logger
}

func (state *State) ActivateInitialized(activationInput protocol.ActivationInput) error {
	if activationInput.OperationKind == protocol.ActivationOperationSnapshot {
		return fmt.Errorf("snapshot materialization activation is only supported before sandboxd is initialized")
	}
	if state.executionMode == ExecutionModeSnapshot {
		return fmt.Errorf("snapshot materialization sandboxes do not support activation")
	}
	if same, err := runtimePlanJSONEqual(state.acceptedRuntimePlan, activationInput.RuntimePlan); err != nil {
		return fmt.Errorf("initialized activation cannot compare runtime plan: %w", err)
	} else if !same {
		return fmt.Errorf("initialized activation cannot change runtime plan")
	}
	sessionInput := protocol.SessionRuntimeInputFromActivationInput(activationInput)
	if !reflect.DeepEqual(state.acceptedTransparent, sessionInput.TransparentProxy) {
		return fmt.Errorf("initialized activation cannot change egress proxy input")
	}
	egressProxyRefreshRequired := state.egressProxy != nil && state.acceptedTunnelGateway != "" && state.acceptedTunnelGateway != sessionInput.TunnelGatewayWSURL
	previousSessionInput := cloneSessionRuntimeInput(state.acceptedSessionInput)
	previousBootstrapTunnel := state.bootstrapTunnel
	previousLiveTunnelSession := state.liveTunnelSession
	previousEgressProxy := state.egressProxy
	previousTunnelHealthSnapshot := state.supervisorHandle.ComponentSnapshot(supervision.ComponentTunnelSession)
	if err := RecordOperationPhaseStartedWithAttributes(state.diagnosticsLogger, timeutil.SystemClock{}, "start_tunnel_session", TimelineAttributes("tunnel", "Connecting tunnel")); err != nil {
		return err
	}
	replacementTunnel, err := connectBootstrapTunnel(sessionInput, state.supervisorHandle)
	if err != nil {
		_ = RecordOperationPhaseFailure(state.diagnosticsLogger, timeutil.SystemClock{}, "start_tunnel_session", map[string]any{"error": err.Error()})
		return err
	}
	state.bootstrapTunnel = replacementTunnel
	if err := state.startLiveTunnelSession(timeutil.SystemClock{}, sessionInput); err != nil {
		state.bootstrapTunnel = previousBootstrapTunnel
		state.liveTunnelSession = previousLiveTunnelSession
		_ = replacementTunnel.Close()
		_ = RecordOperationPhaseFailure(state.diagnosticsLogger, timeutil.SystemClock{}, "start_tunnel_session", map[string]any{"error": err.Error()})
		return err
	}
	replacementLiveTunnelSession := state.liveTunnelSession
	if state.egressTokenProvider != nil {
		if err := state.egressTokenProvider.AttachSession(replacementLiveTunnelSession); err != nil {
			state.restoreInitializedActivationTunnel(
				previousBootstrapTunnel,
				previousLiveTunnelSession,
				previousTunnelHealthSnapshot,
				replacementTunnel,
				replacementLiveTunnelSession,
				timeutil.SystemClock{},
			)
			_ = RecordOperationPhaseFailure(state.diagnosticsLogger, timeutil.SystemClock{}, "start_tunnel_session", map[string]any{"error": err.Error()})
			return err
		}
	}
	if err := RecordOperationPhaseCompletedWithAttributes(state.diagnosticsLogger, timeutil.SystemClock{}, "start_tunnel_session", TimelineAttributes("tunnel", "Connecting tunnel")); err != nil {
		return err
	}
	if err := RecordOperationPhaseStartedWithAttributes(state.diagnosticsLogger, timeutil.SystemClock{}, "apply_git_identity", TimelineAttributes("git-identity", "Configuring Git")); err != nil {
		return err
	}
	if err := runtime.ApplyGitIdentity(sessionInput, state.globalGitConfigPath); err != nil {
		state.restoreInitializedActivationTunnel(
			previousBootstrapTunnel,
			previousLiveTunnelSession,
			previousTunnelHealthSnapshot,
			replacementTunnel,
			replacementLiveTunnelSession,
			timeutil.SystemClock{},
		)
		_ = RecordOperationPhaseFailure(state.diagnosticsLogger, timeutil.SystemClock{}, "apply_git_identity", map[string]any{"error": err.Error()})
		var restoreErrors []error
		if restoreErr := restoreGitIdentityForInitializedActivation(previousSessionInput, state.globalGitConfigPath); restoreErr != nil {
			restoreErrors = append(restoreErrors, restoreErr)
		}
		if len(restoreErrors) > 0 {
			return errors.Join(append([]error{fmt.Errorf("failed to apply Git identity: %w", err)}, restoreErrors...)...)
		}
		return fmt.Errorf("failed to apply Git identity: %w", err)
	}
	if err := RecordOperationPhaseCompletedWithAttributes(state.diagnosticsLogger, timeutil.SystemClock{}, "apply_git_identity", TimelineAttributes("git-identity", "Configuring Git")); err != nil {
		return err
	}
	if state.egressTokenProvider != nil {
		if err := state.egressTokenProvider.SetActingUserID(sessionInput.ActingUserID); err != nil {
			state.restoreInitializedActivationTunnel(
				previousBootstrapTunnel,
				previousLiveTunnelSession,
				previousTunnelHealthSnapshot,
				replacementTunnel,
				replacementLiveTunnelSession,
				timeutil.SystemClock{},
			)
			var restoreErrors []error
			if restoreErr := state.egressTokenProvider.AttachSession(previousLiveTunnelSession); restoreErr != nil {
				restoreErrors = append(restoreErrors, restoreErr)
			}
			if restoreErr := state.egressTokenProvider.SetActingUserID(previousSessionInput.ActingUserID); restoreErr != nil {
				restoreErrors = append(restoreErrors, restoreErr)
			}
			if restoreErr := restoreGitIdentityForInitializedActivation(previousSessionInput, state.globalGitConfigPath); restoreErr != nil {
				restoreErrors = append(restoreErrors, restoreErr)
			}
			if len(restoreErrors) > 0 {
				return errors.Join(append([]error{err}, restoreErrors...)...)
			}
			return err
		}
	}
	if err := RecordOperationPhaseStartedWithAttributes(state.diagnosticsLogger, timeutil.SystemClock{}, "attach_runtime_environment", TimelineAttributes("runtime-environment", "Configuring runtime environment")); err != nil {
		return err
	}
	if err := RecordOperationPhaseCompletedWithAttributes(state.diagnosticsLogger, timeutil.SystemClock{}, "attach_runtime_environment", TimelineAttributes("runtime-environment", "Configuring runtime environment")); err != nil {
		return err
	}
	if err := RecordOperationPhaseStartedWithAttributes(state.diagnosticsLogger, timeutil.SystemClock{}, "attach_runtime_agent_endpoint", HiddenTimelineAttributes()); err != nil {
		return err
	}
	if err := RecordOperationPhaseCompletedWithAttributes(state.diagnosticsLogger, timeutil.SystemClock{}, "attach_runtime_agent_endpoint", HiddenTimelineAttributes()); err != nil {
		return err
	}
	if egressProxyRefreshRequired {
		if err := state.restartEgressProxyForInitializedActivation(sessionInput, timeutil.SystemClock{}); err != nil {
			state.restoreInitializedActivationTunnel(
				previousBootstrapTunnel,
				previousLiveTunnelSession,
				previousTunnelHealthSnapshot,
				replacementTunnel,
				replacementLiveTunnelSession,
				timeutil.SystemClock{},
			)
			var restoreErrors []error
			if state.egressTokenProvider != nil {
				if restoreErr := state.egressTokenProvider.AttachSession(previousLiveTunnelSession); restoreErr != nil {
					restoreErrors = append(restoreErrors, restoreErr)
				}
				if restoreErr := state.egressTokenProvider.SetActingUserID(previousSessionInput.ActingUserID); restoreErr != nil {
					restoreErrors = append(restoreErrors, restoreErr)
				}
			}
			if restoreErr := state.restoreEgressProxyForInitializedActivation(previousEgressProxy, previousSessionInput, timeutil.SystemClock{}); restoreErr != nil {
				restoreErrors = append(restoreErrors, restoreErr)
			}
			if restoreErr := restoreGitIdentityForInitializedActivation(previousSessionInput, state.globalGitConfigPath); restoreErr != nil {
				restoreErrors = append(restoreErrors, restoreErr)
			}
			if len(restoreErrors) > 0 {
				return errors.Join(append([]error{err}, restoreErrors...)...)
			}
			return err
		}
	}
	if err := closeReplacedInitializedActivationTunnel(previousBootstrapTunnel, previousLiveTunnelSession); err != nil {
		return err
	}
	if state.diagnosticsLogger != nil && state.liveTunnelSession != nil {
		state.diagnosticsLogger.AttachOperationPublisher(state.liveTunnelSession)
	}
	state.acceptedSessionInput = cloneSessionRuntimeInput(sessionInput)
	state.acceptedTunnelGateway = sessionInput.TunnelGatewayWSURL
	state.acceptedTransparent = cloneTransparentProxyConfiguration(sessionInput.TransparentProxy)
	if err := RecordOperationPhaseStarted(state.diagnosticsLogger, timeutil.SystemClock{}, "ready"); err != nil {
		return err
	}
	if state.diagnosticsLogger != nil {
		state.diagnosticsLogger.CloseOperationStream()
	}
	return nil
}

func restoreGitIdentityForInitializedActivation(previousSessionInput protocol.SessionRuntimeInput, globalGitConfigPath string) error {
	if err := runtime.ApplyGitIdentity(previousSessionInput, globalGitConfigPath); err != nil {
		return fmt.Errorf("failed to restore accepted Git identity after initialized activation failure: %w", err)
	}
	return nil
}

func (state *State) restartEgressProxyForInitializedActivation(sessionInput protocol.SessionRuntimeInput, clock timeutil.Clock) error {
	if state.egressProxy == nil {
		return nil
	}
	runtimePlan, err := DecodeRuntimePlan(state.acceptedRuntimePlan)
	if err != nil {
		return fmt.Errorf("failed to refresh local egress proxy: %w", err)
	}
	options := state.stableEgressProxyOptionsForInitializedActivation("")
	if err := state.egressProxy.Close(); err != nil {
		return fmt.Errorf("failed to stop local egress proxy for initialized activation: %w", err)
	}
	state.egressProxy = nil
	previousOptions := state.egressProxyOptions
	state.egressProxyOptions = options
	_, startErr := state.startEgressProxy(runtimePlan, sessionInput, clock)
	state.egressProxyOptions = previousOptions
	if startErr != nil {
		return fmt.Errorf("failed to refresh local egress proxy: %w", startErr)
	}
	if state.egressProxy == nil {
		return fmt.Errorf("failed to refresh local egress proxy: initialized activation candidate no longer configures an egress proxy")
	}
	return nil
}

func (state *State) restoreInitializedActivationTunnel(
	previousBootstrapTunnel *tunnel.BootstrapTunnel,
	previousLiveTunnelSession *tunnel.LiveTunnelSession,
	previousTunnelHealthSnapshot *supervision.ComponentHealthSnapshot,
	replacementTunnel *tunnel.BootstrapTunnel,
	replacementLiveTunnelSession *tunnel.LiveTunnelSession,
	clock timeutil.Clock,
) {
	if replacementLiveTunnelSession != nil {
		_ = replacementLiveTunnelSession.Close()
	} else if replacementTunnel != nil {
		_ = replacementTunnel.Close()
	}
	state.bootstrapTunnel = previousBootstrapTunnel
	state.liveTunnelSession = previousLiveTunnelSession
	if previousTunnelHealthSnapshot != nil {
		state.supervisorHandle.RestoreComponentSnapshot(*previousTunnelHealthSnapshot)
	}
	if previousLiveTunnelSession != nil || previousBootstrapTunnel != nil {
		if runtimePlan, err := DecodeRuntimePlan(state.acceptedRuntimePlan); err == nil {
			SyncRuntimeReadinessFromSnapshot(state.supervisorHandle, state.runtimeReadiness, DetermineRuntimeReadinessMode(CollectTrackedComponents(runtimePlan)))
		} else {
			fmt.Fprintf(os.Stderr, "sandboxd failed to reconnect runtime readiness after activation refresh: %v\n", err)
		}
		state.keepaliveManager.WithLocked(func(manager *keepalive.Manager) {
			manager.OnTunnelConnected(clock)
		})
		state.runtimeReadiness.OnTunnelConnected()
	}
}

func closeReplacedInitializedActivationTunnel(
	previousBootstrapTunnel *tunnel.BootstrapTunnel,
	previousLiveTunnelSession *tunnel.LiveTunnelSession,
) error {
	if previousLiveTunnelSession != nil {
		return previousLiveTunnelSession.Close()
	}
	if previousBootstrapTunnel != nil {
		return previousBootstrapTunnel.Close()
	}
	return nil
}

func (state *State) restoreEgressProxyForInitializedActivation(
	previousEgressProxy *egressproxy.ManagedProxy,
	previousSessionInput protocol.SessionRuntimeInput,
	clock timeutil.Clock,
) error {
	if previousEgressProxy == nil {
		return nil
	}
	if state.egressProxy == previousEgressProxy {
		return nil
	}
	runtimePlan, err := DecodeRuntimePlan(previousSessionInput.RuntimePlan)
	if err != nil {
		return fmt.Errorf("failed to restore previous local egress proxy after initialized activation failure: %w", err)
	}
	previousRuntimeEnv := previousEgressProxy.RuntimeEnvironment()
	options := state.stableEgressProxyOptionsForInitializedActivation(previousRuntimeEnv[egressproxy.SSL_CERT_FILE])
	previousOptions := state.egressProxyOptions
	state.egressProxyOptions = options
	_, startErr := state.startEgressProxy(runtimePlan, previousSessionInput, clock)
	state.egressProxyOptions = previousOptions
	if startErr != nil {
		return fmt.Errorf("failed to restore previous local egress proxy after initialized activation failure: %w", startErr)
	}
	if state.egressProxy == nil {
		return fmt.Errorf("failed to restore previous local egress proxy after initialized activation failure: previous session no longer configures an egress proxy")
	}
	return nil
}

func (state *State) stableEgressProxyOptionsForInitializedActivation(runtimeProxyCABundlePath string) egressproxy.ManagedProxyOptions {
	options := state.egressProxyOptions
	if runtimeProxyCABundlePath != "" {
		options.RuntimeProxyCABundlePath = runtimeProxyCABundlePath
	}
	if snapshot := state.supervisorHandle.ComponentSnapshot(supervision.ComponentEgressProxy); snapshot != nil {
		if listenAddr := snapshot.Details["listenAddr"]; listenAddr != "" {
			options.ListenAddr = listenAddr
		}
	}
	return options
}

func runtimePlanJSONEqual(accepted json.RawMessage, candidate json.RawMessage) (bool, error) {
	var acceptedValue any
	if err := json.Unmarshal(accepted, &acceptedValue); err != nil {
		return false, err
	}
	var candidateValue any
	if err := json.Unmarshal(candidate, &candidateValue); err != nil {
		return false, err
	}
	return reflect.DeepEqual(acceptedValue, candidateValue), nil
}

func cloneJSONRawMessage(value json.RawMessage) json.RawMessage {
	if value == nil {
		return nil
	}
	return append(json.RawMessage(nil), value...)
}

func cloneSessionRuntimeInput(value protocol.SessionRuntimeInput) protocol.SessionRuntimeInput {
	return protocol.SessionRuntimeInput{
		OperationKind:       value.OperationKind,
		BootstrapToken:      value.BootstrapToken,
		TunnelExchangeToken: value.TunnelExchangeToken,
		TunnelGatewayWSURL:  value.TunnelGatewayWSURL,
		RuntimePlan:         cloneJSONRawMessage(value.RuntimePlan),
		ActingUserID:        cloneStringPointer(value.ActingUserID),
		GitIdentity:         cloneGitIdentity(value.GitIdentity),
		TransparentProxy:    cloneTransparentProxyConfiguration(value.TransparentProxy),
	}
}

func cloneStringPointer(value *string) *string {
	if value == nil {
		return nil
	}
	clone := *value
	return &clone
}

func cloneGitIdentity(value *protocol.GitIdentity) *protocol.GitIdentity {
	if value == nil {
		return nil
	}
	clone := *value
	if value.Signing != nil {
		signingClone := *value.Signing
		signingClone.IntegrationConnectionID = cloneStringPointer(value.Signing.IntegrationConnectionID)
		clone.Signing = &signingClone
	}
	return &clone
}

func cloneTransparentProxyConfiguration(value *protocol.TransparentProxyConfiguration) *protocol.TransparentProxyConfiguration {
	if value == nil {
		return nil
	}
	clone := *value
	clone.Exclusions = append([]protocol.TransparentProxyExclusion(nil), value.Exclusions...)
	return &clone
}

func (state *State) Close() error {
	var closeErrors []error
	if state.diagnosticsLogger != nil {
		state.diagnosticsLogger.CloseOperationStream()
	}
	if state.liveTunnelSession != nil {
		if err := state.liveTunnelSession.Close(); err != nil {
			closeErrors = append(closeErrors, err)
		}
		state.liveTunnelSession = nil
		state.bootstrapTunnel = nil
	}
	if state.bootstrapTunnel != nil {
		if err := state.bootstrapTunnel.Close(); err != nil {
			closeErrors = append(closeErrors, err)
		}
		state.bootstrapTunnel = nil
	}
	state.supervisorHandle.MarkComponentStopped(supervision.ComponentTunnelSession)
	if state.runtimeCoordination != nil {
		state.runtimeCoordination.Close()
		state.runtimeCoordination = nil
	}
	if state.readinessProjection != nil {
		state.readinessProjection.Close()
		state.readinessProjection = nil
	}
	if state.runtimeAdapters != nil {
		state.runtimeAdapters.Close()
		state.runtimeAdapters = nil
	}
	if state.processManager != nil {
		if err := state.processManager.Stop(timeutil.SystemClock{}, timeutil.ThreadSleeper{}); err != nil {
			closeErrors = append(closeErrors, err)
		}
		state.processManager = nil
	}
	if state.egressProxy != nil {
		if err := state.egressProxy.Close(); err != nil {
			closeErrors = append(closeErrors, err)
		}
		state.egressProxy = nil
	}
	if state.platformScopeInput != nil {
		if err := cgroups.KillSandboxUserScopes(state.platformScopeInput.CgroupRoot, state.sandboxInstanceID); err != nil {
			closeErrors = append(closeErrors, err)
		}
		if err := cgroups.KillSandboxPlatformScopes(state.platformScopeInput.CgroupRoot, state.sandboxInstanceID); err != nil {
			closeErrors = append(closeErrors, err)
		}
	}
	if state.executionMode == ExecutionModeSnapshot {
		if err := ScrubSnapshotRuntimeArtifacts(); err != nil {
			closeErrors = append(closeErrors, err)
		}
	}
	if len(closeErrors) > 0 {
		return fmt.Errorf("failed to close sandboxd state: %w", closeErrors[0])
	}
	return nil
}

func (state *State) startLiveTunnelSession(clock timeutil.Clock, sessionInput protocol.SessionRuntimeInput) error {
	if state.bootstrapTunnel == nil {
		return fmt.Errorf("bootstrap tunnel session is not initialized")
	}
	agentEndpointURL := ""
	if state.runtimeAdapters != nil {
		resolvedAgentEndpointURL, err := state.runtimeAdapters.AgentEndpointURL()
		if err != nil {
			return err
		}
		agentEndpointURL = resolvedAgentEndpointURL
	}
	operationID, err := tunnel.DeriveOperationID(sessionInput.TunnelGatewayWSURL)
	if err != nil {
		return err
	}
	liveTunnelSession, err := tunnel.StartLiveTunnelSession(state.bootstrapTunnel, tunnel.LiveTunnelSessionOptions{
		AgentEndpointURL:        agentEndpointURL,
		RuntimeEnv:              state.runtimeEnv,
		CgroupRoot:              state.platformScopeRoot(),
		OperationID:             operationID,
		OperationKind:           string(sessionInput.OperationKind),
		GatewayWSURL:            sessionInput.TunnelGatewayWSURL,
		TunnelExchangeToken:     sessionInput.TunnelExchangeToken,
		Clock:                   clock,
		KeepaliveManager:        state.keepaliveManager,
		RuntimeReadinessManager: state.runtimeReadiness,
		SupervisorHandle:        state.supervisorHandle,
	})
	if err != nil {
		return fmt.Errorf("failed to start live tunnel session: %w", err)
	}
	state.liveTunnelSession = liveTunnelSession
	return nil
}

func (state *State) platformScopeRoot() string {
	if state.platformScopeInput == nil {
		return ""
	}
	return state.platformScopeInput.CgroupRoot
}

func (state *State) startRuntimeReadinessProjection(trackedComponents []supervision.SupervisedComponent) {
	mode := DetermineRuntimeReadinessMode(trackedComponents)
	SyncRuntimeReadinessFromSnapshot(state.supervisorHandle, state.runtimeReadiness, mode)
	state.readinessProjection = SpawnRuntimeReadinessProjection(
		state.supervisorHandle,
		state.runtimeReadiness,
		mode,
		timeutil.ThreadSleeper{},
	)
}

func (state *State) startEgressProxy(
	runtimePlan runtime.CompiledRuntimePlan,
	sessionInput protocol.SessionRuntimeInput,
	clock timeutil.Clock,
) (map[string]string, error) {
	if !egressproxy.RequiresManagedProxy(runtimePlan, sessionInput) {
		return nil, nil
	}
	if err := RecordOperationPhaseStartedWithAttributes(
		state.diagnosticsLogger,
		clock,
		"start_egress_proxy",
		TimelineAttributes("egress-proxy", "Starting egress proxy"),
	); err != nil {
		return nil, err
	}
	if state.liveTunnelSession == nil {
		_ = RecordOperationPhaseFailure(
			state.diagnosticsLogger,
			clock,
			"start_egress_proxy",
			map[string]any{"error": "bootstrap tunnel session is required before starting local egress proxy"},
		)
		return nil, fmt.Errorf("bootstrap tunnel session is required before starting local egress proxy")
	}
	tokenProvider, err := state.egressTokenProviderForSession(sessionInput)
	if err != nil {
		return nil, err
	}
	egressProxy, err := egressproxy.StartManagedProxy(
		runtimePlan,
		sessionInput,
		tokenProvider,
		clock,
		state.supervisorHandle,
		state.egressProxyOptions,
	)
	if err != nil {
		_ = RecordOperationPhaseFailure(
			state.diagnosticsLogger,
			clock,
			"start_egress_proxy",
			map[string]any{"error": err.Error()},
		)
		return nil, fmt.Errorf("failed to start local egress proxy: %w", err)
	}
	state.egressProxy = egressProxy
	if err := RecordOperationPhaseCompletedWithAttributes(
		state.diagnosticsLogger,
		clock,
		"start_egress_proxy",
		TimelineAttributes("egress-proxy", "Starting egress proxy"),
	); err != nil {
		return nil, err
	}
	if egressProxy == nil {
		return nil, nil
	}
	return egressProxy.RuntimeEnvironment(), nil
}

func (state *State) egressTokenProviderForSession(sessionInput protocol.SessionRuntimeInput) (tunnel.LiveTunnelEgressTokenProvider, error) {
	if state.egressTokenProvider == nil {
		provider := state.liveTunnelSession.EgressTokenProvider(sessionInput.ActingUserID)
		state.egressTokenProvider = &provider
		return provider, nil
	}
	if err := state.egressTokenProvider.AttachSession(state.liveTunnelSession); err != nil {
		return tunnel.LiveTunnelEgressTokenProvider{}, err
	}
	if err := state.egressTokenProvider.SetActingUserID(sessionInput.ActingUserID); err != nil {
		return tunnel.LiveTunnelEgressTokenProvider{}, err
	}
	return *state.egressTokenProvider, nil
}

func (state *State) startRuntimeCoordination(clock timeutil.Clock) {
	if state.processManager == nil || state.runtimeAdapters == nil {
		return
	}
	handles := RuntimeCoordinationHandles{
		CodexAppServerControlHandle: state.processManager.CodexAppServerControlHandle(),
		CodexProxyControlHandle:     state.runtimeAdapters.CodexProxyControlHandle(),
		OpenCodeServerControlHandle: state.processManager.OpenCodeServerControlHandle(),
	}
	if !handles.HasRuntimeProcessControl() {
		return
	}
	state.runtimeCoordination = StartRuntimeCoordination(handles, state.supervisorHandle, clock, timeutil.ThreadSleeper{})
}

func (state *State) startRuntimeSupport(runtimePlan runtime.CompiledRuntimePlan, clock timeutil.Clock) error {
	options := state.runtimeAdapterOptions
	if state.platformScopeInput != nil {
		options.PlatformScopeInput = &RuntimeAdapterPlatformScopeInput{
			CgroupRoot:        state.platformScopeInput.CgroupRoot,
			SandboxInstanceID: state.platformScopeInput.SandboxInstanceID,
			Registry:          state.platformScopeInput.Registry,
		}
	}
	runtimeAdapters, err := StartRuntimeAdaptersWithObserver(
		runtimePlan,
		state.supervisorHandle,
		state.keepaliveManager,
		options,
		RuntimeAdapterTimelineObserver{Logger: state.diagnosticsLogger, Clock: clock},
	)
	if err != nil {
		return err
	}
	state.runtimeAdapters = runtimeAdapters
	if state.liveTunnelSession != nil {
		agentEndpointURL, err := runtimeAdapters.AgentEndpointURL()
		if err != nil {
			runtimeAdapters.Close()
			state.runtimeAdapters = nil
			return err
		}
		state.liveTunnelSession.SetAgentEndpointURL(agentEndpointURL)
	}
	return nil
}

func (state *State) finishSnapshotActivation(clock timeutil.Clock) error {
	if err := RecordOperationPhaseStarted(state.diagnosticsLogger, clock, "stop_egress_proxy"); err != nil {
		return err
	}
	if state.egressProxy != nil {
		if err := state.egressProxy.Close(); err != nil {
			_ = RecordOperationPhaseFailure(
				state.diagnosticsLogger,
				clock,
				"stop_egress_proxy",
				map[string]any{"error": err.Error()},
			)
			return fmt.Errorf("failed to stop local egress proxy: %w", err)
		}
		state.egressProxy = nil
	}
	if err := RecordOperationPhaseCompleted(state.diagnosticsLogger, clock, "stop_egress_proxy"); err != nil {
		return err
	}
	if state.diagnosticsLogger != nil {
		state.diagnosticsLogger.CloseOperationStream()
	}
	if state.liveTunnelSession != nil {
		if err := state.liveTunnelSession.Close(); err != nil {
			return err
		}
		state.liveTunnelSession = nil
		state.bootstrapTunnel = nil
	}
	if state.bootstrapTunnel != nil {
		if err := state.bootstrapTunnel.Close(); err != nil {
			return err
		}
		state.bootstrapTunnel = nil
	}
	state.supervisorHandle.MarkComponentStopped(supervision.ComponentTunnelSession)
	if state.readinessProjection != nil {
		state.readinessProjection.Close()
		state.readinessProjection = nil
	}
	if err := ScrubSnapshotRuntimeArtifacts(); err != nil {
		return err
	}
	return nil
}

func platformScopeInputForActivation(options ActivationOptions, sandboxInstanceID string) *process.PlatformProcessScopeInput {
	if options.PlatformScopeRoot == "" {
		return nil
	}
	return &process.PlatformProcessScopeInput{
		CgroupRoot:        options.PlatformScopeRoot,
		SandboxInstanceID: sandboxInstanceID,
		Registry:          options.PlatformRegistry,
	}
}

func (state *State) closeStartedRuntimeSupport(clock timeutil.Clock) {
	if state.diagnosticsLogger != nil {
		state.diagnosticsLogger.CloseOperationStream()
	}
	if state.liveTunnelSession != nil {
		_ = state.liveTunnelSession.Close()
		state.liveTunnelSession = nil
		state.bootstrapTunnel = nil
	}
	if state.runtimeCoordination != nil {
		state.runtimeCoordination.Close()
		state.runtimeCoordination = nil
	}
	if state.readinessProjection != nil {
		state.readinessProjection.Close()
		state.readinessProjection = nil
	}
	if state.runtimeAdapters != nil {
		state.runtimeAdapters.Close()
		state.runtimeAdapters = nil
	}
	if state.processManager != nil {
		_ = state.processManager.Stop(clock, timeutil.ThreadSleeper{})
		state.processManager = nil
	}
	if state.egressProxy != nil {
		_ = state.egressProxy.Close()
		state.egressProxy = nil
	}
}

func connectBootstrapTunnel(
	sessionInput protocol.SessionRuntimeInput,
	supervisorHandle *supervision.SandboxdSupervisorHandle,
) (*tunnel.BootstrapTunnel, error) {
	supervisorHandle.ReplaceComponentDetails(
		supervision.ComponentTunnelSession,
		map[string]string{"gatewayWsUrl": sessionInput.TunnelGatewayWSURL},
	)
	supervisorHandle.MarkComponentStarting(supervision.ComponentTunnelSession)
	ctx, cancel := context.WithTimeout(context.Background(), DefaultBootstrapTunnelConnectTimeout)
	defer cancel()
	bootstrapTunnel, err := tunnel.ConnectBootstrapTunnel(ctx, sessionInput.TunnelGatewayWSURL, sessionInput.BootstrapToken)
	if err != nil {
		supervisorHandle.MarkComponentRestarting(supervision.ComponentTunnelSession, err.Error())
		return nil, fmt.Errorf("failed to start bootstrap tunnel session: %w", err)
	}
	supervisorHandle.MarkComponentHealthy(supervision.ComponentTunnelSession)
	return bootstrapTunnel, nil
}

func executionModeForActivation(operationKind protocol.ActivationOperationKind) ExecutionMode {
	if operationKind == protocol.ActivationOperationSnapshot {
		return ExecutionModeSnapshot
	}
	return ExecutionModeSession
}

func shouldApplyRuntimePlanForActivation(
	imageSource runtime.CompiledRuntimePlanImageSource,
	operationKind protocol.ActivationOperationKind,
) bool {
	if imageSource != runtime.CompiledRuntimePlanImageSnapshot {
		return true
	}
	return operationKind == protocol.ActivationOperationSetupCheck || operationKind == protocol.ActivationOperationSnapshot
}

func shouldStartRuntimeProcessesForActivation(operationKind protocol.ActivationOperationKind) bool {
	return operationKind != protocol.ActivationOperationSnapshot
}

func shouldStartRuntimeSupportForActivation(operationKind protocol.ActivationOperationKind) bool {
	return operationKind != protocol.ActivationOperationSnapshot
}

func shouldRunSetupScriptForActivation(
	imageSource runtime.CompiledRuntimePlanImageSource,
	operationKind protocol.ActivationOperationKind,
) bool {
	return shouldApplyRuntimePlanForActivation(imageSource, operationKind)
}
