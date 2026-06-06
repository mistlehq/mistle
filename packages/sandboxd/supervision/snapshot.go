package supervision

import (
	"encoding/json"
	"time"

	"github.com/mistle/sandboxd/timeutil"
)

const DaemonLivenessJournalErrorDetail = "lastJournalError"

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

func (snapshot HealthSnapshot) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		ObservedAt string                    `json:"observed_at"`
		Components []ComponentHealthSnapshot `json:"components"`
	}{
		ObservedAt: timeutil.FormatRFC3339Timestamp(snapshot.ObservedAt),
		Components: snapshot.Components,
	})
}

func (snapshot ComponentHealthSnapshot) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		Component         string            `json:"component"`
		State             string            `json:"state"`
		RestartCount      uint64            `json:"restart_count"`
		LastStartedAt     *string           `json:"last_started_at"`
		LastFailedAt      *string           `json:"last_failed_at"`
		LastHealthcheckAt *string           `json:"last_healthcheck_at"`
		LastError         *string           `json:"last_error"`
		Details           map[string]string `json:"details"`
	}{
		Component:         componentProtocolName(snapshot.Component),
		State:             componentStateProtocolName(snapshot.State),
		RestartCount:      snapshot.RestartCount,
		LastStartedAt:     optionalTimestamp(snapshot.LastStartedAt),
		LastFailedAt:      optionalTimestamp(snapshot.LastFailedAt),
		LastHealthcheckAt: optionalTimestamp(snapshot.LastHealthcheckAt),
		LastError:         snapshot.LastError,
		Details:           snapshot.Details,
	})
}

func optionalTimestamp(timestamp *time.Time) *string {
	if timestamp == nil {
		return nil
	}
	formatted := timeutil.FormatRFC3339Timestamp(*timestamp)
	return &formatted
}

func componentProtocolName(component SupervisedComponent) string {
	switch component {
	case ComponentSandboxd:
		return "sandboxd"
	case ComponentTunnelSession:
		return "tunnel_session"
	case ComponentEgressProxy:
		return "egress_proxy"
	case ComponentCodexProxy:
		return "codex_proxy"
	case ComponentCodexAppServer:
		return "codex_app_server"
	case ComponentOpenCodeProxy:
		return "opencode_proxy"
	case ComponentOpenCodeServer:
		return "opencode_server"
	case ComponentOpenCodeProxyConnectivity:
		return "opencode_proxy_connectivity"
	case ComponentPiProxy:
		return "pi_proxy"
	case ComponentPiRpcProcess:
		return "pi_rpc_process"
	case ComponentPiProxyConnectivity:
		return "pi_proxy_connectivity"
	case ComponentRuntimeAgentEndpoint:
		return "runtime_agent_endpoint"
	default:
		return string(component)
	}
}

func componentStateProtocolName(state ComponentHealthState) string {
	switch state {
	case ComponentStarting:
		return "starting"
	case ComponentHealthy:
		return "healthy"
	case ComponentRestarting:
		return "restarting"
	case ComponentStopped:
		return "stopped"
	default:
		return string(state)
	}
}
