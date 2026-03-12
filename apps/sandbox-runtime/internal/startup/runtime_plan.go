package startup

import (
	"fmt"
	"net/url"
	"strings"
)

const (
	resolvedSandboxImageSourceSnapshot    = "snapshot"
	resolvedSandboxImageSourceProfileBase = "profile-base"
	resolvedSandboxImageSourceBase        = "base"
)

var allowedAuthInjectionTypes = map[string]struct{}{
	"bearer": {},
	"basic":  {},
	"header": {},
	"query":  {},
}

type RuntimePlan struct {
	SandboxProfileID string                       `json:"sandboxProfileId"`
	Version          int                          `json:"version"`
	Image            ResolvedSandboxImage         `json:"image"`
	EgressRoutes     []EgressCredentialRoute      `json:"egressRoutes"`
	Artifacts        []RuntimeArtifactSpec        `json:"artifacts"`
	ArtifactRemovals []RuntimeArtifactRemovalSpec `json:"artifactRemovals"`
	WorkspaceSources []WorkspaceSource            `json:"workspaceSources"`
	RuntimeClients   []RuntimeClient              `json:"runtimeClients"`
	AgentRuntimes    []AgentRuntime               `json:"agentRuntimes"`
}

type ResolvedSandboxImage struct {
	Source           string `json:"source"`
	ImageRef         string `json:"imageRef"`
	InstanceID       string `json:"instanceId"`
	SandboxProfileID string `json:"sandboxProfileId"`
	Version          int    `json:"version"`
}

type EgressCredentialRoute struct {
	EgressRuleID       string                   `json:"egressRuleId"`
	BindingID          string                   `json:"bindingId"`
	Match              EgressRouteMatch         `json:"match"`
	Upstream           EgressRouteUpstream      `json:"upstream"`
	AuthInjection      EgressAuthInjection      `json:"authInjection"`
	CredentialResolver EgressCredentialResolver `json:"credentialResolver"`
}

type EgressRouteMatch struct {
	Hosts        []string `json:"hosts"`
	PathPrefixes []string `json:"pathPrefixes"`
	Methods      []string `json:"methods"`
}

type EgressRouteUpstream struct {
	BaseURL string `json:"baseUrl"`
}

type EgressAuthInjection struct {
	Type   string `json:"type"`
	Target string `json:"target"`
	// Username is only used for Basic auth routes that need a fixed username in
	// addition to the resolved secret value, such as GitHub App HTTP Git access
	// with x-access-token:<installation-token>.
	Username string `json:"username"`
}

type EgressCredentialResolver struct {
	ConnectionID string `json:"connectionId"`
	SecretType   string `json:"secretType"`
	Purpose      string `json:"purpose"`
	ResolverKey  string `json:"resolverKey"`
}

type RuntimeArtifactSpec struct {
	ArtifactKey string                   `json:"artifactKey"`
	Name        string                   `json:"name"`
	Description string                   `json:"description"`
	Env         map[string]string        `json:"env"`
	Lifecycle   RuntimeArtifactLifecycle `json:"lifecycle"`
}

type RuntimeArtifactLifecycle struct {
	Install []RuntimeArtifactCommand `json:"install"`
	Update  []RuntimeArtifactCommand `json:"update"`
	Remove  []RuntimeArtifactCommand `json:"remove"`
}

type RuntimeArtifactRemovalSpec struct {
	ArtifactKey string                   `json:"artifactKey"`
	Commands    []RuntimeArtifactCommand `json:"commands"`
}

type RuntimeArtifactCommand struct {
	Args      []string          `json:"args"`
	Env       map[string]string `json:"env"`
	Cwd       string            `json:"cwd"`
	TimeoutMs int               `json:"timeoutMs"`
}

type RuntimeClient struct {
	ClientID  string                      `json:"clientId"`
	Setup     RuntimeClientSetup          `json:"setup"`
	Processes []RuntimeClientProcessSpec  `json:"processes"`
	Endpoints []RuntimeClientEndpointSpec `json:"endpoints"`
}

type RuntimeClientSetup struct {
	Env        map[string]string `json:"env"`
	Files      []RuntimeFileSpec `json:"files"`
	LaunchArgs []string          `json:"launchArgs"`
}

