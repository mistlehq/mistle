package process

import (
	"fmt"
	"sync"

	"github.com/mistle/sandboxd/cgroups"
)

type PlatformProcessScopeInput struct {
	CgroupRoot        string
	SandboxInstanceID string
	Registry          *PlatformProcessRegistry
}

type PlatformProcessRegistry struct {
	mutex  sync.Mutex
	scopes map[string]PlatformProcessScopeSnapshot
}

type PlatformProcessScopeSnapshot struct {
	ProcessKey        string
	ScopePaths        cgroups.ScopePaths
	SupervisedRootPID uint32
}

type runtimeClientProcessPlatformScope struct {
	registryKey string
	processKey  string
	scopePaths  cgroups.ScopePaths
	registry    *PlatformProcessRegistry
}

func (registry *PlatformProcessRegistry) ReplaceScope(
	registryKey string,
	processKey string,
	scopePaths cgroups.ScopePaths,
	supervisedRootPID uint32,
) error {
	if registry == nil {
		return fmt.Errorf("platform process registry is required")
	}
	registry.mutex.Lock()
	defer registry.mutex.Unlock()
	registry.ensureScopes()
	registry.scopes[registryKey] = PlatformProcessScopeSnapshot{
		ProcessKey:        processKey,
		ScopePaths:        scopePaths,
		SupervisedRootPID: supervisedRootPID,
	}
	return nil
}

func (registry *PlatformProcessRegistry) UpdateSupervisedRootPID(registryKey string, supervisedRootPID uint32) error {
	if registry == nil {
		return fmt.Errorf("platform process registry is required")
	}
	registry.mutex.Lock()
	defer registry.mutex.Unlock()
	registry.ensureScopes()
	snapshot, ok := registry.scopes[registryKey]
	if !ok {
		return nil
	}
	snapshot.SupervisedRootPID = supervisedRootPID
	registry.scopes[registryKey] = snapshot
	return nil
}

func (registry *PlatformProcessRegistry) RemoveScope(registryKey string) error {
	if registry == nil {
		return fmt.Errorf("platform process registry is required")
	}
	registry.mutex.Lock()
	defer registry.mutex.Unlock()
	registry.ensureScopes()
	delete(registry.scopes, registryKey)
	return nil
}

func (registry *PlatformProcessRegistry) Snapshots() ([]PlatformProcessScopeSnapshot, error) {
	if registry == nil {
		return nil, fmt.Errorf("platform process registry is required")
	}
	registry.mutex.Lock()
	defer registry.mutex.Unlock()
	registry.ensureScopes()
	snapshots := make([]PlatformProcessScopeSnapshot, 0, len(registry.scopes))
	for _, snapshot := range registry.scopes {
		snapshots = append(snapshots, snapshot)
	}
	return snapshots, nil
}

func (registry *PlatformProcessRegistry) ensureScopes() {
	if registry.scopes == nil {
		registry.scopes = map[string]PlatformProcessScopeSnapshot{}
	}
}

func createRuntimeClientProcessPlatformScope(
	processIndex int,
	processSpec RuntimeClientProcessSpec,
	input PlatformProcessScopeInput,
) (*runtimeClientProcessPlatformScope, error) {
	if input.Registry == nil {
		return nil, fmt.Errorf("platform process registry is required")
	}
	scopeID := fmt.Sprintf("runtime-%d", processIndex)
	scopePaths, err := cgroups.CreatePlatformScope(input.CgroupRoot, input.SandboxInstanceID, scopeID)
	if err != nil {
		return nil, err
	}
	return &runtimeClientProcessPlatformScope{
		registryKey: scopeID,
		processKey:  processSpec.ProcessKey,
		scopePaths:  scopePaths,
		registry:    input.Registry,
	}, nil
}

func attachRuntimeClientProcessPlatformScope(
	platformScope *runtimeClientProcessPlatformScope,
	process *RunningRuntimeClientProcess,
) error {
	if platformScope == nil {
		return nil
	}
	processID := process.PID()
	if err := cgroups.AttachPIDToScope(platformScope.scopePaths, processID); err != nil {
		return err
	}
	return platformScope.registry.ReplaceScope(
		platformScope.registryKey,
		platformScope.processKey,
		platformScope.scopePaths,
		processID,
	)
}

func updateRuntimeClientProcessPlatformScope(
	platformScope *runtimeClientProcessPlatformScope,
	process *RunningRuntimeClientProcess,
) error {
	if platformScope == nil {
		return nil
	}
	processID := process.PID()
	if err := cgroups.AttachPIDToScope(platformScope.scopePaths, processID); err != nil {
		return err
	}
	return platformScope.registry.UpdateSupervisedRootPID(platformScope.registryKey, processID)
}

func killRuntimeClientProcessPlatformScope(platformScope *runtimeClientProcessPlatformScope) error {
	if platformScope == nil {
		return nil
	}
	if err := cgroups.KillScope(platformScope.scopePaths); err != nil {
		return err
	}
	return platformScope.registry.RemoveScope(platformScope.registryKey)
}
