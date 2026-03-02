package startup

import (
	"fmt"
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
	SandboxProfileID    string                       `json:"sandboxProfileId"`
	Version             int                          `json:"version"`
	Image               ResolvedSandboxImage         `json:"image"`
	EgressRoutes        []EgressCredentialRoute      `json:"egressRoutes"`
	Artifacts           []RuntimeArtifactSpec        `json:"artifacts"`
	ArtifactRemovals    []RuntimeArtifactRemovalSpec `json:"artifactRemovals"`
	RuntimeClientSetups []RuntimeClientSetup         `json:"runtimeClientSetups"`
}

type ResolvedSandboxImage struct {
	Source           string `json:"source"`
	ImageRef         string `json:"imageRef"`
	InstanceID       string `json:"instanceId"`
	SandboxProfileID string `json:"sandboxProfileId"`
	Version          int    `json:"version"`
}

type EgressCredentialRoute struct {
	RouteID            string                   `json:"routeId"`
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

type RuntimeClientSetup struct {
	ClientID   string            `json:"clientId"`
	Env        map[string]string `json:"env"`
	Files      []RuntimeFileSpec `json:"files"`
	LaunchArgs []string          `json:"launchArgs"`
}

type RuntimeFileSpec struct {
	FileID  string `json:"fileId"`
	Path    string `json:"path"`
	Mode    int    `json:"mode"`
	Content string `json:"content"`
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
	if runtimePlan.RuntimeClientSetups == nil {
		return fmt.Errorf("runtime plan runtimeClientSetups is required")
	}

	if err := validateResolvedSandboxImage(runtimePlan.Image); err != nil {
		return err
	}

	routeIDs := make(map[string]struct{}, len(runtimePlan.EgressRoutes))
	for routeIndex, route := range runtimePlan.EgressRoutes {
		if err := validateEgressRoute(route, routeIndex); err != nil {
			return err
		}

		if _, exists := routeIDs[route.RouteID]; exists {
			return fmt.Errorf("runtime plan egressRoutes[%d] routeId '%s' is duplicated", routeIndex, route.RouteID)
		}
		routeIDs[route.RouteID] = struct{}{}
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

	for setupIndex, setup := range runtimePlan.RuntimeClientSetups {
		if err := validateRuntimeClientSetup(setup, setupIndex); err != nil {
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
	if strings.TrimSpace(route.RouteID) == "" {
		return fmt.Errorf("runtime plan egressRoutes[%d] routeId is required", routeIndex)
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
	if strings.TrimSpace(route.CredentialResolver.ConnectionID) == "" {
		return fmt.Errorf("runtime plan egressRoutes[%d] credentialResolver.connectionId is required", routeIndex)
	}
	if strings.TrimSpace(route.CredentialResolver.SecretType) == "" {
		return fmt.Errorf("runtime plan egressRoutes[%d] credentialResolver.secretType is required", routeIndex)
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

func validateRuntimeClientSetup(setup RuntimeClientSetup, setupIndex int) error {
	if strings.TrimSpace(setup.ClientID) == "" {
		return fmt.Errorf("runtime plan runtimeClientSetups[%d] clientId is required", setupIndex)
	}
	if setup.Env == nil {
		return fmt.Errorf("runtime plan runtimeClientSetups[%d] env is required", setupIndex)
	}
	if setup.Files == nil {
		return fmt.Errorf("runtime plan runtimeClientSetups[%d] files is required", setupIndex)
	}

	for envKey := range setup.Env {
		if strings.TrimSpace(envKey) == "" {
			return fmt.Errorf("runtime plan runtimeClientSetups[%d] env keys must be non-empty", setupIndex)
		}
	}
	for fileIndex, file := range setup.Files {
		if strings.TrimSpace(file.FileID) == "" {
			return fmt.Errorf("runtime plan runtimeClientSetups[%d] files[%d].fileId is required", setupIndex, fileIndex)
		}
		if strings.TrimSpace(file.Path) == "" {
			return fmt.Errorf("runtime plan runtimeClientSetups[%d] files[%d].path is required", setupIndex, fileIndex)
		}
		if file.Mode < 0 {
			return fmt.Errorf("runtime plan runtimeClientSetups[%d] files[%d].mode must be greater than or equal to 0", setupIndex, fileIndex)
		}
	}

	return nil
}
