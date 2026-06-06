package mstlcore

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

type MistleClient struct {
	authorizationHeader string
	baseURL             *url.URL
	httpClient          *http.Client
}

type MistleClientConfig struct {
	BaseURL string
	APIKey  string
}

type MistleClientAuthorizationHeaderConfig struct {
	BaseURL             string
	AuthorizationHeader string
}

func NewMistleClient(config MistleClientConfig) (*MistleClient, error) {
	baseURL, err := parseBaseURL(config.BaseURL)
	if err != nil {
		return nil, err
	}

	apiKey, err := validateRequiredString("api key is required", config.APIKey)
	if err != nil {
		return nil, err
	}

	return &MistleClient{
		authorizationHeader: "Bearer " + apiKey,
		baseURL:             baseURL,
		httpClient:          http.DefaultClient,
	}, nil
}

func NewMistleClientWithAuthorizationHeader(config MistleClientAuthorizationHeaderConfig) (*MistleClient, error) {
	baseURL, err := parseBaseURL(config.BaseURL)
	if err != nil {
		return nil, err
	}

	authorizationHeader, err := validateRequiredString("authorization header is required", config.AuthorizationHeader)
	if err != nil {
		return nil, err
	}

	return &MistleClient{
		authorizationHeader: authorizationHeader,
		baseURL:             baseURL,
		httpClient:          http.DefaultClient,
	}, nil
}

func (client *MistleClient) CurrentActor() (CurrentActor, error) {
	var response CurrentActor
	err := client.getJSON(client.currentActorURL().String(), &response)
	return response, err
}

func (client *MistleClient) ListCurrentUserOrganizations() (CurrentUserOrganizationsResponse, error) {
	var response CurrentUserOrganizationsResponse
	err := client.getJSON(client.currentUserOrganizationsURL().String(), &response)
	return response, err
}

func (client *MistleClient) SwitchOrganization(request SwitchOrganizationRequest) (OAuthTokenResponse, error) {
	var response OAuthTokenResponse
	err := client.postJSON(client.switchOrganizationURL().String(), request, &response)
	return response, err
}

func (client *MistleClient) ListSandboxProfiles() (ListSandboxProfilesResponse, error) {
	page, err := client.listSandboxProfilesPage(nil)
	if err != nil {
		return ListSandboxProfilesResponse{}, err
	}

	totalResults := page.TotalResults
	items := page.Items
	nextPage := page.NextPage

	for nextPage != nil {
		if nextPage.After == nil {
			return ListSandboxProfilesResponse{}, errors.New("invalid response: profile list next page is missing its `after` cursor")
		}

		page, err = client.listSandboxProfilesPage(nextPage.After)
		if err != nil {
			return ListSandboxProfilesResponse{}, err
		}
		items = append(items, page.Items...)
		nextPage = page.NextPage
	}

	return ListSandboxProfilesResponse{
		TotalResults: totalResults,
		Items:        items,
		NextPage:     nil,
		PreviousPage: nil,
	}, nil
}

func (client *MistleClient) GetSandboxProfile(profileID string) (SandboxProfile, error) {
	requestURL, err := client.getSandboxProfileURL(profileID)
	if err != nil {
		return SandboxProfile{}, err
	}

	var response SandboxProfile
	err = client.getJSON(requestURL.String(), &response)
	return response, err
}

func (client *MistleClient) ListSandboxProfileVersions(profileID string) (ListSandboxProfileVersionsResponse, error) {
	requestURL, err := client.listSandboxProfileVersionsURL(profileID)
	if err != nil {
		return ListSandboxProfileVersionsResponse{}, err
	}

	var response ListSandboxProfileVersionsResponse
	err = client.getJSON(requestURL.String(), &response)
	return response, err
}

func (client *MistleClient) UpdateSandboxProfileVersionDraft(profileID string, version uint32, request UpdateSandboxProfileVersionDraftRequest) (UpdateSandboxProfileVersionDraftResponse, error) {
	requestURL, err := client.updateSandboxProfileVersionDraftURL(profileID, version)
	if err != nil {
		return UpdateSandboxProfileVersionDraftResponse{}, err
	}

	var response UpdateSandboxProfileVersionDraftResponse
	err = client.putJSON(requestURL.String(), request, &response)
	return response, err
}

