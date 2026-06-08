package runtime

import (
	"bytes"
	"encoding/json"
	"fmt"
)

type CompiledRuntimePlan struct {
	SandboxProfileID string                     `json:"sandboxProfileId"`
	Version          uint32                     `json:"version"`
	Image            CompiledRuntimePlanImage   `json:"image"`
	SetupScript      *string                    `json:"setupScript"`
	EgressRoutes     []CompiledEgressRoute      `json:"egressRoutes"`
	Artifacts        []CompiledRuntimeArtifact  `json:"artifacts"`
	WorkspaceSources []CompiledWorkspaceSource  `json:"workspaceSources"`
	Skills           *CompiledRuntimePlanSkills `json:"skills,omitempty"`
	RuntimeClients   []RuntimeClient            `json:"runtimeClients"`
	AgentRuntimes    []CompiledAgentRuntime     `json:"agentRuntimes"`
}

func (plan *CompiledRuntimePlan) UnmarshalJSON(payload []byte) error {
	type wireCompiledRuntimePlan CompiledRuntimePlan
	var wire wireCompiledRuntimePlan
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&wire); err != nil {
		return err
	}
	*plan = CompiledRuntimePlan(wire)
	return plan.validate()
}

func (plan *CompiledRuntimePlan) validate() error {
	switch plan.Image.Source {
	case CompiledRuntimePlanImageProfileBase, CompiledRuntimePlanImageBase, CompiledRuntimePlanImageSnapshot:
	case "":
		return fmt.Errorf("runtime plan image source is required")
	default:
		return fmt.Errorf("unsupported runtime plan image source %q", plan.Image.Source)
	}
	for _, route := range plan.EgressRoutes {
		if err := validateCredentialResolver(route.CredentialResolver); err != nil {
			return err
		}
		for _, header := range route.AdditionalCredentialHeaders {
			if err := validateCredentialResolver(header.CredentialResolver); err != nil {
				return err
			}
		}
	}
	for _, artifact := range plan.Artifacts {
		for _, installStep := range artifact.Lifecycle.Install {
			if err := installStep.validate(); err != nil {
				return err
			}
		}
	}
	for _, source := range plan.WorkspaceSources {
		if source.SourceKind != WorkspaceSourceKindGitClone {
			return fmt.Errorf("unsupported workspace source kind %q", source.SourceKind)
		}
		if source.ResourceKind != WorkspaceSourceResourceKindRepository {
			return fmt.Errorf("unsupported workspace source resource kind %q", source.ResourceKind)
		}
	}
	for clientIndex := range plan.RuntimeClients {
		client := &plan.RuntimeClients[clientIndex]
		for _, file := range client.Setup.Files {
			if file.WriteMode != nil {
				switch *file.WriteMode {
				case RuntimeFileWriteModeOverwrite, RuntimeFileWriteModeIfAbsent, RuntimeFileWriteModeMerge:
				default:
					return fmt.Errorf("unsupported runtime file write mode %q", *file.WriteMode)
				}
			}
		}
		for processIndex := range client.Processes {
			process := &client.Processes[processIndex]
			switch process.Readiness.Type {
			case RuntimeClientProcessReadinessNone, RuntimeClientProcessReadinessHTTP, RuntimeClientProcessReadinessWS, RuntimeClientProcessReadinessTCP:
			case "":
				return fmt.Errorf("runtime process readiness type is required")
			default:
				return fmt.Errorf("unsupported runtime process readiness type %q", process.Readiness.Type)
			}
			switch process.Stop.Signal {
			case RuntimeClientProcessStopSignalSIGTERM, RuntimeClientProcessStopSignalSIGKILL:
			case "":
				return fmt.Errorf("runtime process stop signal is required")
			default:
				return fmt.Errorf("unsupported runtime process stop signal %q", process.Stop.Signal)
			}
		}
		for _, endpoint := range client.Endpoints {
			switch endpoint.ConnectionMode {
			case "dedicated", "shared":
			case "":
				return fmt.Errorf("runtime client endpoint connection mode is required")
			default:
				return fmt.Errorf("unsupported runtime client endpoint connection mode %q", endpoint.ConnectionMode)
			}
			switch endpoint.Transport.Type {
			case "ws":
			case "":
				return fmt.Errorf("runtime client endpoint transport type is required")
			default:
				return fmt.Errorf("unsupported runtime client endpoint transport type %q", endpoint.Transport.Type)
			}
		}
	}
	return nil
}