type RuntimeClientProcessSpec struct {
	ProcessKey string                         `json:"processKey"`
	Command    RuntimeArtifactCommand         `json:"command"`
	Readiness  RuntimeClientProcessReadiness  `json:"readiness"`
	Stop       RuntimeClientProcessStopPolicy `json:"stop"`
}

type RuntimeClientEndpointSpec struct {
	EndpointKey    string                         `json:"endpointKey"`
	ProcessKey     string                         `json:"processKey"`
	Transport      RuntimeClientEndpointTransport `json:"transport"`
	ConnectionMode string                         `json:"connectionMode"`
}

type RuntimeClientEndpointTransport struct {
	Type string `json:"type"`
	URL  string `json:"url"`
}

type RuntimeClientProcessReadiness struct {
	Type           string `json:"type"`
	Host           string `json:"host"`
	Port           int    `json:"port"`
	TimeoutMs      int    `json:"timeoutMs"`
	URL            string `json:"url"`
	ExpectedStatus int    `json:"expectedStatus"`
}

type RuntimeClientProcessStopPolicy struct {
	Signal        string `json:"signal"`
	TimeoutMs     int    `json:"timeoutMs"`
	GracePeriodMs int    `json:"gracePeriodMs"`
}

type RuntimeFileSpec struct {
	FileID  string `json:"fileId"`
	Path    string `json:"path"`
	Mode    int    `json:"mode"`
	Content string `json:"content"`
}

type AgentRuntime struct {
	BindingID   string `json:"bindingId"`
	RuntimeKey  string `json:"runtimeKey"`
	ClientID    string `json:"clientId"`
	EndpointKey string `json:"endpointKey"`
}

type WorkspaceSource struct {
	SourceKind   string `json:"sourceKind"`
	ResourceKind string `json:"resourceKind"`
	Path         string `json:"path"`
	OriginURL    string `json:"originUrl"`
}

func ValidateRuntimePlan(runtimePlan RuntimePlan) error {
	if strings.TrimSpace(runtimePlan.SandboxProfileID) == "" {
		return fmt.Errorf("runtime plan sandboxProfileId is required")
	}
	if runtimePlan.Version < 1 {
		return fmt.Errorf("runtime plan version must be at least 1")
	}
	if runtimePlan.EgressRoutes == nil {
		return fmt.Errorf("runtime plan egressRoutes is required")
	}
	if runtimePlan.Artifacts == nil {
		return fmt.Errorf("runtime plan artifacts is required")
	}
	if runtimePlan.ArtifactRemovals == nil {
		return fmt.Errorf("runtime plan artifactRemovals is required")
	}
	if runtimePlan.WorkspaceSources == nil {
		return fmt.Errorf("runtime plan workspaceSources is required")
	}
	if runtimePlan.RuntimeClients == nil {
		return fmt.Errorf("runtime plan runtimeClients is required")
	}
	if runtimePlan.AgentRuntimes == nil {
		return fmt.Errorf("runtime plan agentRuntimes is required")
	}

	if err := validateResolvedSandboxImage(runtimePlan.Image); err != nil {
		return err
	}

	egressRuleIDs := make(map[string]struct{}, len(runtimePlan.EgressRoutes))
	for routeIndex, route := range runtimePlan.EgressRoutes {
		if err := validateEgressRoute(route, routeIndex); err != nil {
			return err
		}

		if _, exists := egressRuleIDs[route.EgressRuleID]; exists {
			return fmt.Errorf("runtime plan egressRoutes[%d] egressRuleId '%s' is duplicated", routeIndex, route.EgressRuleID)
		}
		egressRuleIDs[route.EgressRuleID] = struct{}{}
	}

	for artifactIndex, artifact := range runtimePlan.Artifacts {
		if err := validateArtifact(artifact, artifactIndex); err != nil {
			return err
		}
	}
	for removalIndex, removal := range runtimePlan.ArtifactRemovals {
		if err := validateArtifactRemoval(removal, removalIndex); err != nil {
			return err
		}
	}
	for sourceIndex, workspaceSource := range runtimePlan.WorkspaceSources {
		if err := validateWorkspaceSource(workspaceSource, sourceIndex); err != nil {
			return err
		}
	}

	endpointKeysByClientID := make(map[string]map[string]RuntimeClientEndpointSpec, len(runtimePlan.RuntimeClients))
	for clientIndex, runtimeClient := range runtimePlan.RuntimeClients {
		if err := validateRuntimeClient(runtimeClient, clientIndex); err != nil {
			return err
		}

		if _, exists := endpointKeysByClientID[runtimeClient.ClientID]; exists {
			return fmt.Errorf(
				"runtime plan runtimeClients[%d].clientId '%s' is duplicated",
				clientIndex,
				runtimeClient.ClientID,
			)
		}

		endpointsByKey := make(map[string]RuntimeClientEndpointSpec, len(runtimeClient.Endpoints))
		for _, endpoint := range runtimeClient.Endpoints {
			endpointsByKey[endpoint.EndpointKey] = endpoint
		}
		endpointKeysByClientID[runtimeClient.ClientID] = endpointsByKey
	}

	runtimeKeys := make(map[string]struct{}, len(runtimePlan.AgentRuntimes))
	for agentRuntimeIndex, agentRuntime := range runtimePlan.AgentRuntimes {
		if err := validateAgentRuntime(agentRuntime, agentRuntimeIndex, runtimeKeys, endpointKeysByClientID); err != nil {
			return err
		}
	}

	return nil
}

