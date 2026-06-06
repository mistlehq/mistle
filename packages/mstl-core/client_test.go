package mstlcore

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestClientBuildsURLsFromNestedBaseURL(t *testing.T) {
	client := clientWithBaseURL(t, "https://api.example.test/control-plane/")

	assertEqual(t, client.currentActorURL().String(), "https://api.example.test/control-plane/v1/me")
	assertEqual(t, client.currentUserOrganizationsURL().String(), "https://api.example.test/control-plane/v1/me/organizations")
	assertEqual(t, client.switchOrganizationURL().String(), "https://api.example.test/control-plane/oauth/switch-organization")
}

func TestClientBuildsListSandboxProfilesURLWithAfterCursor(t *testing.T) {
	client := clientWithBaseURL(t, "https://api.example.test")
	after := "cursor/with space"

	assertEqual(t, client.listSandboxProfilesURL(&after).String(), "https://api.example.test/v1/sandbox/profiles?after=cursor%2Fwith+space")
}

func TestClientBuildsListSandboxInstancesURLWithLimitAndAfterCursor(t *testing.T) {
	client := clientWithBaseURL(t, "https://api.example.test")
	limit := uint32(50)
	after := "cursor/with space"

	assertEqual(
		t,
		client.listSandboxInstancesURL(ListSandboxInstancesRequest{Limit: &limit, After: &after}).String(),
		"https://api.example.test/v1/sandbox/instances?after=cursor%2Fwith+space&limit=50",
	)
}

func TestClientRejectsInvalidSandboxInstanceListRequests(t *testing.T) {
	client := clientWithBaseURL(t, "https://api.example.test")
	zero := uint32(0)
	tooLarge := uint32(101)
	blankAfter := " "

	_, err := client.ListSandboxInstances(ListSandboxInstancesRequest{Limit: &zero})
	assertError(t, err, "sandbox list limit must be between 1 and 100")

	_, err = client.ListSandboxInstances(ListSandboxInstancesRequest{Limit: &tooLarge})
	assertError(t, err, "sandbox list limit must be between 1 and 100")

	_, err = client.ListSandboxInstances(ListSandboxInstancesRequest{After: &blankAfter})
	assertError(t, err, "sandbox list after cursor cannot be blank")
}

func TestClientBuildsSandboxProfileAndInstanceURLs(t *testing.T) {
	client := clientWithBaseURL(t, "https://api.example.test")

	profileURL, err := client.getSandboxProfileURL("sbp_python-dev")
	requireNoError(t, err)
	assertEqual(t, profileURL.String(), "https://api.example.test/v1/sandbox/profiles/sbp_python-dev")

	versionURL, err := client.listSandboxProfileVersionsURL("sbp_python-dev")
	requireNoError(t, err)
	assertEqual(t, versionURL.String(), "https://api.example.test/v1/sandbox/profiles/sbp_python-dev/versions")

	draftURL, err := client.updateSandboxProfileVersionDraftURL("sbp_python-dev", 4)
	requireNoError(t, err)
	assertEqual(t, draftURL.String(), "https://api.example.test/v1/sandbox/profiles/sbp_python-dev/versions/4/draft")

	activeInstanceURL, err := client.startActiveSandboxProfileInstanceURL("sbp_python-dev")
	requireNoError(t, err)
	assertEqual(t, activeInstanceURL.String(), "https://api.example.test/v1/sandbox/profiles/sbp_python-dev/instances")

	versionInstanceURL, err := client.startSandboxProfileInstanceVersionURL("sbp_python-dev", 7)
	requireNoError(t, err)
	assertEqual(t, versionInstanceURL.String(), "https://api.example.test/v1/sandbox/profiles/sbp_python-dev/versions/7/instances")

	instanceURL, err := client.getSandboxInstanceURL("sbi_local-dev")
	requireNoError(t, err)
	assertEqual(t, instanceURL.String(), "https://api.example.test/v1/sandbox/instances/sbi_local-dev")

	tokenURL, err := client.createSandboxInstanceConnectionTokenURL("sbi_local-dev")
	requireNoError(t, err)
	assertEqual(t, tokenURL.String(), "https://api.example.test/v1/sandbox/instances/sbi_local-dev/connection-tokens")
}

func TestClientRejectsInvalidIDsAndVersions(t *testing.T) {
	client := clientWithBaseURL(t, "https://api.example.test")

	_, err := client.getSandboxProfileURL("sandbox/profile")
	assertError(t, err, "profile id must start with `sbp_`")

	_, err = client.updateSandboxProfileVersionDraftURL("sbp_python-dev", 0)
	assertError(t, err, "profile version must be greater than zero")

	_, err = client.getSandboxInstanceURL("sandbox/instance")
	assertError(t, err, "sandbox id must start with `sbi_`")
}

