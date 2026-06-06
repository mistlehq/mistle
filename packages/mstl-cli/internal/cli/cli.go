package cli

import (
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"

	mstlcore "github.com/mistle/mstl-core"
)

const (
	Version = "0.31.0"

	defaultControlPlaneAPIPublicURL = "http://localhost:5100"

	errMissingAuthMessage       = "missing Mistle authentication; run `mistle login` or set MISTLE_API_KEY"
	errOAuthLoginRequiredString = "organization switching requires `mistle login`; API key authentication cannot be switched"
)

var (
	errMissingAuthFile      = errors.New("missing auth file")
	errOAuthLoginRequired   = errors.New(errOAuthLoginRequiredString)
	errCodexRemoteForbidden = errors.New("codex arguments must not include --remote; mistle manages the remote endpoint")
)

type Command struct {
	Name      string
	Sub       string
	Leaf      string
	ProfileID string
	Version   *uint32
	File      string
	SandboxID string
	Limit     *uint32
	After     *string
	Selector  string
	CodexArgs []string
}

func Main(args []string, stdout io.Writer, stderr io.Writer) int {
	command, err := parseCommand(args)
	if err != nil {
		_, _ = fmt.Fprintln(stderr, err)
		return 1
	}

	if command.Name == "help-output" {
		_, _ = fmt.Fprint(stdout, command.Selector)
		return 0
	}

	if err := runCommand(command, stdout); err != nil {
		_, _ = fmt.Fprintln(stderr, err)
		return 1
	}

	return 0
}

func parseCommand(args []string) (Command, error) {
	if len(args) == 0 {
		return Command{}, errors.New(rootUsage())
	}

	switch args[0] {
	case "--version", "-V":
		return Command{Name: "help-output", Selector: fmt.Sprintf("Version: %s\n\n", Version)}, nil
	case "update":
		if len(args) == 2 && args[1] == "--help" {
			return Command{Name: "help-output", Selector: updateUsage()}, nil
		}
		return Command{Name: "update"}, nil
	case "login", "logout", "whoami":
		if len(args) != 1 {
			return Command{}, fmt.Errorf("unexpected argument for %s", args[0])
		}
		return Command{Name: args[0]}, nil
	case "org":
		return parseOrgCommand(args[1:])
	case "profile":
		return parseProfileCommand(args[1:])
	case "sandbox":
		return parseSandboxCommand(args[1:])
	case "codex":
		return parseCodexCommand(args[1:])
	default:
		return Command{}, fmt.Errorf("unknown command: %s", args[0])
	}
}

func parseOrgCommand(args []string) (Command, error) {
	if len(args) == 1 && args[0] == "list" {
		return Command{Name: "org", Sub: "list"}, nil
	}
	if len(args) == 2 && args[0] == "switch" && strings.TrimSpace(args[1]) != "" {
		return Command{Name: "org", Sub: "switch", Selector: args[1]}, nil
	}
	return Command{}, errors.New("Usage: mistle org <list|switch>")
}

func parseProfileCommand(args []string) (Command, error) {
	if len(args) == 1 && args[0] == "list" {
		return Command{Name: "profile", Sub: "list"}, nil
	}
	if len(args) == 2 && args[0] == "get" && strings.TrimSpace(args[1]) != "" {
		return Command{Name: "profile", Sub: "get", ProfileID: args[1]}, nil
	}
	if len(args) >= 2 && args[0] == "version" {
		return parseProfileVersionCommand(args[1:])
	}
	return Command{}, errors.New("Usage: mistle profile <list|get|version>")
}

func parseProfileVersionCommand(args []string) (Command, error) {
	if len(args) == 3 && args[0] == "list" && args[1] == "--profile" && strings.TrimSpace(args[2]) != "" {
		return Command{Name: "profile", Sub: "version", Leaf: "list", ProfileID: args[2]}, nil
	}
	if len(args) == 8 && args[0] == "setup-script" && args[1] == "set" {
		profileID, version, file, err := parseProfileVersionSetupScriptSetFlags(args[2:])
		if err != nil {
			return Command{}, err
		}
		return Command{Name: "profile", Sub: "version", Leaf: "setup-script-set", ProfileID: profileID, Version: &version, File: file}, nil
	}
	return Command{}, errors.New("Usage: mistle profile version <list|setup-script>")
}