func validateResolvedSandboxImage(image ResolvedSandboxImage) error {
	if strings.TrimSpace(image.Source) == "" {
		return fmt.Errorf("runtime plan image source is required")
	}
	if strings.TrimSpace(image.ImageRef) == "" {
		return fmt.Errorf("runtime plan image imageRef is required")
	}

	switch image.Source {
	case resolvedSandboxImageSourceSnapshot:
		if strings.TrimSpace(image.InstanceID) == "" {
			return fmt.Errorf("runtime plan image instanceId is required for source '%s'", image.Source)
		}
	case resolvedSandboxImageSourceProfileBase:
		if strings.TrimSpace(image.SandboxProfileID) == "" {
			return fmt.Errorf("runtime plan image sandboxProfileId is required for source '%s'", image.Source)
		}
		if image.Version < 1 {
			return fmt.Errorf("runtime plan image version must be at least 1 for source '%s'", image.Source)
		}
	case resolvedSandboxImageSourceBase:
		return nil
	default:
		return fmt.Errorf("runtime plan image source '%s' is not supported", image.Source)
	}

	return nil
}

func validateEgressRoute(route EgressCredentialRoute, routeIndex int) error {
	if strings.TrimSpace(route.EgressRuleID) == "" {
		return fmt.Errorf("runtime plan egressRoutes[%d] egressRuleId is required", routeIndex)
	}
	if strings.TrimSpace(route.BindingID) == "" {
		return fmt.Errorf("runtime plan egressRoutes[%d] bindingId is required", routeIndex)
	}
	if route.Match.Hosts == nil {
		return fmt.Errorf("runtime plan egressRoutes[%d] match.hosts is required", routeIndex)
	}
	if len(route.Match.Hosts) == 0 {
		return fmt.Errorf("runtime plan egressRoutes[%d] match.hosts must not be empty", routeIndex)
	}
	for hostIndex, host := range route.Match.Hosts {
		if strings.TrimSpace(host) == "" {
			return fmt.Errorf("runtime plan egressRoutes[%d] match.hosts[%d] must be non-empty", routeIndex, hostIndex)
		}
	}

	for prefixIndex, pathPrefix := range route.Match.PathPrefixes {
		if strings.TrimSpace(pathPrefix) == "" {
			return fmt.Errorf("runtime plan egressRoutes[%d] match.pathPrefixes[%d] must be non-empty", routeIndex, prefixIndex)
		}
	}
	for methodIndex, method := range route.Match.Methods {
		if strings.TrimSpace(method) == "" {
			return fmt.Errorf("runtime plan egressRoutes[%d] match.methods[%d] must be non-empty", routeIndex, methodIndex)
		}
	}

	if strings.TrimSpace(route.Upstream.BaseURL) == "" {
		return fmt.Errorf("runtime plan egressRoutes[%d] upstream.baseUrl is required", routeIndex)
	}
	if strings.TrimSpace(route.AuthInjection.Type) == "" {
		return fmt.Errorf("runtime plan egressRoutes[%d] authInjection.type is required", routeIndex)
	}
	if _, ok := allowedAuthInjectionTypes[route.AuthInjection.Type]; !ok {
		return fmt.Errorf("runtime plan egressRoutes[%d] authInjection.type '%s' is not supported", routeIndex, route.AuthInjection.Type)
	}
	if strings.TrimSpace(route.AuthInjection.Target) == "" {
		return fmt.Errorf("runtime plan egressRoutes[%d] authInjection.target is required", routeIndex)
	}
	if route.AuthInjection.Type != "basic" && strings.TrimSpace(route.AuthInjection.Username) != "" {
		return fmt.Errorf("runtime plan egressRoutes[%d] authInjection.username is only supported for basic auth injection", routeIndex)
	}
	if strings.TrimSpace(route.CredentialResolver.ConnectionID) == "" {
		return fmt.Errorf("runtime plan egressRoutes[%d] credentialResolver.connectionId is required", routeIndex)
	}
	if strings.TrimSpace(route.CredentialResolver.SecretType) == "" {
		return fmt.Errorf("runtime plan egressRoutes[%d] credentialResolver.secretType is required", routeIndex)
	}

	return nil
}

