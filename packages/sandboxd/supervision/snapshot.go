package supervision

import "time"

type SupervisedComponent string

const (
	ComponentSandboxd                  SupervisedComponent = "Sandboxd"
	ComponentTunnelSession             SupervisedComponent = "TunnelSession"
	ComponentEgressProxy               SupervisedComponent = "EgressProxy"
	ComponentCodexProxy                SupervisedComponent = "CodexProxy"
	ComponentCodexAppServer            SupervisedComponent = "CodexAppServer"
	ComponentOpenCodeProxy             SupervisedComponent = "OpenCodeProxy"
	ComponentOpenCodeServer            SupervisedComponent = "OpenCodeServer"
	ComponentOpenCodeProxyConnectivity SupervisedComponent = "OpenCodeProxyConnectivity"
	ComponentPiProxy                   SupervisedComponent = "PiProxy"
	ComponentPiRpcProcess              SupervisedComponent = "PiRpcProcess"
	ComponentPiProxyConnectivity       SupervisedComponent = "PiProxyConnectivity"
	ComponentRuntimeAgentEndpoint      SupervisedComponent = "RuntimeAgentEndpoint"
)

type ComponentHealthState string

const (
	ComponentStarting   ComponentHealthState = "Starting"
	ComponentHealthy    ComponentHealthState = "Healthy"
	ComponentRestarting ComponentHealthState = "Restarting"
	ComponentStopped    ComponentHealthState = "Stopped"
)

type HealthSnapshot struct {
	ObservedAt time.Time
	Components []ComponentHealthSnapshot
}

type ComponentHealthSnapshot struct {
	Component         SupervisedComponent
	State             ComponentHealthState
	RestartCount      uint64
	LastStartedAt     *time.Time
	LastFailedAt      *time.Time
	LastHealthcheckAt *time.Time
	LastError         *string
	Details           map[string]string
}