func (client *MistleClient) StartActiveSandboxProfileInstance(profileID string) (StartSandboxProfileInstanceResponse, error) {
	requestURL, err := client.startActiveSandboxProfileInstanceURL(profileID)
	if err != nil {
		return StartSandboxProfileInstanceResponse{}, err
	}

	var response StartSandboxProfileInstanceResponse
	err = client.postJSON(requestURL.String(), struct{}{}, &response)
	return response, err
}

func (client *MistleClient) StartSandboxProfileInstanceVersion(profileID string, version uint32) (StartSandboxProfileInstanceResponse, error) {
	requestURL, err := client.startSandboxProfileInstanceVersionURL(profileID, version)
	if err != nil {
		return StartSandboxProfileInstanceResponse{}, err
	}

	var response StartSandboxProfileInstanceResponse
	err = client.postJSON(requestURL.String(), struct{}{}, &response)
	return response, err
}

func (client *MistleClient) GetSandboxInstance(sandboxID string) (SandboxInstance, error) {
	requestURL, err := client.getSandboxInstanceURL(sandboxID)
	if err != nil {
		return SandboxInstance{}, err
	}

	var response SandboxInstance
	err = client.getJSON(requestURL.String(), &response)
	return response, err
}

func (client *MistleClient) CreateSandboxInstanceConnectionToken(sandboxID string) (SandboxInstanceConnectionToken, error) {
	requestURL, err := client.createSandboxInstanceConnectionTokenURL(sandboxID)
	if err != nil {
		return SandboxInstanceConnectionToken{}, err
	}

	var response SandboxInstanceConnectionToken
	err = client.postJSON(requestURL.String(), struct{}{}, &response)
	return response, err
}

func (client *MistleClient) ListSandboxInstances(request ListSandboxInstancesRequest) (ListSandboxInstancesResponse, error) {
	if err := validateListSandboxInstancesRequest(request); err != nil {
		return ListSandboxInstancesResponse{}, err
	}

	var response ListSandboxInstancesResponse
	err := client.getJSON(client.listSandboxInstancesURL(request).String(), &response)
	return response, err
}

func (client *MistleClient) listSandboxProfilesPage(after *string) (ListSandboxProfilesResponse, error) {
	var response ListSandboxProfilesResponse
	err := client.getJSON(client.listSandboxProfilesURL(after).String(), &response)
	return response, err
}

func (client *MistleClient) getJSON(requestURL string, output any) error {
	request, err := http.NewRequest(http.MethodGet, requestURL, nil)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	request.Header.Set("authorization", client.authorizationHeader)
	return client.doJSON(request, output)
}

func (client *MistleClient) putJSON(requestURL string, body any, output any) error {
	return client.writeJSON(http.MethodPut, requestURL, body, output)
}

func (client *MistleClient) postJSON(requestURL string, body any, output any) error {
	return client.writeJSON(http.MethodPost, requestURL, body, output)
}

func (client *MistleClient) writeJSON(method string, requestURL string, body any, output any) error {
	requestBody, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("failed to encode request: %w", err)
	}

	request, err := http.NewRequest(method, requestURL, bytes.NewReader(requestBody))
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	request.Header.Set("authorization", client.authorizationHeader)
	request.Header.Set("content-type", "application/json")

	return client.doJSON(request, output)
}

func (client *MistleClient) doJSON(request *http.Request, output any) error {
	response, err := client.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer response.Body.Close()

	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		return fmt.Errorf("failed to read response: %w", err)
	}

	if err := json.Unmarshal(responseBody, output); err != nil {
		return fmt.Errorf("failed to decode response: %w", err)
	}

	return nil
}

func (client *MistleClient) currentActorURL() *url.URL {
	return endpointURL(client.baseURL, "/v1/me")
}

func (client *MistleClient) currentUserOrganizationsURL() *url.URL {
	return endpointURL(client.baseURL, "/v1/me/organizations")
}

func (client *MistleClient) switchOrganizationURL() *url.URL {
	return endpointURL(client.baseURL, "/oauth/switch-organization")
}

func (client *MistleClient) listSandboxProfilesURL(after *string) *url.URL {
	requestURL := endpointURL(client.baseURL, "/v1/sandbox/profiles")
	if after != nil {
		query := requestURL.Query()
		query.Set("after", *after)
		requestURL.RawQuery = query.Encode()
	}
	return requestURL
}

func (client *MistleClient) getSandboxProfileURL(profileID string) (*url.URL, error) {
	validatedProfileID, err := validateSandboxProfileID(profileID)
	if err != nil {
		return nil, err
	}
	return endpointURL(client.baseURL, "/v1/sandbox/profiles/"+validatedProfileID), nil
}