func validateWorkspaceSource(
	workspaceSource WorkspaceSource,
	sourceIndex int,
) error {
	if strings.TrimSpace(workspaceSource.SourceKind) == "" {
		return fmt.Errorf("runtime plan workspaceSources[%d].sourceKind is required", sourceIndex)
	}
	if workspaceSource.SourceKind != "git-clone" {
		return fmt.Errorf("runtime plan workspaceSources[%d].sourceKind '%s' is not supported", sourceIndex, workspaceSource.SourceKind)
	}
	if strings.TrimSpace(workspaceSource.ResourceKind) == "" {
		return fmt.Errorf("runtime plan workspaceSources[%d].resourceKind is required", sourceIndex)
	}
	if strings.TrimSpace(workspaceSource.Path) == "" {
		return fmt.Errorf("runtime plan workspaceSources[%d].path is required", sourceIndex)
	}
	if strings.TrimSpace(workspaceSource.OriginURL) == "" {
		return fmt.Errorf("runtime plan workspaceSources[%d].originUrl is required", sourceIndex)
	}
	parsedOriginURL, err := url.Parse(workspaceSource.OriginURL)
	if err != nil {
		return fmt.Errorf("runtime plan workspaceSources[%d].originUrl is invalid: %w", sourceIndex, err)
	}
	if parsedOriginURL.Scheme != "http" && parsedOriginURL.Scheme != "https" {
		return fmt.Errorf("runtime plan workspaceSources[%d].originUrl must use http or https scheme", sourceIndex)
	}
	return nil
}

func validateArtifact(artifact RuntimeArtifactSpec, artifactIndex int) error {
	if strings.TrimSpace(artifact.ArtifactKey) == "" {
		return fmt.Errorf("runtime plan artifacts[%d] artifactKey is required", artifactIndex)
	}
	if strings.TrimSpace(artifact.Name) == "" {
		return fmt.Errorf("runtime plan artifacts[%d] name is required", artifactIndex)
	}
	if artifact.Lifecycle.Install == nil {
		return fmt.Errorf("runtime plan artifacts[%d] lifecycle.install is required", artifactIndex)
	}
	if artifact.Lifecycle.Remove == nil {
		return fmt.Errorf("runtime plan artifacts[%d] lifecycle.remove is required", artifactIndex)
	}
	if len(artifact.Lifecycle.Install) == 0 {
		return fmt.Errorf("runtime plan artifacts[%d] lifecycle.install must not be empty", artifactIndex)
	}
	if len(artifact.Lifecycle.Remove) == 0 {
		return fmt.Errorf("runtime plan artifacts[%d] lifecycle.remove must not be empty", artifactIndex)
	}
	for envKey := range artifact.Env {
		if strings.TrimSpace(envKey) == "" {
			return fmt.Errorf("runtime plan artifacts[%d] env contains an empty key", artifactIndex)
		}
	}

	for installIndex, command := range artifact.Lifecycle.Install {
		if err := validateArtifactCommand(command, fmt.Sprintf("runtime plan artifacts[%d] lifecycle.install[%d]", artifactIndex, installIndex)); err != nil {
			return err
		}
	}
	for updateIndex, command := range artifact.Lifecycle.Update {
		if err := validateArtifactCommand(command, fmt.Sprintf("runtime plan artifacts[%d] lifecycle.update[%d]", artifactIndex, updateIndex)); err != nil {
			return err
		}
	}
	for removeIndex, command := range artifact.Lifecycle.Remove {
		if err := validateArtifactCommand(command, fmt.Sprintf("runtime plan artifacts[%d] lifecycle.remove[%d]", artifactIndex, removeIndex)); err != nil {
			return err
		}
	}

	return nil
}

