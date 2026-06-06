package runtime

import "encoding/json"

type CompiledRuntimePlan struct {
	SandboxProfileID string                    `json:"sandboxProfileId"`
	Version          uint32                    `json:"version"`
	Image            CompiledRuntimePlanImage  `json:"image"`
	SetupScript      *string                   `json:"setupScript"`
	EgressRoutes     []any                     `json:"egressRoutes"`
	Artifacts        []CompiledRuntimeArtifact `json:"artifacts"`
	RuntimeClients   []RuntimeClient           `json:"runtimeClients"`
	AgentRuntimes    []CompiledAgentRuntime    `json:"agentRuntimes"`
}

type CompiledRuntimePlanImage struct {
	Source   CompiledRuntimePlanImageSource `json:"source"`
	ImageRef string                         `json:"imageRef"`
}

type CompiledRuntimePlanImageSource string

const (
	CompiledRuntimePlanImageProfileBase CompiledRuntimePlanImageSource = "profile_base"
	CompiledRuntimePlanImageBase        CompiledRuntimePlanImageSource = "base"
	CompiledRuntimePlanImageSnapshot    CompiledRuntimePlanImageSource = "snapshot"
)

type CompiledRuntimeArtifact struct {
	ArtifactKey string            `json:"artifactKey"`
	Name        string            `json:"name"`
	Env         map[string]string `json:"env"`
}

type RuntimeClientProcessReadinessType string

const (
	RuntimeClientProcessReadinessNone RuntimeClientProcessReadinessType = "none"
	RuntimeClientProcessReadinessHTTP RuntimeClientProcessReadinessType = "http"
	RuntimeClientProcessReadinessWS   RuntimeClientProcessReadinessType = "ws"
	RuntimeClientProcessReadinessTCP  RuntimeClientProcessReadinessType = "tcp"
)

type RuntimeClientProcessReadiness struct {
	Type           RuntimeClientProcessReadinessType
	URL            string
	Host           string
	Port           uint16
	ExpectedStatus uint16
	TimeoutMS      uint64
}

type RuntimeExecCommand struct {
	Args      []string
	Env       map[string]string
	CWD       *string
	TimeoutMS *uint64
}

type RuntimeClientSetup struct {
	Env        map[string]string        `json:"env"`
	Files      []RuntimeClientSetupFile `json:"files"`
	LaunchArgs []string                 `json:"launchArgs"`
}

type RuntimeClientSetupFile struct {
	FileID    string                `json:"fileId"`
	Path      string                `json:"path"`
	Mode      uint32                `json:"mode"`
	Content   string                `json:"content"`
	WriteMode *RuntimeFileWriteMode `json:"writeMode"`
}

type RuntimeFileWriteMode string

const (
	RuntimeFileWriteModeOverwrite RuntimeFileWriteMode = "overwrite"
	RuntimeFileWriteModeIfAbsent  RuntimeFileWriteMode = "if-absent"
	RuntimeFileWriteModeMerge     RuntimeFileWriteMode = "merge"
)

type RuntimeClient struct {
	ClientID  string                 `json:"clientId"`
	Setup     RuntimeClientSetup     `json:"setup"`
	Processes []RuntimeClientProcess `json:"processes"`
}

type RuntimeClientProcess struct {
	ProcessKey string
	Command    RuntimeExecCommand
	Readiness  RuntimeClientProcessReadiness
	Stop       RuntimeClientProcessStopPolicy
}

type RuntimeClientProcessStopPolicy struct {
	Signal        RuntimeClientProcessStopSignal
	TimeoutMS     uint64
	GracePeriodMS *uint64
}

type RuntimeClientProcessStopSignal string

const (
	RuntimeClientProcessStopSignalSIGTERM RuntimeClientProcessStopSignal = "SIGTERM"
	RuntimeClientProcessStopSignalSIGINT  RuntimeClientProcessStopSignal = "SIGINT"
	RuntimeClientProcessStopSignalSIGKILL RuntimeClientProcessStopSignal = "SIGKILL"
)

type CompiledAgentRuntime struct {
	RuntimeID   string          `json:"runtimeId"`
	RuntimeKey  string          `json:"runtimeKey"`
	ClientID    string          `json:"clientId"`
	EndpointKey string          `json:"endpointKey"`
	PTYLaunch   json.RawMessage `json:"ptyLaunch"`
}