func validateCredentialResolver(resolver CompiledEgressRouteCredentialResolver) error {
	if resolver.Kind != "" {
		switch resolver.Kind {
		case CompiledEgressRouteCredentialResolverIntegrationConnection, CompiledEgressRouteCredentialResolverLinkedPrincipal, CompiledEgressRouteCredentialResolverMistleMCPToken, CompiledEgressRouteCredentialResolverMistleMCPSetupAssistantToken:
		default:
			return fmt.Errorf("unsupported egress credential resolver kind %q", resolver.Kind)
		}
	}
	if resolver.ResolutionMode != "" {
		switch resolver.ResolutionMode {
		case CompiledLinkedPrincipalEgressCredentialResolutionRequired, CompiledLinkedPrincipalEgressCredentialResolutionPreferred:
		default:
			return fmt.Errorf("unsupported linked principal credential resolution mode %q", resolver.ResolutionMode)
		}
	}
	return nil
}

func decodeObjectFields(payload []byte) (map[string]json.RawMessage, error) {
	fields := map[string]json.RawMessage{}
	if err := json.Unmarshal(payload, &fields); err != nil {
		return nil, err
	}
	return fields, nil
}

func requireJSONField(fields map[string]json.RawMessage, fieldName string, context string) error {
	if _, ok := fields[fieldName]; !ok {
		return fmt.Errorf("%s %s field is required", context, fieldName)
	}
	return nil
}

func requireNonEmptyJSONField(fields map[string]json.RawMessage, fieldName string, value string, context string) error {
	if _, ok := fields[fieldName]; !ok {
		return fmt.Errorf("%s %s field is required", context, fieldName)
	}
	if value == "" {
		return fmt.Errorf("%s %s field must be present and non-empty", context, fieldName)
	}
	return nil
}