func validateArtifactRemoval(removal RuntimeArtifactRemovalSpec, removalIndex int) error {
	if strings.TrimSpace(removal.ArtifactKey) == "" {
		return fmt.Errorf("runtime plan artifactRemovals[%d] artifactKey is required", removalIndex)
	}
	if removal.Commands == nil {
		return fmt.Errorf("runtime plan artifactRemovals[%d] commands is required", removalIndex)
	}
	if len(removal.Commands) == 0 {
		return fmt.Errorf("runtime plan artifactRemovals[%d] commands must not be empty", removalIndex)
	}
	for commandIndex, command := range removal.Commands {
		if err := validateArtifactCommand(
			command,
			fmt.Sprintf("runtime plan artifactRemovals[%d] commands[%d]", removalIndex, commandIndex),
		); err != nil {
			return err
		}
	}

	return nil
}

func validateArtifactCommand(command RuntimeArtifactCommand, location string) error {
	if command.Args == nil {
		return fmt.Errorf("%s args is required", location)
	}
	if len(command.Args) == 0 {
		return fmt.Errorf("%s args must not be empty", location)
	}
	for argIndex, arg := range command.Args {
		if strings.TrimSpace(arg) == "" {
			return fmt.Errorf("%s args[%d] must be non-empty", location, argIndex)
		}
	}
	for key := range command.Env {
		if strings.TrimSpace(key) == "" {
			return fmt.Errorf("%s env keys must be non-empty", location)
		}
	}
	if command.TimeoutMs < 0 {
		return fmt.Errorf("%s timeoutMs must be greater than or equal to 0", location)
	}

	return nil
}

func validateRuntimeClient(runtimeClient RuntimeClient, clientIndex int) error {
	if strings.TrimSpace(runtimeClient.ClientID) == "" {
		return fmt.Errorf("runtime plan runtimeClients[%d].clientId is required", clientIndex)
	}
	if runtimeClient.Processes == nil {
		return fmt.Errorf("runtime plan runtimeClients[%d].processes is required", clientIndex)
	}
	if runtimeClient.Endpoints == nil {
		return fmt.Errorf("runtime plan runtimeClients[%d].endpoints is required", clientIndex)
	}

	if err := validateRuntimeClientSetup(runtimeClient.Setup, clientIndex); err != nil {
		return err
	}

	processesByKey := make(map[string]struct{}, len(runtimeClient.Processes))
	for processIndex, process := range runtimeClient.Processes {
		if err := validateRuntimeClientProcess(process, clientIndex, processIndex); err != nil {
			return err
		}

		if _, exists := processesByKey[process.ProcessKey]; exists {
			return fmt.Errorf(
				"runtime plan runtimeClients[%d].processes[%d].processKey '%s' is duplicated",
				clientIndex,
				processIndex,
				process.ProcessKey,
			)
		}
		processesByKey[process.ProcessKey] = struct{}{}
	}

	endpointsByKey := make(map[string]struct{}, len(runtimeClient.Endpoints))
	for endpointIndex, endpoint := range runtimeClient.Endpoints {
		if err := validateRuntimeClientEndpoint(endpoint, clientIndex, endpointIndex); err != nil {
			return err
		}

		if _, exists := endpointsByKey[endpoint.EndpointKey]; exists {
			return fmt.Errorf(
				"runtime plan runtimeClients[%d].endpoints[%d].endpointKey '%s' is duplicated",
				clientIndex,
				endpointIndex,
				endpoint.EndpointKey,
			)
		}
		endpointsByKey[endpoint.EndpointKey] = struct{}{}

		if strings.TrimSpace(endpoint.ProcessKey) != "" {
			if _, exists := processesByKey[endpoint.ProcessKey]; !exists {
				return fmt.Errorf(
					"runtime plan runtimeClients[%d].endpoints[%d].processKey '%s' does not reference a declared process",
					clientIndex,
					endpointIndex,
					endpoint.ProcessKey,
				)
			}
		}
	}

	return nil
}

