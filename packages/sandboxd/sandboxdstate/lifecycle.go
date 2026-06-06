package sandboxdstate

import (
	"encoding/json"
	"fmt"

	"github.com/mistle/sandboxd/protocol"
	"github.com/mistle/sandboxd/runtime"
	"github.com/mistle/sandboxd/supervision"
	"github.com/mistle/sandboxd/timeutil"
	"github.com/mistle/sandboxd/tunnel"
)

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
		return nil, fmt.Errorf("failed to start bootstrap tunnel session: bootstrap tunnel session is not migrated to Go")
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

func (state *State) Close() error {
	return nil
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