func (step RuntimeArtifactInstallStep) validate() error {
	switch step.Op {
	case RuntimeArtifactInstallOpExec:
		if step.Repository != "" || step.InstallPath != "" || len(step.Tools) > 0 {
			return fmt.Errorf("exec artifact install steps must not include fields for other install operations")
		}
	case RuntimeArtifactInstallOpMiseInstall:
		if len(step.Tools) == 0 {
			return fmt.Errorf("mise_install artifact install steps must include at least one tool")
		}
		if step.Repository != "" || step.InstallPath != "" {
			return fmt.Errorf("mise_install artifact install steps must not include fields for other install operations")
		}
	case RuntimeArtifactInstallOpGitHubReleaseInstall:
		if step.Repository == "" {
			return fmt.Errorf("github_release_install artifact install steps must include repository")
		}
		if step.InstallPath == "" {
			return fmt.Errorf("github_release_install artifact install steps must include installPath")
		}
		if len(step.Tools) > 0 {
			return fmt.Errorf("github_release_install artifact install steps must not include tools")
		}
	default:
		return fmt.Errorf("unsupported artifact install op %q", step.Op)
	}
	return nil
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

type CompiledEgressRoute struct {
	EgressRuleID                string                                         `json:"egressRuleId"`
	BindingID                   string                                         `json:"bindingId"`
	FamilyID                    string                                         `json:"familyId"`
	VariantID                   string                                         `json:"variantId"`
	Match                       CompiledEgressRouteMatch                       `json:"match"`
	Upstream                    CompiledEgressRouteUpstream                    `json:"upstream"`
	AuthInjection               CompiledEgressRouteAuthInjection               `json:"authInjection"`
	AdditionalHeaders           map[string]string                              `json:"additionalHeaders"`
	AdditionalCredentialHeaders []CompiledEgressRouteCredentialHeaderInjection `json:"additionalCredentialHeaders"`
	CredentialResolver          CompiledEgressRouteCredentialResolver          `json:"credentialResolver"`
	RequestMiddleware           []string                                       `json:"requestMiddleware"`
}

func (route *CompiledEgressRoute) UnmarshalJSON(payload []byte) error {
	var wire struct {
		EgressRuleID                string                                         `json:"egressRuleId"`
		BindingID                   string                                         `json:"bindingId"`
		FamilyID                    string                                         `json:"familyId"`
		VariantID                   string                                         `json:"variantId"`
		Match                       CompiledEgressRouteMatch                       `json:"match"`
		Upstream                    CompiledEgressRouteUpstream                    `json:"upstream"`
		AuthInjection               CompiledEgressRouteAuthInjection               `json:"authInjection"`
		AdditionalHeaders           map[string]string                              `json:"additionalHeaders"`
		AdditionalCredentialHeaders []CompiledEgressRouteCredentialHeaderInjection `json:"additionalCredentialHeaders"`
		CredentialResolver          CompiledEgressRouteCredentialResolver          `json:"credentialResolver"`
		RequestMiddleware           []string                                       `json:"requestMiddleware"`
	}
	fields, err := decodeObjectFields(payload)
	if err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	if err := decoder.Decode(&wire); err != nil {
		return err
	}
	if err := requireJSONField(fields, "credentialResolver", "egress route"); err != nil {
		return err
	}
	*route = CompiledEgressRoute(wire)
	return nil
}

type CompiledEgressRouteMatch struct {
	Hosts        []string `json:"hosts"`
	PathPrefixes []string `json:"pathPrefixes"`
	Methods      []string `json:"methods"`
}

type CompiledEgressRouteUpstream struct {
	BaseURL string `json:"baseUrl"`
}

type CompiledEgressRouteAuthInjection struct {
	Type     CompiledEgressRouteAuthInjectionType `json:"type"`
	Target   *string                              `json:"target"`
	Username *string                              `json:"username"`
	Service  *string                              `json:"service"`
	Region   *string                              `json:"region"`
}

func (auth *CompiledEgressRouteAuthInjection) UnmarshalJSON(payload []byte) error {
	var wire struct {
		Type     CompiledEgressRouteAuthInjectionType `json:"type"`
		Target   *string                              `json:"target"`
		Username *string                              `json:"username"`
		Service  *string                              `json:"service"`
		Region   *string                              `json:"region"`
	}
	fields, err := decodeObjectFields(payload)
	if err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	if err := decoder.Decode(&wire); err != nil {
		return err
	}
	if err := requireJSONField(fields, "type", "egress auth injection"); err != nil {
		return err
	}
	switch wire.Type {
	case CompiledEgressRouteAuthInjectionBearer, CompiledEgressRouteAuthInjectionBasic, CompiledEgressRouteAuthInjectionHeader, CompiledEgressRouteAuthInjectionQuery, CompiledEgressRouteAuthInjectionAWSSigV4:
	default:
		return fmt.Errorf("unsupported egress auth injection type %q", wire.Type)
	}
	*auth = CompiledEgressRouteAuthInjection(wire)
	return nil
}

type CompiledEgressRouteAuthInjectionType string

const (
	CompiledEgressRouteAuthInjectionBearer   CompiledEgressRouteAuthInjectionType = "bearer"
	CompiledEgressRouteAuthInjectionBasic    CompiledEgressRouteAuthInjectionType = "basic"
	CompiledEgressRouteAuthInjectionHeader   CompiledEgressRouteAuthInjectionType = "header"
	CompiledEgressRouteAuthInjectionQuery    CompiledEgressRouteAuthInjectionType = "query"
	CompiledEgressRouteAuthInjectionAWSSigV4 CompiledEgressRouteAuthInjectionType = "aws_sigv4"
)

type CompiledEgressRouteCredentialHeaderInjection struct {
	Header             string                                `json:"header"`
	CredentialResolver CompiledEgressRouteCredentialResolver `json:"credentialResolver"`
}

func (header *CompiledEgressRouteCredentialHeaderInjection) UnmarshalJSON(payload []byte) error {
	var wire struct {
		Header             string                                `json:"header"`
		CredentialResolver CompiledEgressRouteCredentialResolver `json:"credentialResolver"`
	}
	fields, err := decodeObjectFields(payload)
	if err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	if err := decoder.Decode(&wire); err != nil {
		return err
	}
	if err := requireNonEmptyJSONField(fields, "header", wire.Header, "egress credential header"); err != nil {
		return err
	}
	if err := requireJSONField(fields, "credentialResolver", "egress credential header"); err != nil {
		return err
	}
	*header = CompiledEgressRouteCredentialHeaderInjection(wire)
	return nil
}

type CompiledEgressRouteCredentialResolver struct {
	Kind                    CompiledEgressRouteCredentialResolverKind             `json:"kind"`
	ConnectionID            string                                                `json:"connectionId"`
	SecretType              string                                                `json:"secretType"`
	SlotKey                 *string                                               `json:"slotKey"`
	ResolverKey             *string                                               `json:"resolverKey"`
	ProviderFamily          string                                                `json:"providerFamily"`
	IntegrationConnectionID string                                                `json:"integrationConnectionId"`
	CredentialKind          *string                                               `json:"credentialKind"`
	ActingUserRequired      bool                                                  `json:"actingUserRequired"`
	ResolutionMode          CompiledLinkedPrincipalEgressCredentialResolutionMode `json:"resolutionMode"`
	APIKeyID                string                                                `json:"apiKeyId"`
	SandboxProfileID        string                                                `json:"sandboxProfileId"`
	SandboxProfileVersion   uint32                                                `json:"sandboxProfileVersion"`
}

func (resolver *CompiledEgressRouteCredentialResolver) UnmarshalJSON(payload []byte) error {
	var wire struct {
		Kind                    CompiledEgressRouteCredentialResolverKind             `json:"kind"`
		ConnectionID            string                                                `json:"connectionId"`
		SecretType              string                                                `json:"secretType"`
		SlotKey                 *string                                               `json:"slotKey"`
		ResolverKey             *string                                               `json:"resolverKey"`
		ProviderFamily          string                                                `json:"providerFamily"`
		IntegrationConnectionID string                                                `json:"integrationConnectionId"`
		CredentialKind          *string                                               `json:"credentialKind"`
		ActingUserRequired      bool                                                  `json:"actingUserRequired"`
		ResolutionMode          CompiledLinkedPrincipalEgressCredentialResolutionMode `json:"resolutionMode"`
		APIKeyID                string                                                `json:"apiKeyId"`
		SandboxProfileID        string                                                `json:"sandboxProfileId"`
		SandboxProfileVersion   uint32                                                `json:"sandboxProfileVersion"`
	}
	fields, err := decodeObjectFields(payload)
	if err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	if err := decoder.Decode(&wire); err != nil {
		return err
	}
	if err := requireJSONField(fields, "kind", "egress credential resolver"); err != nil {
		return err
	}
	switch wire.Kind {
	case CompiledEgressRouteCredentialResolverIntegrationConnection:
		if err := requireNonEmptyJSONField(fields, "connectionId", wire.ConnectionID, "integration_connection egress credential resolver"); err != nil {
			return err
		}
		if err := requireNonEmptyJSONField(fields, "secretType", wire.SecretType, "integration_connection egress credential resolver"); err != nil {
			return err
		}
	case CompiledEgressRouteCredentialResolverLinkedPrincipal:
		if err := requireNonEmptyJSONField(fields, "providerFamily", wire.ProviderFamily, "linked_principal egress credential resolver"); err != nil {
			return err
		}
		if err := requireNonEmptyJSONField(fields, "integrationConnectionId", wire.IntegrationConnectionID, "linked_principal egress credential resolver"); err != nil {
			return err
		}
		if err := requireJSONField(fields, "actingUserRequired", "linked_principal egress credential resolver"); err != nil {
			return err
		}
		if err := requireJSONField(fields, "resolutionMode", "linked_principal egress credential resolver"); err != nil {
			return err
		}
	case CompiledEgressRouteCredentialResolverMistleMCPToken:
		if err := requireNonEmptyJSONField(fields, "apiKeyId", wire.APIKeyID, "mistle_mcp_token egress credential resolver"); err != nil {
			return err
		}
	case CompiledEgressRouteCredentialResolverMistleMCPSetupAssistantToken:
		if err := requireNonEmptyJSONField(fields, "sandboxProfileId", wire.SandboxProfileID, "mistle_mcp_setup_assistant_token egress credential resolver"); err != nil {
			return err
		}
		if err := requireJSONField(fields, "sandboxProfileVersion", "mistle_mcp_setup_assistant_token egress credential resolver"); err != nil {
			return err
		}
	default:
		return fmt.Errorf("unsupported egress credential resolver kind %q", wire.Kind)
	}
	*resolver = CompiledEgressRouteCredentialResolver(wire)
	return nil
}

type CompiledEgressRouteCredentialResolverKind string

const (
	CompiledEgressRouteCredentialResolverIntegrationConnection        CompiledEgressRouteCredentialResolverKind = "integration_connection"
	CompiledEgressRouteCredentialResolverLinkedPrincipal              CompiledEgressRouteCredentialResolverKind = "linked_principal"
	CompiledEgressRouteCredentialResolverMistleMCPToken               CompiledEgressRouteCredentialResolverKind = "mistle_mcp_token"
	CompiledEgressRouteCredentialResolverMistleMCPSetupAssistantToken CompiledEgressRouteCredentialResolverKind = "mistle_mcp_setup_assistant_token"
)

type CompiledLinkedPrincipalEgressCredentialResolutionMode string

const (
	CompiledLinkedPrincipalEgressCredentialResolutionRequired  CompiledLinkedPrincipalEgressCredentialResolutionMode = "required"
	CompiledLinkedPrincipalEgressCredentialResolutionPreferred CompiledLinkedPrincipalEgressCredentialResolutionMode = "preferred"
)

type CompiledRuntimeArtifact struct {
	ArtifactKey string                   `json:"artifactKey"`
	Name        string                   `json:"name"`
	Env         map[string]string        `json:"env"`
	Lifecycle   RuntimeArtifactLifecycle `json:"lifecycle"`
}

type RuntimeArtifactLifecycle struct {
	Install []RuntimeArtifactInstallStep `json:"install"`
}

type RuntimeArtifactInstallStep struct {
	Op          RuntimeArtifactInstallOp                 `json:"op"`
	Command     RuntimeExecCommand                       `json:"command"`
	Tools       []string                                 `json:"tools"`
	Force       *bool                                    `json:"force"`
	TimeoutMS   *uint64                                  `json:"timeoutMs"`
	Repository  string                                   `json:"repository"`
	Release     RuntimeArtifactGitHubReleaseSelector     `json:"release"`
	Asset       RuntimeArtifactGitHubReleaseInstallAsset `json:"asset"`
	InstallPath string                                   `json:"installPath"`
}

type RuntimeArtifactInstallOp string

const (
	RuntimeArtifactInstallOpExec                 RuntimeArtifactInstallOp = "exec"
	RuntimeArtifactInstallOpMiseInstall          RuntimeArtifactInstallOp = "mise_install"
	RuntimeArtifactInstallOpGitHubReleaseInstall RuntimeArtifactInstallOp = "github_release_install"
)

type RuntimeArtifactGitHubReleaseSelector struct {
	Kind   RuntimeArtifactGitHubReleaseSelectorKind `json:"kind"`
	Match  RuntimeArtifactGitHubReleaseTagMatch     `json:"match"`
	Tag    string                                   `json:"tag"`
	Prefix string                                   `json:"prefix"`
}

func (selector *RuntimeArtifactGitHubReleaseSelector) UnmarshalJSON(payload []byte) error {
	var wire struct {
		Kind   RuntimeArtifactGitHubReleaseSelectorKind `json:"kind"`
		Match  RuntimeArtifactGitHubReleaseTagMatch     `json:"match"`
		Tag    string                                   `json:"tag"`
		Prefix string                                   `json:"prefix"`
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&wire); err != nil {
		return err
	}
	switch wire.Kind {
	case RuntimeArtifactGitHubReleaseSelectorLatest:
		if wire.Match != "" || wire.Tag != "" || wire.Prefix != "" {
			return fmt.Errorf("latest github release selectors must not include tag match fields")
		}
	case RuntimeArtifactGitHubReleaseSelectorTag:
		switch wire.Match {
		case RuntimeArtifactGitHubReleaseTagMatchExact:
			if wire.Tag == "" {
				return fmt.Errorf("tag must be present and non-empty")
			}
			if wire.Prefix != "" {
				return fmt.Errorf("exact github release selectors must not include prefix")
			}
		case RuntimeArtifactGitHubReleaseTagMatchLatestMatchingPrefix:
			if wire.Prefix == "" {
				return fmt.Errorf("prefix must be present and non-empty")
			}
			if wire.Tag != "" {
				return fmt.Errorf("latest_matching_prefix github release selectors must not include tag")
			}
		default:
			return fmt.Errorf("unsupported github release tag match %q", wire.Match)
		}
	default:
		return fmt.Errorf("unsupported github release selector kind %q", wire.Kind)
	}
	*selector = RuntimeArtifactGitHubReleaseSelector(wire)
	return nil
}

type RuntimeArtifactGitHubReleaseSelectorKind string

const (
	RuntimeArtifactGitHubReleaseSelectorLatest RuntimeArtifactGitHubReleaseSelectorKind = "latest"
	RuntimeArtifactGitHubReleaseSelectorTag    RuntimeArtifactGitHubReleaseSelectorKind = "tag"
)

type RuntimeArtifactGitHubReleaseTagMatch string

const (
	RuntimeArtifactGitHubReleaseTagMatchExact                RuntimeArtifactGitHubReleaseTagMatch = "exact"
	RuntimeArtifactGitHubReleaseTagMatchLatestMatchingPrefix RuntimeArtifactGitHubReleaseTagMatch = "latest_matching_prefix"
)

type RuntimeArtifactGitHubReleaseInstallAsset struct {
	Kind    RuntimeArtifactGitHubReleaseInstallAssetKind `json:"kind"`
	Exact   RuntimeArtifactGitHubReleaseAssetShape       `json:"-"`
	X86_64  RuntimeArtifactGitHubReleaseAssetShape       `json:"x86_64"`
	Aarch64 RuntimeArtifactGitHubReleaseAssetShape       `json:"aarch64"`
}

type RuntimeArtifactGitHubReleaseInstallAssetKind string

const (
	RuntimeArtifactGitHubReleaseInstallAssetKindExact  RuntimeArtifactGitHubReleaseInstallAssetKind = "exact"
	RuntimeArtifactGitHubReleaseInstallAssetKindByArch RuntimeArtifactGitHubReleaseInstallAssetKind = "by_arch"
)

func (asset *RuntimeArtifactGitHubReleaseInstallAsset) UnmarshalJSON(payload []byte) error {
	var wire struct {
		Kind          RuntimeArtifactGitHubReleaseInstallAssetKind `json:"kind"`
		FileName      string                                       `json:"fileName"`
		Format        RuntimeArtifactGitHubReleaseAssetFormat      `json:"format"`
		ExtractedPath string                                       `json:"extractedPath"`
		SHA256        *string                                      `json:"sha256"`
		X86_64        RuntimeArtifactGitHubReleaseAssetShape       `json:"x86_64"`
		Aarch64       RuntimeArtifactGitHubReleaseAssetShape       `json:"aarch64"`
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&wire); err != nil {
		return err
	}
	asset.Kind = wire.Kind
	asset.X86_64 = wire.X86_64
	asset.Aarch64 = wire.Aarch64
	switch wire.Kind {
	case RuntimeArtifactGitHubReleaseInstallAssetKindByArch:
		if wire.FileName != "" || wire.Format != "" || wire.ExtractedPath != "" || wire.SHA256 != nil {
			return fmt.Errorf("by_arch github release assets must not include exact asset fields")
		}
		if err := validateGitHubReleaseAssetShape(wire.X86_64); err != nil {
			return fmt.Errorf("x86_64 github release asset is invalid: %w", err)
		}
		if err := validateGitHubReleaseAssetShape(wire.Aarch64); err != nil {
			return fmt.Errorf("aarch64 github release asset is invalid: %w", err)
		}
		return nil
	case RuntimeArtifactGitHubReleaseInstallAssetKindExact:
		exact := RuntimeArtifactGitHubReleaseAssetShape{
			FileName:      wire.FileName,
			Format:        wire.Format,
			ExtractedPath: wire.ExtractedPath,
			SHA256:        wire.SHA256,
		}
		if err := validateGitHubReleaseAssetShape(exact); err != nil {
			return err
		}
		asset.Kind = RuntimeArtifactGitHubReleaseInstallAssetKindExact
		asset.Exact = exact
		return nil
	case "":
		return fmt.Errorf("github release install asset kind is required")
	default:
		return fmt.Errorf("unsupported github release install asset kind %q", wire.Kind)
	}
}

type RuntimeArtifactGitHubReleaseAssetShape struct {
	FileName      string                                  `json:"fileName"`
	Format        RuntimeArtifactGitHubReleaseAssetFormat `json:"format"`
	ExtractedPath string                                  `json:"extractedPath"`
	SHA256        *string                                 `json:"sha256"`
}

func (shape *RuntimeArtifactGitHubReleaseAssetShape) UnmarshalJSON(payload []byte) error {
	var wire struct {
		FileName      string                                  `json:"fileName"`
		Format        RuntimeArtifactGitHubReleaseAssetFormat `json:"format"`
		ExtractedPath string                                  `json:"extractedPath"`
		SHA256        *string                                 `json:"sha256"`
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&wire); err != nil {
		return err
	}
	parsed := RuntimeArtifactGitHubReleaseAssetShape(wire)
	if err := validateGitHubReleaseAssetShape(parsed); err != nil {
		return err
	}
	*shape = parsed
	return nil
}

func validateGitHubReleaseAssetShape(shape RuntimeArtifactGitHubReleaseAssetShape) error {
	if shape.FileName == "" {
		return fmt.Errorf("github release asset fileName must be present and non-empty")
	}
	switch shape.Format {
	case RuntimeArtifactGitHubReleaseAssetFormatBinary:
		if shape.ExtractedPath != "" {
			return fmt.Errorf("binary assets must not include extractedPath")
		}
	case RuntimeArtifactGitHubReleaseAssetFormatTarGz:
		if shape.ExtractedPath == "" {
			return fmt.Errorf("tar.gz assets must include extractedPath")
		}
	default:
		return fmt.Errorf("unsupported github release asset format %q", shape.Format)
	}
	return nil
}

type RuntimeArtifactGitHubReleaseAssetFormat string

const (
	RuntimeArtifactGitHubReleaseAssetFormatBinary RuntimeArtifactGitHubReleaseAssetFormat = "binary"
	RuntimeArtifactGitHubReleaseAssetFormatTarGz  RuntimeArtifactGitHubReleaseAssetFormat = "tar.gz"
)

type CompiledWorkspaceSource struct {
	SourceKind       WorkspaceSourceKind         `json:"sourceKind"`
	ResourceKind     WorkspaceSourceResourceKind `json:"resourceKind"`
	Path             string                      `json:"path"`
	OriginURL        string                      `json:"originUrl"`
	CloneURL         *string                     `json:"cloneUrl,omitempty"`
	EgressGrantToken *string                     `json:"egressGrantToken,omitempty"`
}

func (source *CompiledWorkspaceSource) UnmarshalJSON(payload []byte) error {
	var wire struct {
		SourceKind       WorkspaceSourceKind         `json:"sourceKind"`
		ResourceKind     WorkspaceSourceResourceKind `json:"resourceKind"`
		Path             string                      `json:"path"`
		OriginURL        string                      `json:"originUrl"`
		CloneURL         *string                     `json:"cloneUrl,omitempty"`
		EgressGrantToken *string                     `json:"egressGrantToken,omitempty"`
	}
	fields, err := decodeObjectFields(payload)
	if err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	if err := decoder.Decode(&wire); err != nil {
		return err
	}
	if err := requireJSONField(fields, "sourceKind", "workspace source"); err != nil {
		return err
	}
	if err := requireJSONField(fields, "resourceKind", "workspace source"); err != nil {
		return err
	}
	if err := requireNonEmptyJSONField(fields, "path", wire.Path, "workspace source"); err != nil {
		return err
	}
	if err := requireNonEmptyJSONField(fields, "originUrl", wire.OriginURL, "workspace source"); err != nil {
		return err
	}
	*source = CompiledWorkspaceSource(wire)
	return nil
}

type WorkspaceSourceKind string

const WorkspaceSourceKindGitClone WorkspaceSourceKind = "git-clone"

type WorkspaceSourceResourceKind string

const WorkspaceSourceResourceKindRepository WorkspaceSourceResourceKind = "repository"

type CompiledRuntimePlanSkills struct {
	OriginURL      string                   `json:"originUrl"`
	SelectedSkills []CompiledSkillSelection `json:"selectedSkills"`
}

type CompiledSkillSelection struct {
	Name         string `json:"name"`
	RelativePath string `json:"relativePath"`
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

func (readiness *RuntimeClientProcessReadiness) UnmarshalJSON(payload []byte) error {
	var wire struct {
		Type           RuntimeClientProcessReadinessType `json:"type"`
		URL            string                            `json:"url"`
		Host           string                            `json:"host"`
		Port           uint16                            `json:"port"`
		ExpectedStatus uint16                            `json:"expectedStatus"`
		TimeoutMS      uint64                            `json:"timeoutMs"`
	}
	fields, err := decodeObjectFields(payload)
	if err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	if err := decoder.Decode(&wire); err != nil {
		return err
	}
	if err := requireJSONField(fields, "type", "runtime process readiness"); err != nil {
		return err
	}
	switch wire.Type {
	case RuntimeClientProcessReadinessNone:
	case RuntimeClientProcessReadinessHTTP:
		if err := requireNonEmptyJSONField(fields, "url", wire.URL, "http runtime process readiness"); err != nil {
			return err
		}
		if err := requireJSONField(fields, "expectedStatus", "http runtime process readiness"); err != nil {
			return err
		}
		if err := requireJSONField(fields, "timeoutMs", "http runtime process readiness"); err != nil {
			return err
		}
	case RuntimeClientProcessReadinessWS:
		if err := requireNonEmptyJSONField(fields, "url", wire.URL, "ws runtime process readiness"); err != nil {
			return err
		}
		if err := requireJSONField(fields, "timeoutMs", "ws runtime process readiness"); err != nil {
			return err
		}
	case RuntimeClientProcessReadinessTCP:
		if err := requireNonEmptyJSONField(fields, "host", wire.Host, "tcp runtime process readiness"); err != nil {
			return err
		}
		if err := requireJSONField(fields, "port", "tcp runtime process readiness"); err != nil {
			return err
		}
		if err := requireJSONField(fields, "timeoutMs", "tcp runtime process readiness"); err != nil {
			return err
		}
	default:
		return fmt.Errorf("unsupported runtime process readiness type %q", wire.Type)
	}
	*readiness = RuntimeClientProcessReadiness{
		Type:           wire.Type,
		URL:            wire.URL,
		Host:           wire.Host,
		Port:           wire.Port,
		ExpectedStatus: wire.ExpectedStatus,
		TimeoutMS:      wire.TimeoutMS,
	}
	return nil
}

func (readiness RuntimeClientProcessReadiness) MarshalJSON() ([]byte, error) {
	switch readiness.Type {
	case RuntimeClientProcessReadinessNone:
		return json.Marshal(struct {
			Type RuntimeClientProcessReadinessType `json:"type"`
		}{Type: readiness.Type})
	case RuntimeClientProcessReadinessHTTP:
		return json.Marshal(struct {
			Type           RuntimeClientProcessReadinessType `json:"type"`
			URL            string                            `json:"url"`
			ExpectedStatus uint16                            `json:"expectedStatus"`
			TimeoutMS      uint64                            `json:"timeoutMs"`
		}{
			Type:           readiness.Type,
			URL:            readiness.URL,
			ExpectedStatus: readiness.ExpectedStatus,
			TimeoutMS:      readiness.TimeoutMS,
		})
	case RuntimeClientProcessReadinessWS:
		return json.Marshal(struct {
			Type      RuntimeClientProcessReadinessType `json:"type"`
			URL       string                            `json:"url"`
			TimeoutMS uint64                            `json:"timeoutMs"`
		}{
			Type:      readiness.Type,
			URL:       readiness.URL,
			TimeoutMS: readiness.TimeoutMS,
		})
	case RuntimeClientProcessReadinessTCP:
		return json.Marshal(struct {
			Type      RuntimeClientProcessReadinessType `json:"type"`
			Host      string                            `json:"host"`
			Port      uint16                            `json:"port"`
			TimeoutMS uint64                            `json:"timeoutMs"`
		}{
			Type:      readiness.Type,
			Host:      readiness.Host,
			Port:      readiness.Port,
			TimeoutMS: readiness.TimeoutMS,
		})
	default:
		return json.Marshal(struct {
			Type RuntimeClientProcessReadinessType `json:"type"`
		}{Type: readiness.Type})
	}
}

type RuntimeExecCommand struct {
	Args      []string          `json:"args"`
	Env       map[string]string `json:"env"`
	CWD       *string           `json:"cwd"`
	TimeoutMS *uint64           `json:"timeoutMs"`
}

func (command *RuntimeExecCommand) UnmarshalJSON(payload []byte) error {
	var wire struct {
		Args      []string          `json:"args"`
		Env       map[string]string `json:"env"`
		CWD       *string           `json:"cwd"`
		TimeoutMS *uint64           `json:"timeoutMs"`
	}
	var presence map[string]json.RawMessage
	if err := json.Unmarshal(payload, &presence); err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&wire); err != nil {
		return err
	}
	if _, ok := presence["args"]; !ok {
		return fmt.Errorf("runtime exec command args field is required")
	}
	*command = RuntimeExecCommand{
		Args:      wire.Args,
		Env:       wire.Env,
		CWD:       wire.CWD,
		TimeoutMS: wire.TimeoutMS,
	}
	return nil
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
	ClientID  string                  `json:"clientId"`
	Setup     RuntimeClientSetup      `json:"setup"`
	Processes []RuntimeClientProcess  `json:"processes"`
	Endpoints []RuntimeClientEndpoint `json:"endpoints"`
}

type RuntimeClientProcess struct {
	ProcessKey string
	Command    RuntimeExecCommand
	Readiness  RuntimeClientProcessReadiness
	Stop       RuntimeClientProcessStopPolicy
}

func (process RuntimeClientProcess) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		ProcessKey string                         `json:"processKey"`
		Command    RuntimeExecCommand             `json:"command"`
		Readiness  RuntimeClientProcessReadiness  `json:"readiness"`
		Stop       RuntimeClientProcessStopPolicy `json:"stop"`
	}{
		ProcessKey: process.ProcessKey,
		Command:    process.Command,
		Readiness:  process.Readiness,
		Stop:       process.Stop,
	})
}