func validateRuntimeClientSetup(setup RuntimeClientSetup, clientIndex int) error {
	if setup.Env == nil {
		return fmt.Errorf("runtime plan runtimeClients[%d].setup.env is required", clientIndex)
	}
	if setup.Files == nil {
		return fmt.Errorf("runtime plan runtimeClients[%d].setup.files is required", clientIndex)
	}

	for envKey := range setup.Env {
		if strings.TrimSpace(envKey) == "" {
			return fmt.Errorf("runtime plan runtimeClients[%d].setup.env keys must be non-empty", clientIndex)
		}
	}
	for fileIndex, file := range setup.Files {
		if strings.TrimSpace(file.FileID) == "" {
			return fmt.Errorf("runtime plan runtimeClients[%d].setup.files[%d].fileId is required", clientIndex, fileIndex)
		}
		if strings.TrimSpace(file.Path) == "" {
			return fmt.Errorf("runtime plan runtimeClients[%d].setup.files[%d].path is required", clientIndex, fileIndex)
		}
		if file.Mode < 0 {
			return fmt.Errorf("runtime plan runtimeClients[%d].setup.files[%d].mode must be greater than or equal to 0", clientIndex, fileIndex)
		}
	}

	return nil
}

func validateRuntimeClientProcess(process RuntimeClientProcessSpec, clientIndex int, processIndex int) error {
	if strings.TrimSpace(process.ProcessKey) == "" {
		return fmt.Errorf("runtime plan runtimeClients[%d].processes[%d].processKey is required", clientIndex, processIndex)
	}
	if err := validateArtifactCommand(process.Command, fmt.Sprintf("runtime plan runtimeClients[%d].processes[%d].command", clientIndex, processIndex)); err != nil {
		return err
	}
	if err := validateRuntimeClientProcessReadiness(process.Readiness, clientIndex, processIndex); err != nil {
		return err
	}
	if err := validateRuntimeClientProcessStopPolicy(process.Stop, clientIndex, processIndex); err != nil {
		return err
	}

	return nil
}

func validateRuntimeClientProcessReadiness(readiness RuntimeClientProcessReadiness, clientIndex int, processIndex int) error {
	location := fmt.Sprintf("runtime plan runtimeClients[%d].processes[%d].readiness", clientIndex, processIndex)

	switch readiness.Type {
	case "none":
		return nil
	case "tcp":
		if strings.TrimSpace(readiness.Host) == "" {
			return fmt.Errorf("%s.host is required", location)
		}
		if readiness.Port < 1 || readiness.Port > 65535 {
			return fmt.Errorf("%s.port must be between 1 and 65535", location)
		}
		if readiness.TimeoutMs <= 0 {
			return fmt.Errorf("%s.timeoutMs must be greater than zero", location)
		}
		return nil
	case "http":
		if strings.TrimSpace(readiness.URL) == "" {
			return fmt.Errorf("%s.url is required", location)
		}
		parsedURL, err := url.ParseRequestURI(readiness.URL)
		if err != nil || strings.TrimSpace(parsedURL.Scheme) == "" || strings.TrimSpace(parsedURL.Host) == "" {
			return fmt.Errorf("%s.url must be a valid absolute URL", location)
		}
		if readiness.ExpectedStatus < 100 || readiness.ExpectedStatus > 599 {
			return fmt.Errorf("%s.expectedStatus must be between 100 and 599", location)
		}
		if readiness.TimeoutMs <= 0 {
			return fmt.Errorf("%s.timeoutMs must be greater than zero", location)
		}
		return nil
	case "ws":
		if strings.TrimSpace(readiness.URL) == "" {
			return fmt.Errorf("%s.url is required", location)
		}
		parsedURL, err := url.ParseRequestURI(readiness.URL)
		if err != nil || strings.TrimSpace(parsedURL.Scheme) == "" || strings.TrimSpace(parsedURL.Host) == "" {
			return fmt.Errorf("%s.url must be a valid absolute URL", location)
		}
		if parsedURL.Scheme != "ws" && parsedURL.Scheme != "wss" {
			return fmt.Errorf("%s.url must use ws or wss scheme", location)
		}
		if readiness.TimeoutMs <= 0 {
			return fmt.Errorf("%s.timeoutMs must be greater than zero", location)
		}
		return nil
	default:
		return fmt.Errorf("%s.type '%s' is not supported", location, readiness.Type)
	}
}

