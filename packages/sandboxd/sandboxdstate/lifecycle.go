package sandboxdstate

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/mistle/sandboxd/protocol"
	"github.com/mistle/sandboxd/runtime"
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
	sandboxInstanceID string
	executionMode     ExecutionMode
	runtimeEnv        map[string]string
	supervisorHandle  *supervision.SandboxdSupervisorHandle
	bootstrapTunnel   *tunnel.BootstrapTunnel
}

func ActivateNew(activationInput protocol.ActivationInput, clock timeutil.Clock) (*State, error) {
	if clock == nil {
		return nil, fmt.Errorf("sandboxd state clock is required")
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
	supervisorHandle, err := supervision.NewSandboxdSupervisorHandle(
		sandboxInstanceID,
		clock,
		CollectTrackedComponents(runtimePlan),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to start runtime processes: %w", err)
	}
	runtimeEnv, err := CollectRuntimeEnvironment(runtimePlan)
	if err != nil {
		return nil, fmt.Errorf("failed to start runtime processes: %w", err)
	}
	mergedRuntimeEnv, err := MergeManagedRuntimeEnvironment(runtimeEnv, mistleContextEnv, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to start runtime processes: %w", err)
	}

	state := &State{
		sandboxInstanceID: sandboxInstanceID,
		executionMode:     executionModeForActivation(activationInput.OperationKind),
		runtimeEnv:        mergedRuntimeEnv,
		supervisorHandle:  supervisorHandle,
	}
	if shouldApplyRuntimePlanForActivation(runtimePlan.Image.Source, activationInput.OperationKind) {
		if err := runtime.ApplyCompiledRuntimePlan(runtimePlan); err != nil {
			return nil, fmt.Errorf("failed to apply runtime plan: %w", err)
		}
		bootstrapTunnel, err := connectBootstrapTunnel(sessionInput, supervisorHandle)
		if err != nil {
			return nil, err
		}
		state.bootstrapTunnel = bootstrapTunnel
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
	if state.bootstrapTunnel == nil {
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
	if err := state.bootstrapTunnel.SendText(ctx, payload); err != nil {
		return "", err
	}
	responsePayload, err := state.bootstrapTunnel.ReadText(ctx)
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

func (state *State) Close() error {
	if state.bootstrapTunnel != nil {
		if err := state.bootstrapTunnel.Close(); err != nil {
			return err
		}
		state.bootstrapTunnel = nil
	}
	state.supervisorHandle.MarkComponentStopped(supervision.ComponentTunnelSession)
	return nil
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