func (client *MistleClient) listSandboxProfileVersionsURL(profileID string) (*url.URL, error) {
	validatedProfileID, err := validateSandboxProfileID(profileID)
	if err != nil {
		return nil, err
	}
	return endpointURL(client.baseURL, "/v1/sandbox/profiles/"+validatedProfileID+"/versions"), nil
}

func (client *MistleClient) updateSandboxProfileVersionDraftURL(profileID string, version uint32) (*url.URL, error) {
	validatedProfileID, err := validateSandboxProfileID(profileID)
	if err != nil {
		return nil, err
	}
	if err := validateSandboxProfileVersion(version); err != nil {
		return nil, err
	}
	return endpointURL(client.baseURL, fmt.Sprintf("/v1/sandbox/profiles/%s/versions/%d/draft", validatedProfileID, version)), nil
}

func (client *MistleClient) startActiveSandboxProfileInstanceURL(profileID string) (*url.URL, error) {
	validatedProfileID, err := validateSandboxProfileID(profileID)
	if err != nil {
		return nil, err
	}
	return endpointURL(client.baseURL, "/v1/sandbox/profiles/"+validatedProfileID+"/instances"), nil
}

func (client *MistleClient) startSandboxProfileInstanceVersionURL(profileID string, version uint32) (*url.URL, error) {
	validatedProfileID, err := validateSandboxProfileID(profileID)
	if err != nil {
		return nil, err
	}
	if err := validateSandboxProfileVersion(version); err != nil {
		return nil, err
	}
	return endpointURL(client.baseURL, fmt.Sprintf("/v1/sandbox/profiles/%s/versions/%d/instances", validatedProfileID, version)), nil
}

func (client *MistleClient) getSandboxInstanceURL(sandboxID string) (*url.URL, error) {
	validatedSandboxID, err := validateSandboxInstanceID(sandboxID)
	if err != nil {
		return nil, err
	}
	return endpointURL(client.baseURL, "/v1/sandbox/instances/"+validatedSandboxID), nil
}

func (client *MistleClient) createSandboxInstanceConnectionTokenURL(sandboxID string) (*url.URL, error) {
	validatedSandboxID, err := validateSandboxInstanceID(sandboxID)
	if err != nil {
		return nil, err
	}
	return endpointURL(client.baseURL, "/v1/sandbox/instances/"+validatedSandboxID+"/connection-tokens"), nil
}

func (client *MistleClient) listSandboxInstancesURL(request ListSandboxInstancesRequest) *url.URL {
	requestURL := endpointURL(client.baseURL, "/v1/sandbox/instances")
	query := requestURL.Query()
	if request.Limit != nil {
		query.Set("limit", fmt.Sprintf("%d", *request.Limit))
	}
	if request.After != nil {
		query.Set("after", *request.After)
	}
	requestURL.RawQuery = query.Encode()
	return requestURL
}

type CurrentActor struct {
	Authentication CurrentActorAuthentication `json:"authentication"`
	Actor          CurrentActorIdentity       `json:"actor"`
	Organization   CurrentActorOrganization   `json:"organization"`
	Permissions    []string                   `json:"permissions"`
}

type CurrentActorAuthentication struct {
	Kind   string              `json:"kind"`
	APIKey *CurrentActorAPIKey `json:"apiKey,omitempty"`
}

func (authentication *CurrentActorAuthentication) UnmarshalJSON(input []byte) error {
	var raw struct {
		Kind   string              `json:"kind"`
		APIKey *CurrentActorAPIKey `json:"apiKey"`
	}
	if err := json.Unmarshal(input, &raw); err != nil {
		return err
	}

	switch raw.Kind {
	case "api_key":
		*authentication = CurrentActorAuthentication{Kind: raw.Kind, APIKey: raw.APIKey}
	case "oauth":
		*authentication = CurrentActorAuthentication{Kind: raw.Kind}
	default:
		return fmt.Errorf("unknown current actor authentication kind %q", raw.Kind)
	}
	return nil
}

type CurrentActorAPIKey struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type CurrentActorIdentity struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
	Name string `json:"name,omitempty"`
}

