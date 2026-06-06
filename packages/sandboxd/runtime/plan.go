package runtime

type CompiledRuntimePlan struct {
	SandboxProfileID string                    `json:"sandboxProfileId"`
	Version          uint32                    `json:"version"`
	Image            CompiledRuntimePlanImage  `json:"image"`
	SetupScript      *string                   `json:"setupScript"`
	EgressRoutes     []any                     `json:"egressRoutes"`
	Artifacts        []CompiledRuntimeArtifact `json:"artifacts"`
	RuntimeClients   []any                     `json:"runtimeClients"`
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