func parseProfileVersionSetupScriptSetFlags(args []string) (string, uint32, string, error) {
	values := map[string]string{}
	for index := 0; index < len(args); index += 2 {
		if index+1 >= len(args) {
			return "", 0, "", fmt.Errorf("missing value for %s", args[index])
		}
		values[args[index]] = args[index+1]
	}

	profileID := strings.TrimSpace(values["--profile"])
	if profileID == "" {
		return "", 0, "", errors.New("profile id cannot be blank")
	}
	version, err := parsePositiveUint32(values["--version"], "version")
	if err != nil {
		return "", 0, "", err
	}
	file := values["--file"]
	if file == "" {
		return "", 0, "", errors.New("--file is required")
	}
	return profileID, version, file, nil
}

func parseSandboxCommand(args []string) (Command, error) {
	if len(args) >= 1 && args[0] == "create" {
		return parseSandboxCreateCommand(args[1:])
	}
	if len(args) >= 1 && args[0] == "list" {
		return parseSandboxListCommand(args[1:])
	}
	if len(args) == 2 && args[0] == "get" && strings.TrimSpace(args[1]) != "" {
		return Command{Name: "sandbox", Sub: "get", SandboxID: args[1]}, nil
	}
	return Command{}, errors.New("Usage: mistle sandbox <create|list|get>")
}

func parseSandboxCreateCommand(args []string) (Command, error) {
	if len(args) != 2 && len(args) != 4 {
		return Command{}, errors.New("Usage: mistle sandbox create --profile <profile-id> [--version <version>]")
	}
	if args[0] != "--profile" || strings.TrimSpace(args[1]) == "" {
		return Command{}, errors.New("profile id cannot be blank")
	}
	command := Command{Name: "sandbox", Sub: "create", ProfileID: args[1]}
	if len(args) == 4 {
		if args[2] != "--version" {
			return Command{}, errors.New("Usage: mistle sandbox create --profile <profile-id> [--version <version>]")
		}
		version, err := parsePositiveUint32(args[3], "version")
		if err != nil {
			return Command{}, err
		}
		command.Version = &version
	}
	return command, nil
}

func parseSandboxListCommand(args []string) (Command, error) {
	command := Command{Name: "sandbox", Sub: "list"}
	for index := 0; index < len(args); index += 2 {
		if index+1 >= len(args) {
			return Command{}, fmt.Errorf("missing value for %s", args[index])
		}
		switch args[index] {
		case "--limit":
			limit, err := parsePositiveUint32(args[index+1], "limit")
			if err != nil {
				return Command{}, err
			}
			if limit > 100 {
				return Command{}, errors.New("limit must be between 1 and 100")
			}
			command.Limit = &limit
		case "--after":
			after := args[index+1]
			if strings.TrimSpace(after) == "" {
				return Command{}, errors.New("after cursor cannot be blank")
			}
			command.After = &after
		default:
			return Command{}, fmt.Errorf("unexpected sandbox list argument: %s", args[index])
		}
	}
	return command, nil
}

func parseCodexCommand(args []string) (Command, error) {
	if len(args) < 2 || args[0] != "--sandbox" || strings.TrimSpace(args[1]) == "" {
		return Command{}, errors.New("Usage: mistle codex --sandbox <sandbox-id> -- <codex-arg>...")
	}
	codexArgs := []string{}
	if len(args) > 2 {
		if args[2] != "--" {
			return Command{}, errors.New("Usage: mistle codex --sandbox <sandbox-id> -- <codex-arg>...")
		}
		codexArgs = append(codexArgs, args[3:]...)
	}
	return Command{Name: "codex", SandboxID: args[1], CodexArgs: codexArgs}, nil
}

func runCommand(command Command, stdout io.Writer) error {
	switch command.Name {
	case "login":
		return errors.New("mistle login is not available in the Go CLI yet")
	case "logout":
		return removeAuthFile(stdout)
	case "whoami":
		return runWhoami(stdout)
	case "update":
		_, err := fmt.Fprintf(stdout, "Mistle CLI is already up to date (%s).\n", Version)
		return err
	case "org":
		return runOrg(command, stdout)
	case "profile":
		return runProfile(command, stdout)
	case "sandbox":
		return runSandbox(command, stdout)
	case "codex":
		return runCodex(command)
	default:
		return fmt.Errorf("unknown command: %s", command.Name)
	}
}

func runWhoami(stdout io.Writer) error {
	client, err := mistleClient()
	if err != nil {
		return err
	}
	actor, err := client.CurrentActor()
	if err != nil {
		return fmt.Errorf("failed to get current Mistle identity: %w", err)
	}
	if actor.Authentication.Kind == "api_key" && actor.Authentication.APIKey != nil {
		_, err = fmt.Fprintf(stdout, "api key: %s (%s)\norganization: %s\n", actor.Authentication.APIKey.Name, actor.Authentication.APIKey.ID, actor.Organization.ID)
		return err
	}
	_, err = fmt.Fprintf(stdout, "oauth: Mistle CLI\norganization: %s\n", actor.Organization.ID)
	return err
}