func TestClientTrimsRequiredConfigValues(t *testing.T) {
	client, err := NewMistleClient(MistleClientConfig{
		BaseURL: " https://api.example.test ",
		APIKey:  " mstl_test_key ",
	})
	requireNoError(t, err)

	assertEqual(t, client.currentActorURL().String(), "https://api.example.test/v1/me")
	assertEqual(t, client.authorizationHeader, "Bearer mstl_test_key")
}

func TestClientRejectsInvalidConfig(t *testing.T) {
	_, err := NewMistleClient(MistleClientConfig{BaseURL: " ", APIKey: "mstl_test_key"})
	assertError(t, err, "base URL is required")

	_, err = NewMistleClient(MistleClientConfig{BaseURL: "https://api.example.test", APIKey: " "})
	assertError(t, err, "api key is required")

	_, err = NewMistleClient(MistleClientConfig{BaseURL: "file:///tmp/mistle.sock", APIKey: "mstl_test_key"})
	assertError(t, err, "unsupported base URL scheme: file")

	_, err = NewMistleClient(MistleClientConfig{BaseURL: "https://api.example.test?workspace=local", APIKey: "mstl_test_key"})
	assertError(t, err, "base URL cannot include a query")

	_, err = NewMistleClientWithAuthorizationHeader(MistleClientAuthorizationHeaderConfig{
		BaseURL:             "https://api.example.test",
		AuthorizationHeader: " ",
	})
	assertError(t, err, "authorization header is required")
}

func TestJSONContractsForActorOrganizationsAndOAuth(t *testing.T) {
	var actor CurrentActor
	requireNoError(t, json.Unmarshal([]byte(`{
		"authentication":{"kind":"api_key","apiKey":{"id":"apk_01","name":"local"}},
		"actor":{"kind":"api_key","id":"apk_01","name":"local"},
		"organization":{"id":"org_01"},
		"permissions":["organization:api_keys:read","organization:sandboxes:read"]
	}`), &actor))
	assertEqual(t, actor.Authentication.Kind, "api_key")
	if actor.Authentication.APIKey == nil {
		t.Fatalf("expected API key authentication details")
	}
	assertEqual(t, actor.Authentication.APIKey.ID, "apk_01")
	assertEqual(t, actor.Actor.Kind, "api_key")

	var oauthActor CurrentActor
	requireNoError(t, json.Unmarshal([]byte(`{
		"authentication":{"kind":"oauth"},
		"actor":{"kind":"user","id":"usr_01"},
		"organization":{"id":"org_01"},
		"permissions":["organization:read","sandboxSession:read"]
	}`), &oauthActor))
	assertEqual(t, oauthActor.Authentication.Kind, "oauth")
	assertEqual(t, oauthActor.Actor.Kind, "user")

	var organizations CurrentUserOrganizationsResponse
	requireNoError(t, json.Unmarshal([]byte(`{"organizations":[{"id":"org_first","name":"First Organization","slug":"first","role":"owner","isCurrent":true}]}`), &organizations))
	assertEqual(t, organizations.Organizations[0].Slug, "first")

	encoded, err := json.Marshal(SwitchOrganizationRequest{OrganizationID: "org_second"})
	requireNoError(t, err)
	assertEqual(t, string(encoded), `{"organizationId":"org_second"}`)

	var token OAuthTokenResponse
	requireNoError(t, json.Unmarshal([]byte(`{"token_type":"Bearer","access_token":"mstl_oat_access","refresh_token":"mstl_ort_refresh","expires_in":3600,"scope":"organization:read sandboxSession:read"}`), &token))
	assertEqual(t, token.AccessToken, "mstl_oat_access")
}

func TestJSONContractsRejectUnknownActorKinds(t *testing.T) {
	var actor CurrentActor
	err := json.Unmarshal([]byte(`{
		"authentication":{"kind":"session"},
		"actor":{"kind":"user","id":"usr_01"},
		"organization":{"id":"org_01"},
		"permissions":["organization:read"]
	}`), &actor)

	if err == nil || !strings.Contains(err.Error(), `unknown current actor authentication kind "session"`) {
		t.Fatalf("expected unknown session authentication error, got %v", err)
	}
}