func (identity *CurrentActorIdentity) UnmarshalJSON(input []byte) error {
	type rawCurrentActorIdentity CurrentActorIdentity
	var raw rawCurrentActorIdentity
	if err := json.Unmarshal(input, &raw); err != nil {
		return err
	}
	switch raw.Kind {
	case "api_key", "user":
		*identity = CurrentActorIdentity(raw)
	default:
		return fmt.Errorf("unknown current actor identity kind %q", raw.Kind)
	}
	return nil
}

type CurrentActorOrganization struct {
	ID string `json:"id"`
}

type CurrentUserOrganizationsResponse struct {
	Organizations []CurrentUserOrganization `json:"organizations"`
}

type CurrentUserOrganization struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Slug      string `json:"slug"`
	Role      string `json:"role"`
	IsCurrent bool   `json:"isCurrent"`
}

type SwitchOrganizationRequest struct {
	OrganizationID string `json:"organizationId"`
}

type OAuthTokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    uint64 `json:"expires_in"`
	Scope        string `json:"scope"`
}

type ListSandboxProfilesResponse struct {
	TotalResults uint32           `json:"totalResults"`
	Items        []SandboxProfile `json:"items"`
	NextPage     *KeysetPage      `json:"nextPage"`
	PreviousPage *KeysetPage      `json:"previousPage"`
}

type SandboxProfile struct {
	ID            string               `json:"id"`
	DisplayName   string               `json:"displayName"`
	ActiveVersion *uint32              `json:"activeVersion"`
	Status        SandboxProfileStatus `json:"status"`
	CreatedAt     string               `json:"createdAt"`
	UpdatedAt     string               `json:"updatedAt"`
}

type SandboxProfileStatus string

const (
	SandboxProfileStatusActive   SandboxProfileStatus = "active"
	SandboxProfileStatusInactive SandboxProfileStatus = "inactive"
)

type ListSandboxProfileVersionsResponse struct {
	Versions []SandboxProfileVersion `json:"versions"`
}

type SandboxProfileVersion struct {
	SandboxProfileID    string                              `json:"sandboxProfileId"`
	Version             uint32                              `json:"version"`
	State               SandboxProfileVersionState          `json:"state"`
	IsActive            bool                                `json:"isActive"`
	Usable              bool                                `json:"usable"`
	AgentRuntimeID      SandboxProfileVersionAgentRuntimeID `json:"agentRuntimeId"`
	SandboxProvider     *string                             `json:"sandboxProvider"`
	SandboxConnectionID *string                             `json:"sandboxConnectionId"`
}

type SandboxProfileVersionState string

const (
	SandboxProfileVersionStateDraft     SandboxProfileVersionState = "draft"
	SandboxProfileVersionStatePublished SandboxProfileVersionState = "published"
)

type SandboxProfileVersionAgentRuntimeID string

const (
	SandboxProfileVersionAgentRuntimeIDCodex    SandboxProfileVersionAgentRuntimeID = "codex"
	SandboxProfileVersionAgentRuntimeIDOpenCode SandboxProfileVersionAgentRuntimeID = "opencode"
)

type UpdateSandboxProfileVersionDraftRequest struct {
	SetupScript OptionalStringField
}

func (request UpdateSandboxProfileVersionDraftRequest) MarshalJSON() ([]byte, error) {
	fields := map[string]any{}
	if request.SetupScript.Set {
		fields["setupScript"] = request.SetupScript.Value
	}
	return json.Marshal(fields)
}

type OptionalStringField struct {
	Set   bool
	Value *string
}

func StringFieldValue(value string) OptionalStringField {
	return OptionalStringField{Set: true, Value: &value}
}

func StringFieldNull() OptionalStringField {
	return OptionalStringField{Set: true, Value: nil}
}

func StringFieldUnset() OptionalStringField {
	return OptionalStringField{}
}

type UpdateSandboxProfileVersionDraftResponse struct {
	SandboxProfileID    string                              `json:"sandboxProfileId"`
	Version             uint32                              `json:"version"`
	SetupScript         *string                             `json:"setupScript"`
	AgentRuntimeID      SandboxProfileVersionAgentRuntimeID `json:"agentRuntimeId"`
	SandboxProvider     *string                             `json:"sandboxProvider"`
	SandboxConnectionID *string                             `json:"sandboxConnectionId"`
}

type StartSandboxProfileInstanceResponse struct {
	Status            StartSandboxProfileInstanceStatus `json:"status"`
	WorkflowRunID     string                            `json:"workflowRunId"`
	SandboxInstanceID string                            `json:"sandboxInstanceId"`
}