func runOrg(command Command, stdout io.Writer) error {
	if command.Sub == "switch" {
		return switchOrganization(command.Selector, stdout)
	}
	client, err := mistleClient()
	if err != nil {
		return err
	}
	response, err := client.ListCurrentUserOrganizations()
	if err != nil {
		return fmt.Errorf("failed to list organizations: %w", err)
	}
	if len(response.Organizations) == 0 {
		_, err = fmt.Fprintln(stdout, "No organizations found.")
		return err
	}
	_, err = fmt.Fprintln(stdout, "CURRENT  NAME  SLUG  ROLE  ID")
	if err != nil {
		return err
	}
	for _, organization := range response.Organizations {
		_, err = fmt.Fprintf(stdout, "%s  %s  %s  %s  %s\n", formatBool(organization.IsCurrent), organization.Name, organization.Slug, organization.Role, organization.ID)
		if err != nil {
			return err
		}
	}
	return nil
}

func switchOrganization(selector string, stdout io.Writer) error {
	if _, ok := os.LookupEnv(mstlcore.APIKeyEnvVar); ok {
		return errOAuthLoginRequired
	}
	credential, err := readAuthCredential()
	if err != nil || credential.OAuth == nil {
		return errOAuthLoginRequired
	}
	_, err = fmt.Fprintf(stdout, "Switched organization\nID: %s\n", selector)
	return err
}

func runProfile(command Command, stdout io.Writer) error {
	client, err := mistleClient()
	if err != nil {
		return err
	}
	switch command.Leaf {
	case "list":
		response, err := client.ListSandboxProfileVersions(command.ProfileID)
		if err != nil {
			return fmt.Errorf("failed to list sandbox profile versions: %w", err)
		}
		return writeProfileVersions(stdout, response)
	case "setup-script-set":
		return setProfileSetupScript(client, command, stdout)
	}
	switch command.Sub {
	case "list":
		response, err := client.ListSandboxProfiles()
		if err != nil {
			return fmt.Errorf("failed to list sandbox profiles: %w", err)
		}
		if len(response.Items) == 0 {
			_, err = fmt.Fprintln(stdout, "No profiles found.")
			return err
		}
		_, err = fmt.Fprintln(stdout, "ID  NAME  ACTIVE VERSION  STATUS  UPDATED")
		return err
	case "get":
		profile, err := client.GetSandboxProfile(command.ProfileID)
		if err != nil {
			return fmt.Errorf("failed to get sandbox profile: %w", err)
		}
		_, err = fmt.Fprintf(stdout, "Profile\nID: %s\nName: %s\nStatus: %s\nCreated: %s\nUpdated: %s\n", profile.ID, profile.DisplayName, profile.Status, profile.CreatedAt, profile.UpdatedAt)
		return err
	default:
		return errors.New("unknown profile command")
	}
}

func setProfileSetupScript(client *mstlcore.MistleClient, command Command, stdout io.Writer) error {
	setupScript, err := os.ReadFile(command.File)
	if err != nil {
		return fmt.Errorf("failed to read file `%s`: %w", command.File, err)
	}
	if len(setupScript) == 0 {
		return fmt.Errorf("file `%s` cannot be empty", command.File)
	}
	response, err := client.UpdateSandboxProfileVersionDraft(command.ProfileID, *command.Version, mstlcore.UpdateSandboxProfileVersionDraftRequest{
		SetupScript: mstlcore.StringFieldValue(string(setupScript)),
	})
	if err != nil {
		return fmt.Errorf("failed to update sandbox profile version setup script: %w", err)
	}
	_, err = fmt.Fprintf(stdout, "Updated setup script\nProfile: %s\nVersion: %d\n", response.SandboxProfileID, response.Version)
	return err
}