type RuntimeClientProcessStopPolicy struct {
	Signal        RuntimeClientProcessStopSignal
	TimeoutMS     uint64
	GracePeriodMS *uint64
}

func (policy *RuntimeClientProcessStopPolicy) UnmarshalJSON(payload []byte) error {
	var wire struct {
		Signal        RuntimeClientProcessStopSignal `json:"signal"`
		TimeoutMS     uint64                         `json:"timeoutMs"`
		GracePeriodMS *uint64                        `json:"gracePeriodMs"`
	}
	fields, err := decodeObjectFields(payload)
	if err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	if err := decoder.Decode(&wire); err != nil {
		return err
	}
	if err := requireJSONField(fields, "signal", "runtime process stop"); err != nil {
		return err
	}
	if err := requireJSONField(fields, "timeoutMs", "runtime process stop"); err != nil {
		return err
	}
	*policy = RuntimeClientProcessStopPolicy{
		Signal:        wire.Signal,
		TimeoutMS:     wire.TimeoutMS,
		GracePeriodMS: wire.GracePeriodMS,
	}
	return nil
}

func (policy RuntimeClientProcessStopPolicy) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		Signal        RuntimeClientProcessStopSignal `json:"signal"`
		TimeoutMS     uint64                         `json:"timeoutMs"`
		GracePeriodMS *uint64                        `json:"gracePeriodMs,omitempty"`
	}{
		Signal:        policy.Signal,
		TimeoutMS:     policy.TimeoutMS,
		GracePeriodMS: policy.GracePeriodMS,
	})
}