type StartSandboxProfileInstanceStatus string

const StartSandboxProfileInstanceStatusAccepted StartSandboxProfileInstanceStatus = "accepted"

type SandboxInstance struct {
	ID                  string                              `json:"id"`
	Title               *string                             `json:"title"`
	Status              SandboxInstanceStatus               `json:"status"`
	Connectable         bool                                `json:"connectable"`
	FailureCode         *string                             `json:"failureCode"`
	FailureMessage      *string                             `json:"failureMessage"`
	RuntimeContext      *SandboxInstanceRuntimeContext      `json:"runtimeContext"`
	TriggerConversation *SandboxInstanceTriggerConversation `json:"triggerConversation"`
	StartupOperation    *SandboxInstanceStartupOperation    `json:"startupOperation"`
}

type SandboxInstanceConnectionToken struct {
	InstanceID string `json:"instanceId"`
	URL        string `json:"url"`
	Token      string `json:"token"`
	ExpiresAt  string `json:"expiresAt"`
}

type ListSandboxInstancesResponse struct {
	TotalResults uint32                    `json:"totalResults"`
	Items        []SandboxInstanceListItem `json:"items"`
	NextPage     *KeysetPage               `json:"nextPage"`
	PreviousPage *KeysetPage               `json:"previousPage"`
}

type ListSandboxInstancesRequest struct {
	Limit *uint32
	After *string
}

type SandboxInstanceListItem struct {
	ID                        string                   `json:"id"`
	SandboxProfileID          string                   `json:"sandboxProfileId"`
	Title                     *string                  `json:"title"`
	SandboxProfileDisplayName *string                  `json:"sandboxProfileDisplayName"`
	SandboxProfileVersion     uint32                   `json:"sandboxProfileVersion"`
	Status                    SandboxInstanceStatus    `json:"status"`
	StartedBy                 SandboxInstanceStartedBy `json:"startedBy"`
	Source                    SandboxInstanceSource    `json:"source"`
	CreatedAt                 string                   `json:"createdAt"`
	UpdatedAt                 string                   `json:"updatedAt"`
	FailureCode               *string                  `json:"failureCode"`
	FailureMessage            *string                  `json:"failureMessage"`
}

type SandboxInstanceStartedBy struct {
	Kind string  `json:"kind"`
	ID   string  `json:"id"`
	Name *string `json:"name"`
}

func (startedBy *SandboxInstanceStartedBy) UnmarshalJSON(input []byte) error {
	type rawSandboxInstanceStartedBy SandboxInstanceStartedBy
	var raw rawSandboxInstanceStartedBy
	if err := json.Unmarshal(input, &raw); err != nil {
		return err
	}
	switch raw.Kind {
	case "user", "api_key", "system":
		*startedBy = SandboxInstanceStartedBy(raw)
	default:
		return fmt.Errorf("unknown sandbox started-by kind %q", raw.Kind)
	}
	return nil
}

type SandboxInstanceSource string

const (
	SandboxInstanceSourceDashboard SandboxInstanceSource = "dashboard"
	SandboxInstanceSourceWebhook   SandboxInstanceSource = "webhook"
	SandboxInstanceSourceSchedule  SandboxInstanceSource = "schedule"
)

type SandboxInstanceStatus string

const (
	SandboxInstanceStatusPending      SandboxInstanceStatus = "pending"
	SandboxInstanceStatusStarting     SandboxInstanceStatus = "starting"
	SandboxInstanceStatusStarted      SandboxInstanceStatus = "started"
	SandboxInstanceStatusInitializing SandboxInstanceStatus = "initializing"
	SandboxInstanceStatusRunning      SandboxInstanceStatus = "running"
	SandboxInstanceStatusReconnecting SandboxInstanceStatus = "reconnecting"
	SandboxInstanceStatusStopping     SandboxInstanceStatus = "stopping"
	SandboxInstanceStatusStopped      SandboxInstanceStatus = "stopped"
	SandboxInstanceStatusFailed       SandboxInstanceStatus = "failed"
)

type SandboxInstanceRuntimeContext struct {
	AgentRuntimeID        *SandboxInstanceAgentRuntimeID `json:"agentRuntimeId"`
	LaunchCWD             *string                        `json:"launchCwd"`
	PrimaryRepositoryRoot *string                        `json:"primaryRepositoryRoot"`
}