func TestJSONContractsForSandboxResponses(t *testing.T) {
	var start StartSandboxProfileInstanceResponse
	requireNoError(t, json.Unmarshal([]byte(`{"status":"accepted","workflowRunId":"wfr_01","sandboxInstanceId":"sbi_01"}`), &start))
	assertEqual(t, string(start.Status), "accepted")

	var versions ListSandboxProfileVersionsResponse
	requireNoError(t, json.Unmarshal([]byte(`{"versions":[{"sandboxProfileId":"sbp_python","version":3,"state":"draft","isActive":false,"usable":false,"agentRuntimeId":"codex","sandboxProvider":"daytona","sandboxConnectionId":"icn_daytona"}]}`), &versions))
	assertEqual(t, string(versions.Versions[0].AgentRuntimeID), "codex")

	setupScript := "#!/usr/bin/env bash\npnpm install"
	encoded, err := json.Marshal(UpdateSandboxProfileVersionDraftRequest{SetupScript: StringFieldValue(setupScript)})
	requireNoError(t, err)
	assertEqual(t, string(encoded), `{"setupScript":"#!/usr/bin/env bash\npnpm install"}`)

	encoded, err = json.Marshal(UpdateSandboxProfileVersionDraftRequest{SetupScript: StringFieldNull()})
	requireNoError(t, err)
	assertEqual(t, string(encoded), `{"setupScript":null}`)

	encoded, err = json.Marshal(UpdateSandboxProfileVersionDraftRequest{SetupScript: StringFieldUnset()})
	requireNoError(t, err)
	assertEqual(t, string(encoded), `{}`)

	var draft UpdateSandboxProfileVersionDraftResponse
	requireNoError(t, json.Unmarshal([]byte(`{"sandboxProfileId":"sbp_python","version":3,"setupScript":null,"agentRuntimeId":"opencode","sandboxProvider":null,"sandboxConnectionId":null}`), &draft))
	if draft.SetupScript != nil {
		t.Fatalf("expected null setup script to decode as nil")
	}

	var instance SandboxInstance
	requireNoError(t, json.Unmarshal([]byte(`{
		"id":"sbi_01",
		"title":"Python dev",
		"status":"running",
		"connectable":true,
		"failureCode":null,
		"failureMessage":null,
		"runtimeContext":{"agentRuntimeId":"codex","launchCwd":"/workspace","primaryRepositoryRoot":"/workspace/mistle"},
		"triggerConversation":{"conversationId":"cnv_01","routeId":null,"providerConversationId":"provider_01"},
		"startupOperation":{"operationId":"op_01","operationKind":"start"}
	}`), &instance))
	assertEqual(t, string(instance.Status), "running")
	if instance.RuntimeContext == nil || instance.RuntimeContext.AgentRuntimeID == nil {
		t.Fatalf("expected runtime context with agent runtime id")
	}
	assertEqual(t, string(*instance.RuntimeContext.AgentRuntimeID), "codex")

	var token SandboxInstanceConnectionToken
	requireNoError(t, json.Unmarshal([]byte(`{"instanceId":"sbi_01","url":"wss://gateway.example.test/tunnel/sandbox/sbi_01?connect_token=token_01","token":"token_01","expiresAt":"2026-05-18T01:02:03.000Z"}`), &token))
	assertEqual(t, token.InstanceID, "sbi_01")

	var list ListSandboxInstancesResponse
	requireNoError(t, json.Unmarshal([]byte(`{"totalResults":1,"items":[{"id":"sbi_01","sandboxProfileId":"sbp_01","title":"Python dev","sandboxProfileDisplayName":"Python Dev","sandboxProfileVersion":3,"status":"running","startedBy":{"kind":"api_key","id":"apk_01","name":"local"},"source":"dashboard","createdAt":"2026-05-18T01:02:03.000Z","updatedAt":"2026-05-18T01:03:03.000Z","failureCode":null,"failureMessage":null}],"nextPage":null,"previousPage":null}`), &list))
	assertEqual(t, string(list.Items[0].StartedBy.Kind), "api_key")
}

func clientWithBaseURL(t *testing.T, baseURL string) *MistleClient {
	t.Helper()
	client, err := NewMistleClient(MistleClientConfig{BaseURL: baseURL, APIKey: "mstl_test_key"})
	requireNoError(t, err)
	return client
}

func requireNoError(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
}

func assertError(t *testing.T, err error, expected string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected error %q, got nil", expected)
	}
	if err.Error() != expected {
		t.Fatalf("expected error %q, got %q", expected, err.Error())
	}
}

func assertEqual[T comparable](t *testing.T, actual T, expected T) {
	t.Helper()
	if actual != expected {
		t.Fatalf("expected %v, got %v", expected, actual)
	}
}