type RuntimeClientEndpoint struct {
	EndpointKey    string                         `json:"endpointKey"`
	ProcessKey     *string                        `json:"processKey"`
	Transport      RuntimeClientEndpointTransport `json:"transport"`
	ConnectionMode string                         `json:"connectionMode"`
}

type RuntimeClientEndpointTransport struct {
	Type string `json:"type"`
	URL  string `json:"url"`
}

func (transport *RuntimeClientEndpointTransport) UnmarshalJSON(payload []byte) error {
	var wire struct {
		Type string `json:"type"`
		URL  string `json:"url"`
	}
	fields, err := decodeObjectFields(payload)
	if err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	if err := decoder.Decode(&wire); err != nil {
		return err
	}
	if err := requireJSONField(fields, "type", "runtime client endpoint transport"); err != nil {
		return err
	}
	if wire.Type == "ws" {
		if err := requireNonEmptyJSONField(fields, "url", wire.URL, "ws runtime client endpoint transport"); err != nil {
			return err
		}
	}
	*transport = RuntimeClientEndpointTransport(wire)
	return nil
}

type RuntimeClientProcessStopSignal string

const (
	RuntimeClientProcessStopSignalSIGTERM RuntimeClientProcessStopSignal = "sigterm"
	RuntimeClientProcessStopSignalSIGKILL RuntimeClientProcessStopSignal = "sigkill"
)

type CompiledAgentRuntime struct {
	RuntimeID   string          `json:"runtimeId"`
	RuntimeKey  string          `json:"runtimeKey"`
	ClientID    string          `json:"clientId"`
	EndpointKey string          `json:"endpointKey"`
	PTYLaunch   json.RawMessage `json:"ptyLaunch"`
}