type SandboxInstanceAgentRuntimeID string

const (
	SandboxInstanceAgentRuntimeIDCodex    SandboxInstanceAgentRuntimeID = "codex"
	SandboxInstanceAgentRuntimeIDOpenCode SandboxInstanceAgentRuntimeID = "opencode"
)

type SandboxInstanceTriggerConversation struct {
	ConversationID         string  `json:"conversationId"`
	RouteID                *string `json:"routeId"`
	ProviderConversationID *string `json:"providerConversationId"`
}

type SandboxInstanceStartupOperation struct {
	OperationID   string                              `json:"operationId"`
	OperationKind SandboxInstanceStartupOperationKind `json:"operationKind"`
}

type SandboxInstanceStartupOperationKind string

const (
	SandboxInstanceStartupOperationKindStart  SandboxInstanceStartupOperationKind = "start"
	SandboxInstanceStartupOperationKindResume SandboxInstanceStartupOperationKind = "resume"
)

type KeysetPage struct {
	Limit  uint32  `json:"limit"`
	After  *string `json:"after"`
	Before *string `json:"before"`
}

func parseBaseURL(baseURL string) (*url.URL, error) {
	trimmedBaseURL, err := validateRequiredString("base URL is required", baseURL)
	if err != nil {
		return nil, err
	}

	parsedURL, err := url.Parse(trimmedBaseURL)
	if err != nil {
		return nil, fmt.Errorf("invalid base URL: %w", err)
	}

	if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
		return nil, fmt.Errorf("unsupported base URL scheme: %s", parsedURL.Scheme)
	}
	if parsedURL.RawQuery != "" {
		return nil, errors.New("base URL cannot include a query")
	}
	if parsedURL.Fragment != "" {
		return nil, errors.New("base URL cannot include a fragment")
	}

	return parsedURL, nil
}

func validateRequiredString(errorMessage string, value string) (string, error) {
	trimmedValue := strings.TrimSpace(value)
	if trimmedValue == "" {
		return "", errors.New(errorMessage)
	}
	return trimmedValue, nil
}

func validateSandboxProfileID(profileID string) (string, error) {
	trimmedProfileID := strings.TrimSpace(profileID)
	if trimmedProfileID == "" {
		return "", errors.New("profile id is required")
	}
	if !strings.HasPrefix(trimmedProfileID, "sbp_") {
		return "", errors.New("profile id must start with `sbp_`")
	}
	if !isASCIIIdentifier(trimmedProfileID) {
		return "", errors.New("profile id can only contain ASCII letters, numbers, underscores, and hyphens")
	}
	return trimmedProfileID, nil
}

func validateSandboxProfileVersion(version uint32) error {
	if version == 0 {
		return errors.New("profile version must be greater than zero")
	}
	return nil
}

func validateSandboxInstanceID(sandboxID string) (string, error) {
	trimmedSandboxID := strings.TrimSpace(sandboxID)
	if trimmedSandboxID == "" {
		return "", errors.New("sandbox id is required")
	}
	if !strings.HasPrefix(trimmedSandboxID, "sbi_") {
		return "", errors.New("sandbox id must start with `sbi_`")
	}
	if !isASCIIIdentifier(trimmedSandboxID) {
		return "", errors.New("sandbox id can only contain ASCII letters, numbers, underscores, and hyphens")
	}
	return trimmedSandboxID, nil
}

func validateListSandboxInstancesRequest(request ListSandboxInstancesRequest) error {
	if request.Limit != nil && (*request.Limit < 1 || *request.Limit > 100) {
		return errors.New("sandbox list limit must be between 1 and 100")
	}
	if request.After != nil && strings.TrimSpace(*request.After) == "" {
		return errors.New("sandbox list after cursor cannot be blank")
	}
	return nil
}

func endpointURL(baseURL *url.URL, endpointPath string) *url.URL {
	requestURL := *baseURL
	basePath := strings.TrimRight(requestURL.Path, "/")
	trimmedEndpointPath := strings.TrimLeft(endpointPath, "/")
	requestURL.Path = basePath + "/" + trimmedEndpointPath
	return &requestURL
}

func isASCIIIdentifier(value string) bool {
	for _, character := range value {
		if (character >= 'a' && character <= 'z') ||
			(character >= 'A' && character <= 'Z') ||
			(character >= '0' && character <= '9') ||
			character == '_' ||
			character == '-' {
			continue
		}
		return false
	}
	return true
}