func validateRuntimeClientProcessStopPolicy(stop RuntimeClientProcessStopPolicy, clientIndex int, processIndex int) error {
	location := fmt.Sprintf("runtime plan runtimeClients[%d].processes[%d].stop", clientIndex, processIndex)

	if stop.Signal != "sigterm" && stop.Signal != "sigkill" {
		return fmt.Errorf("%s.signal '%s' is not supported", location, stop.Signal)
	}
	if stop.TimeoutMs <= 0 {
		return fmt.Errorf("%s.timeoutMs must be greater than zero", location)
	}
	if stop.GracePeriodMs < 0 {
		return fmt.Errorf("%s.gracePeriodMs must be greater than or equal to zero", location)
	}

	return nil
}

func validateRuntimeClientEndpoint(endpoint RuntimeClientEndpointSpec, clientIndex int, endpointIndex int) error {
	location := fmt.Sprintf("runtime plan runtimeClients[%d].endpoints[%d]", clientIndex, endpointIndex)

	if strings.TrimSpace(endpoint.EndpointKey) == "" {
		return fmt.Errorf("%s.endpointKey is required", location)
	}

	switch endpoint.ConnectionMode {
	case "dedicated", "shared":
	default:
		return fmt.Errorf("%s.connectionMode '%s' is not supported", location, endpoint.ConnectionMode)
	}

	switch endpoint.Transport.Type {
	case "ws":
		if strings.TrimSpace(endpoint.Transport.URL) == "" {
			return fmt.Errorf("%s.transport.url is required", location)
		}
		parsedURL, err := url.ParseRequestURI(endpoint.Transport.URL)
		if err != nil || strings.TrimSpace(parsedURL.Scheme) == "" || strings.TrimSpace(parsedURL.Host) == "" {
			return fmt.Errorf("%s.transport.url must be a valid absolute URL", location)
		}
		if parsedURL.Scheme != "ws" && parsedURL.Scheme != "wss" {
			return fmt.Errorf("%s.transport.url must use ws or wss scheme", location)
		}
	default:
		return fmt.Errorf("%s.transport.type '%s' is not supported", location, endpoint.Transport.Type)
	}

	return nil
}

func validateAgentRuntime(
	agentRuntime AgentRuntime,
	agentRuntimeIndex int,
	runtimeKeys map[string]struct{},
	endpointKeysByClientID map[string]map[string]RuntimeClientEndpointSpec,
) error {
	location := fmt.Sprintf("runtime plan agentRuntimes[%d]", agentRuntimeIndex)

	if strings.TrimSpace(agentRuntime.BindingID) == "" {
		return fmt.Errorf("%s.bindingId is required", location)
	}
	if strings.TrimSpace(agentRuntime.RuntimeKey) == "" {
		return fmt.Errorf("%s.runtimeKey is required", location)
	}
	if _, exists := runtimeKeys[agentRuntime.RuntimeKey]; exists {
		return fmt.Errorf("%s.runtimeKey '%s' is duplicated", location, agentRuntime.RuntimeKey)
	}
	runtimeKeys[agentRuntime.RuntimeKey] = struct{}{}
	if strings.TrimSpace(agentRuntime.ClientID) == "" {
		return fmt.Errorf("%s.clientId is required", location)
	}
	endpointsByKey, exists := endpointKeysByClientID[agentRuntime.ClientID]
	if !exists {
		return fmt.Errorf("%s.clientId '%s' does not reference a declared runtime client", location, agentRuntime.ClientID)
	}
	if strings.TrimSpace(agentRuntime.EndpointKey) == "" {
		return fmt.Errorf("%s.endpointKey is required", location)
	}
	endpoint, exists := endpointsByKey[agentRuntime.EndpointKey]
	if !exists {
		return fmt.Errorf(
			"%s.endpointKey '%s' does not reference a declared endpoint on client '%s'",
			location,
			agentRuntime.EndpointKey,
			agentRuntime.ClientID,
		)
	}
	if endpoint.Transport.Type != "ws" {
		return fmt.Errorf(
			"%s.endpointKey '%s' on client '%s' must reference a websocket endpoint",
			location,
			agentRuntime.EndpointKey,
			agentRuntime.ClientID,
		)
	}

	return nil
}