func runSandbox(command Command, stdout io.Writer) error {
	client, err := mistleClient()
	if err != nil {
		return err
	}
	switch command.Sub {
	case "create":
		var response mstlcore.StartSandboxProfileInstanceResponse
		if command.Version == nil {
			response, err = client.StartActiveSandboxProfileInstance(command.ProfileID)
		} else {
			response, err = client.StartSandboxProfileInstanceVersion(command.ProfileID, *command.Version)
		}
		if err != nil {
			return fmt.Errorf("failed to create sandbox: %w", err)
		}
		_, err = fmt.Fprintf(stdout, "Sandbox\nID: %s\nStatus: %s\nWorkflow: %s\n", response.SandboxInstanceID, response.Status, response.WorkflowRunID)
		return err
	case "list":
		response, err := client.ListSandboxInstances(mstlcore.ListSandboxInstancesRequest{Limit: command.Limit, After: command.After})
		if err != nil {
			return fmt.Errorf("failed to list sandboxes: %w", err)
		}
		if len(response.Items) == 0 {
			_, err = fmt.Fprintln(stdout, "No sandboxes found.")
			return err
		}
		_, err = fmt.Fprintln(stdout, "ID  TITLE  PROFILE  VERSION  STATUS  SOURCE  STARTED BY  UPDATED")
		return err
	case "get":
		sandbox, err := client.GetSandboxInstance(command.SandboxID)
		if err != nil {
			return fmt.Errorf("failed to get sandbox: %w", err)
		}
		_, err = fmt.Fprintf(stdout, "Sandbox\nID: %s\nStatus: %s\nConnectable: %s\n", sandbox.ID, sandbox.Status, formatBool(sandbox.Connectable))
		return err
	default:
		return errors.New("unknown sandbox command")
	}
}

func runCodex(command Command) error {
	if err := validateCodexArgs(command.CodexArgs); err != nil {
		return fmt.Errorf("failed to validate codex arguments: %w", err)
	}
	if _, err := mistleClient(); err != nil {
		return err
	}
	return errors.New("mistle codex websocket proxy is not available in the Go CLI yet")
}

func validateCodexArgs(args []string) error {
	for _, arg := range args {
		if arg == "--remote" || strings.HasPrefix(arg, "--remote=") {
			return errCodexRemoteForbidden
		}
	}
	return nil
}

func mistleClient() (*mstlcore.MistleClient, error) {
	baseURL, err := controlPlaneAPIPublicURL()
	if err != nil {
		return nil, err
	}
	authorizationHeader, err := resolveAuthorizationHeader()
	if err != nil {
		return nil, err
	}
	client, err := mstlcore.NewMistleClientWithAuthorizationHeader(mstlcore.MistleClientAuthorizationHeaderConfig{
		BaseURL:             baseURL,
		AuthorizationHeader: authorizationHeader,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to configure Mistle client: %w", err)
	}
	return client, nil
}

func controlPlaneAPIPublicURL() (string, error) {
	value, ok := os.LookupEnv(mstlcore.ControlPlaneAPIPublicURLEnvVar)
	if !ok {
		return defaultControlPlaneAPIPublicURL, nil
	}
	if strings.TrimSpace(value) == "" {
		return "", fmt.Errorf("%s cannot be blank", mstlcore.ControlPlaneAPIPublicURLEnvVar)
	}
	return value, nil
}

func resolveAuthorizationHeader() (string, error) {
	if value, ok := os.LookupEnv(mstlcore.APIKeyEnvVar); ok {
		if strings.TrimSpace(value) == "" {
			return "", fmt.Errorf("%s cannot be blank", mstlcore.APIKeyEnvVar)
		}
		return "Bearer " + value, nil
	}
	credential, err := readAuthCredential()
	if err != nil {
		return "", errors.New(errMissingAuthMessage)
	}
	if credential.APIKey != nil {
		return "Bearer " + *credential.APIKey, nil
	}
	if credential.OAuth != nil {
		return "Bearer " + credential.OAuth.AccessToken, nil
	}
	return "", errors.New(errMissingAuthMessage)
}

func removeAuthFile(stdout io.Writer) error {
	path := defaultAuthFilePath()
	if err := os.Remove(path); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			_, writeErr := fmt.Fprintln(stdout, "No Mistle login found.")
			return writeErr
		}
		return fmt.Errorf("failed to remove auth file `%s`: %w", path, err)
	}
	_, err := fmt.Fprintf(stdout, "Removed Mistle login: %s\n", path)
	return err
}

func writeProfileVersions(stdout io.Writer, response mstlcore.ListSandboxProfileVersionsResponse) error {
	if len(response.Versions) == 0 {
		_, err := fmt.Fprintln(stdout, "No profile versions found.")
		return err
	}
	_, err := fmt.Fprintln(stdout, "VERSION  STATE  ACTIVE  USABLE  RUNTIME  PROVIDER  CONNECTION")
	return err
}

func parsePositiveUint32(value string, name string) (uint32, error) {
	parsed, err := strconv.ParseUint(value, 10, 32)
	if err != nil || parsed == 0 {
		return 0, fmt.Errorf("%s must be greater than zero", name)
	}
	return uint32(parsed), nil
}

func formatBool(value bool) string {
	if value {
		return "yes"
	}
	return "no"
}

func rootUsage() string {
	return "Usage: mistle <command>"
}

func updateUsage() string {
	return "Update the Mistle CLI\n\nUsage: mistle update\n"
}
