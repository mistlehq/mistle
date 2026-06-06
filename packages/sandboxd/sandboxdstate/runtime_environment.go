package sandboxdstate

import (
	"encoding/json"
	"fmt"

	"github.com/mistle/sandboxd/egressproxy"
	"github.com/mistle/sandboxd/protocol"
	"github.com/mistle/sandboxd/runtime"
)

const (
	GlobalGitConfigEnvName             = "GIT_CONFIG_GLOBAL"
	DefaultGlobalGitConfigPath         = "/run/mistle/gitconfig"
	MistleSandboxInstanceIDEnvName     = "MISTLE_SANDBOX_INSTANCE_ID"
	MistleSandboxProfileIDEnvName      = "MISTLE_SANDBOX_PROFILE_ID"
	MistleSandboxProfileVersionEnvName = "MISTLE_SANDBOX_PROFILE_VERSION"
)

func CollectRuntimeEnvironment(runtimePlan runtime.CompiledRuntimePlan) (map[string]string, error) {
	runtimeEnv := make(map[string]string)
	for _, artifact := range runtimePlan.Artifacts {
		for name, value := range artifact.Env {
			existingValue, exists := runtimeEnv[name]
			if exists && existingValue != value {
				return nil, fmt.Errorf("runtime plan artifacts define conflicting values for env %q", name)
			}
			runtimeEnv[name] = value
		}
	}
	return runtimeEnv, nil
}

func MergeManagedRuntimeEnvironment(
	runtimeEnv map[string]string,
	mistleContextEnv map[string]string,
	egressProxyEnv map[string]string,
) (map[string]string, error) {
	mergedEnv := cloneStringMap(runtimeEnv)
	for name, value := range mistleContextEnv {
		if err := insertManagedRuntimeEnvironment(mergedEnv, name, value); err != nil {
			return nil, err
		}
	}
	if err := insertManagedRuntimeEnvironment(mergedEnv, GlobalGitConfigEnvName, DefaultGlobalGitConfigPath); err != nil {
		return nil, err
	}
	for name, value := range egressProxyEnv {
		if err := insertManagedRuntimeEnvironment(mergedEnv, name, value); err != nil {
			return nil, err
		}
	}
	return mergedEnv, nil
}

func MergeManagedRuntimeEnvironmentFromProxy(
	runtimeEnv map[string]string,
	mistleContextEnv map[string]string,
	caCertificatePath string,
) (map[string]string, error) {
	return MergeManagedRuntimeEnvironment(runtimeEnv, mistleContextEnv, egressproxy.BuildManagedProxyEnv(caCertificatePath))
}

func CollectMistleContextRuntimeEnvironment(sessionInput protocol.SessionRuntimeInput, sandboxInstanceID string) (map[string]string, error) {
	var rawRuntimePlan struct {
		SandboxProfileID *string `json:"sandboxProfileId"`
		Version          *uint64 `json:"version"`
	}
	if err := json.Unmarshal(sessionInput.RuntimePlan, &rawRuntimePlan); err != nil {
		return nil, fmt.Errorf("runtime plan is invalid for managed env: %w", err)
	}
	if rawRuntimePlan.SandboxProfileID == nil || *rawRuntimePlan.SandboxProfileID == "" {
		return nil, fmt.Errorf("runtime plan sandboxProfileId is required for managed env")
	}
	if rawRuntimePlan.Version == nil {
		return nil, fmt.Errorf("runtime plan version is required for managed env")
	}
	return map[string]string{
		MistleSandboxInstanceIDEnvName:     sandboxInstanceID,
		MistleSandboxProfileIDEnvName:      *rawRuntimePlan.SandboxProfileID,
		MistleSandboxProfileVersionEnvName: fmt.Sprint(*rawRuntimePlan.Version),
	}, nil
}

func insertManagedRuntimeEnvironment(runtimeEnv map[string]string, name string, value string) error {
	existingValue, exists := runtimeEnv[name]
	if exists && existingValue != value {
		return fmt.Errorf("runtime plan artifacts define managed env %q, which sandboxd reserves", name)
	}
	runtimeEnv[name] = value
	return nil
}

func cloneStringMap(source map[string]string) map[string]string {
	target := make(map[string]string, len(source))
	for key, value := range source {
		target[key] = value
	}
	return target
}
