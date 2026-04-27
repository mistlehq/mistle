import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { systemScheduler, type TimerHandle } from "@mistle/time";
import {
  Button,
  CopyableValue,
  Field,
  FieldContent,
  FieldHeader,
  FieldLabel,
  Input,
  Notice,
  RadioGroup,
  RadioGroupItem,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@mistle/ui";
import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import { getDashboardConfig } from "../../config.js";
import { resolveApiErrorMessage } from "../api/error-message.js";
import {
  ConfiguredSecretField,
  SavingTextField,
  type SavingFieldState,
} from "../forms/configured-secret-field.js";
import { buildIntegrationCards } from "../integrations/directory-model.js";
import {
  listIntegrationDirectory,
  startGitHubAppInstallation,
  startGitHubAppManifestCreation,
  updateFormIntegrationConnection,
} from "../integrations/integrations-service.js";
import type { IntegrationConnection } from "../integrations/integrations-service.js";
import {
  ManifestJsonEditor,
  type ManifestJsonValidation,
  parseManifestJsonObject,
  validateManifestJsonObject,
} from "../integrations/manifest-json-editor.js";
import {
  type ManifestWebhookCallbackState,
  useManifestWebhookCallbackState,
} from "../integrations/manifest-webhook-callback-state.js";
import { useAppPageMeta } from "../navigation/route-meta.js";
import {
  clearPendingStatusTimeouts,
  scheduleSavedStateReset,
} from "../shared/auto-save-behavior.js";
import { openDeferredExternalWindow } from "../shared/external-window.js";
import { FormPageActionBar, FormPageSection, FormPageStack } from "../shared/form-page.js";
import { FormPageFrame, resolvePageFrameText } from "../shared/page-frame.js";
import { SectionHeader } from "../shared/section-header.js";
import { SETTINGS_INTEGRATIONS_QUERY_KEY } from "./use-integrations-directory-state.js";

type GitHubExistingAppSetupDraft = {
  appId: string;
  appSlug: string;
  clientId: string;
  clientSecret: string;
  appPrivateKeyPem: string;
  webhookSecret: string;
};

type GitHubExistingAppSetupFieldKey = keyof GitHubExistingAppSetupDraft;
type GitHubAppSetupMode = "manifest" | "existing-app";
type GitHubManifestAppOwnerKind = "personal" | "organization";

const GitHubExistingAppSetupRequiredFieldLabels = {
  appId: "App ID",
  appSlug: "App slug",
  clientId: "Client ID",
  clientSecret: "Client secret",
  appPrivateKeyPem: "App private key",
  webhookSecret: "Webhook secret",
} as const;

const GitHubExistingAppSetupFieldKeys = [
  "appId",
  "appSlug",
  "clientId",
  "clientSecret",
  "appPrivateKeyPem",
  "webhookSecret",
] as const satisfies readonly GitHubExistingAppSetupFieldKey[];

const GitHubExistingAppSetupConfigFieldKeys = [
  "appId",
  "appSlug",
  "clientId",
] as const satisfies readonly GitHubExistingAppSetupFieldKey[];

type GitHubExistingAppSetupConfigFieldKey = (typeof GitHubExistingAppSetupConfigFieldKeys)[number];

const GitHubExistingAppSetupSecretFieldKeys = [
  "clientSecret",
  "appPrivateKeyPem",
  "webhookSecret",
] as const satisfies readonly GitHubExistingAppSetupFieldKey[];

type GitHubExistingAppSetupSecretFieldKey = (typeof GitHubExistingAppSetupSecretFieldKeys)[number];

const GitHubDraftManifest = JSON.stringify(
  {
    name: "Mistle GitHub App",
    url: "https://github.com/mistlehq/mistle",
    description: "Used in Mistle for sandbox agents",
    hook_attributes: {
      active: true,
      url: "https://mistle.example.com/api/integrations/github/webhook",
    },
    redirect_url: "https://mistle.example.com/api/integrations/github/manifest/callback",
    callback_urls: ["https://mistle.example.com/api/integrations/github/install/callback"],
    setup_url: "https://mistle.example.com/api/integrations/github/setup",
    public: false,
    default_events: [
      "issues",
      "issue_comment",
      "pull_request",
      "pull_request_review_comment",
      "check_run",
      "check_suite",
    ],
    default_permissions: {
      checks: "write",
      contents: "write",
      issues: "write",
      metadata: "read",
      pull_requests: "write",
    },
    request_oauth_on_install: false,
    setup_on_update: true,
  },
  null,
  2,
);

type GitHubExistingAppSetupTimeoutRefs = Record<
  GitHubExistingAppSetupFieldKey,
  {
    fadeStartTimeoutRef: { current: TimerHandle | null };
    fadeEndTimeoutRef: { current: TimerHandle | null };
  }
>;

function isGitHubExistingAppSetupSecretFieldKey(
  fieldKey: string,
): fieldKey is GitHubExistingAppSetupSecretFieldKey {
  return (
    fieldKey === "clientSecret" || fieldKey === "appPrivateKeyPem" || fieldKey === "webhookSecret"
  );
}

function isGitHubExistingAppSetupConfigFieldKey(
  fieldKey: GitHubExistingAppSetupFieldKey,
): fieldKey is GitHubExistingAppSetupConfigFieldKey {
  return fieldKey === "appId" || fieldKey === "appSlug" || fieldKey === "clientId";
}

function createInitialDraft(connection: IntegrationConnection): GitHubExistingAppSetupDraft {
  const config = connection.config;

  return {
    appId: typeof config?.["app_id"] === "string" ? config["app_id"] : "",
    appSlug: typeof config?.["app_slug"] === "string" ? config["app_slug"] : "",
    clientId: typeof config?.["client_id"] === "string" ? config["client_id"] : "",
    clientSecret: "",
    appPrivateKeyPem: "",
    webhookSecret: "",
  };
}

function resolveConfiguredSecretFieldKeys(
  connection: IntegrationConnection,
): ReadonlySet<GitHubExistingAppSetupSecretFieldKey> {
  const configuredSecretFieldKeys = new Set<GitHubExistingAppSetupSecretFieldKey>();

  for (const configuredSecretName of connection.configuredSecretNames ?? []) {
    if (isGitHubExistingAppSetupSecretFieldKey(configuredSecretName)) {
      configuredSecretFieldKeys.add(configuredSecretName);
    }
  }

  return configuredSecretFieldKeys;
}

function resolveInitialGitHubAppSetupMode(connection: IntegrationConnection): GitHubAppSetupMode {
  const hasConfiguredValues =
    typeof connection.config?.["app_id"] === "string" ||
    typeof connection.config?.["app_slug"] === "string" ||
    typeof connection.config?.["client_id"] === "string" ||
    (connection.configuredSecretNames?.length ?? 0) > 0;

  return hasConfiguredValues ? "existing-app" : "manifest";
}

function createInitialFieldStates(): Record<GitHubExistingAppSetupFieldKey, SavingFieldState> {
  return {
    appId: { status: "idle", errorMessage: null },
    appSlug: { status: "idle", errorMessage: null },
    clientId: { status: "idle", errorMessage: null },
    clientSecret: { status: "idle", errorMessage: null },
    appPrivateKeyPem: { status: "idle", errorMessage: null },
    webhookSecret: { status: "idle", errorMessage: null },
  };
}

function createFieldTimeoutRefs(): GitHubExistingAppSetupTimeoutRefs {
  return {
    appId: {
      fadeStartTimeoutRef: { current: null },
      fadeEndTimeoutRef: { current: null },
    },
    appSlug: {
      fadeStartTimeoutRef: { current: null },
      fadeEndTimeoutRef: { current: null },
    },
    clientId: {
      fadeStartTimeoutRef: { current: null },
      fadeEndTimeoutRef: { current: null },
    },
    clientSecret: {
      fadeStartTimeoutRef: { current: null },
      fadeEndTimeoutRef: { current: null },
    },
    appPrivateKeyPem: {
      fadeStartTimeoutRef: { current: null },
      fadeEndTimeoutRef: { current: null },
    },
    webhookSecret: {
      fadeStartTimeoutRef: { current: null },
      fadeEndTimeoutRef: { current: null },
    },
  };
}

function normalizeGitHubExistingAppSetupValue(value: string): string {
  return value.trim();
}

function hasRequiredGitHubSetupConfigValues(draft: GitHubExistingAppSetupDraft): boolean {
  return (
    normalizeGitHubExistingAppSetupValue(draft.appId).length > 0 &&
    normalizeGitHubExistingAppSetupValue(draft.appSlug).length > 0 &&
    normalizeGitHubExistingAppSetupValue(draft.clientId).length > 0
  );
}

function buildGitHubExistingAppSetupConfig(
  draft: GitHubExistingAppSetupDraft,
): Record<string, string> {
  return {
    connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
    app_id: normalizeGitHubExistingAppSetupValue(draft.appId),
    app_slug: normalizeGitHubExistingAppSetupValue(draft.appSlug),
    client_id: normalizeGitHubExistingAppSetupValue(draft.clientId),
  };
}

function buildGitHubExistingAppSetupSecrets(input: {
  draft: GitHubExistingAppSetupDraft;
  fieldKey: GitHubExistingAppSetupFieldKey;
}): Record<string, string> | undefined {
  if (input.fieldKey === "clientSecret") {
    const clientSecret = normalizeGitHubExistingAppSetupValue(input.draft.clientSecret);
    return clientSecret.length === 0 ? undefined : { clientSecret };
  }

  if (input.fieldKey === "appPrivateKeyPem") {
    return {
      appPrivateKeyPem: normalizeGitHubExistingAppSetupValue(input.draft.appPrivateKeyPem),
    };
  }

  if (input.fieldKey === "webhookSecret") {
    return {
      webhookSecret: normalizeGitHubExistingAppSetupValue(input.draft.webhookSecret),
    };
  }

  return undefined;
}

function getGitHubExistingAppSetupFieldValidationMessage(input: {
  fieldKey: GitHubExistingAppSetupFieldKey;
  draft: GitHubExistingAppSetupDraft;
}): string | null {
  const normalizedValue = normalizeGitHubExistingAppSetupValue(input.draft[input.fieldKey]);

  if (normalizedValue.length === 0) {
    return `${GitHubExistingAppSetupRequiredFieldLabels[input.fieldKey]} is required.`;
  }

  return null;
}

function shouldPersistGitHubExistingAppSetupField(input: {
  fieldKey: GitHubExistingAppSetupFieldKey;
  draft: GitHubExistingAppSetupDraft;
}): boolean {
  if (isGitHubExistingAppSetupConfigFieldKey(input.fieldKey)) {
    return hasRequiredGitHubSetupConfigValues(input.draft);
  }

  if (!hasRequiredGitHubSetupConfigValues(input.draft)) {
    return false;
  }

  return normalizeGitHubExistingAppSetupValue(input.draft[input.fieldKey]).length > 0;
}

function buildDraftWithSavedFieldValues(input: {
  baseDraft: GitHubExistingAppSetupDraft;
  draft: GitHubExistingAppSetupDraft;
  fieldKey: GitHubExistingAppSetupFieldKey;
}): GitHubExistingAppSetupDraft {
  const nextDraft: GitHubExistingAppSetupDraft = {
    ...input.baseDraft,
  };

  for (const configFieldKey of GitHubExistingAppSetupConfigFieldKeys) {
    nextDraft[configFieldKey] = normalizeGitHubExistingAppSetupValue(input.draft[configFieldKey]);
  }

  if (isGitHubExistingAppSetupSecretFieldKey(input.fieldKey)) {
    nextDraft[input.fieldKey] = normalizeGitHubExistingAppSetupValue(input.draft[input.fieldKey]);
  }

  return nextDraft;
}

function isGitHubExistingAppSetupFieldDirty(input: {
  fieldKey: GitHubExistingAppSetupFieldKey;
  draft: GitHubExistingAppSetupDraft;
  savedDraft: GitHubExistingAppSetupDraft;
}): boolean {
  return (
    normalizeGitHubExistingAppSetupValue(input.draft[input.fieldKey]) !==
    normalizeGitHubExistingAppSetupValue(input.savedDraft[input.fieldKey])
  );
}

function isGitHubExistingAppSetupFieldReadyForInstall(input: {
  fieldKey: GitHubExistingAppSetupFieldKey;
  draft: GitHubExistingAppSetupDraft;
  savedDraft: GitHubExistingAppSetupDraft;
  fieldState: SavingFieldState;
  isConfiguredOnServer?: boolean;
}): boolean {
  const normalizedDraftValue = normalizeGitHubExistingAppSetupValue(input.draft[input.fieldKey]);
  const normalizedSavedValue = normalizeGitHubExistingAppSetupValue(
    input.savedDraft[input.fieldKey],
  );

  if (
    input.isConfiguredOnServer === true &&
    normalizedDraftValue.length === 0 &&
    normalizedSavedValue.length === 0 &&
    input.fieldState.status !== "saving" &&
    input.fieldState.errorMessage === null
  ) {
    return true;
  }

  return (
    normalizedDraftValue.length > 0 &&
    normalizedSavedValue.length > 0 &&
    normalizedDraftValue === normalizedSavedValue &&
    input.fieldState.status !== "saving" &&
    input.fieldState.errorMessage === null
  );
}

function hasInstalledGitHubApp(connection: IntegrationConnection): boolean {
  return (
    typeof connection.config?.["installation_id"] === "string" ||
    typeof connection.externalSubjectId === "string"
  );
}

function submitGitHubAppManifestForm(input: {
  submissionUrl: string;
  fields: Record<string, string>;
}): void {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = input.submissionUrl;
  form.target = "_self";
  form.style.display = "none";

  for (const [name, value] of Object.entries(input.fields)) {
    const field = document.createElement("input");
    field.type = "hidden";
    field.name = name;
    field.value = value;
    form.append(field);
  }

  document.body.append(form);
  form.submit();
}

function GitHubManifestSetupPanel(input: {
  appOwnerKind: GitHubManifestAppOwnerKind | null;
  manifestValue: string;
  manifestValidation: ManifestJsonValidation;
  onAppOwnerKindChange: (value: GitHubManifestAppOwnerKind) => void;
  onManifestChange: (value: string) => void;
  onOrganizationSlugChange: (value: string) => void;
  organizationSlug: string;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        description="Create a GitHub App from a basic manifest. You can still change the settings later in GitHub."
        title="GitHub App Manifest"
      />
      <ManifestJsonEditor
        id="github-app-manifest-editor"
        onChange={input.onManifestChange}
        validation={input.manifestValidation}
        value={input.manifestValue}
      />
      <Field>
        <FieldHeader>
          <FieldLabel>Which account should the app be created in?</FieldLabel>
        </FieldHeader>
        <FieldContent>
          <RadioGroup
            aria-label="GitHub App owner"
            onValueChange={(nextValue) => {
              if (nextValue === "personal" || nextValue === "organization") {
                input.onAppOwnerKindChange(nextValue);
              }
            }}
            value={input.appOwnerKind ?? ""}
          >
            <div className="flex items-start gap-3">
              <RadioGroupItem id="github-app-owner-personal" value="personal" />
              <label className="text-sm" htmlFor="github-app-owner-personal">
                Personal account
              </label>
            </div>
            <div className="flex items-start gap-3">
              <RadioGroupItem id="github-app-owner-organization" value="organization" />
              <label className="text-sm" htmlFor="github-app-owner-organization">
                Organization
              </label>
            </div>
          </RadioGroup>
        </FieldContent>
      </Field>
      {input.appOwnerKind === "organization" ? (
        <Field>
          <FieldLabel htmlFor="github-app-owner-organization-slug" required>
            GitHub organization
          </FieldLabel>
          <Input
            id="github-app-owner-organization-slug"
            onChange={(event) => {
              input.onOrganizationSlugChange(event.currentTarget.value);
            }}
            placeholder="github-org"
            required
            value={input.organizationSlug}
          />
        </Field>
      ) : null}
    </div>
  );
}

function GitHubExistingAppSetupPanel(input: {
  configuredSecretFieldKeys: ReadonlySet<GitHubExistingAppSetupSecretFieldKey>;
  draft: GitHubExistingAppSetupDraft;
  fieldStates: Record<GitHubExistingAppSetupFieldKey, SavingFieldState>;
  onCommitField: (fieldKey: GitHubExistingAppSetupFieldKey) => void;
  onReplacementDialogOpenChange: (open: boolean) => void;
  onRevertSecretReplacement: (fieldKey: GitHubExistingAppSetupSecretFieldKey) => void;
  onUpdateFieldDraft: (fieldKey: GitHubExistingAppSetupFieldKey, nextValue: string) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <SectionHeader
          description="Paste values from a GitHub App you already created or configured in GitHub."
          title="Existing GitHub App"
        />
        <SavingTextField
          fieldState={input.fieldStates.appId}
          id="github-app-id"
          label="App ID"
          onBlur={() => {
            input.onCommitField("appId");
          }}
          onChange={(nextValue) => {
            input.onUpdateFieldDraft("appId", nextValue);
          }}
          required
          value={input.draft.appId}
        />

        <SavingTextField
          fieldState={input.fieldStates.appSlug}
          id="github-app-slug"
          label="App slug"
          onBlur={() => {
            input.onCommitField("appSlug");
          }}
          onChange={(nextValue) => {
            input.onUpdateFieldDraft("appSlug", nextValue);
          }}
          required
          value={input.draft.appSlug}
        />

        <SavingTextField
          fieldState={input.fieldStates.clientId}
          id="github-client-id"
          label="Client ID"
          onBlur={() => {
            input.onCommitField("clientId");
          }}
          onChange={(nextValue) => {
            input.onUpdateFieldDraft("clientId", nextValue);
          }}
          required
          value={input.draft.clientId}
        />
      </div>

      <div className="flex flex-col gap-4">
        <SectionHeader title="Secrets" />
        <ConfiguredSecretField
          fieldState={input.fieldStates.appPrivateKeyPem}
          secretLabel="app private key"
          id="github-app-private-key"
          label="App private key"
          multiline
          onCancelReplace={() => {
            input.onRevertSecretReplacement("appPrivateKeyPem");
          }}
          onChange={(nextValue) => {
            input.onUpdateFieldDraft("appPrivateKeyPem", nextValue);
          }}
          onCommit={() => {
            input.onCommitField("appPrivateKeyPem");
          }}
          onReplacementDialogOpenChange={input.onReplacementDialogOpenChange}
          placeholder="-----BEGIN PRIVATE KEY-----"
          configured={input.configuredSecretFieldKeys.has("appPrivateKeyPem")}
          required
          rows={8}
          value={input.draft.appPrivateKeyPem}
        />

        <ConfiguredSecretField
          fieldState={input.fieldStates.clientSecret}
          secretLabel="client secret"
          id="github-client-secret"
          label="Client secret"
          onCancelReplace={() => {
            input.onRevertSecretReplacement("clientSecret");
          }}
          onChange={(nextValue) => {
            input.onUpdateFieldDraft("clientSecret", nextValue);
          }}
          onCommit={() => {
            input.onCommitField("clientSecret");
          }}
          onReplacementDialogOpenChange={input.onReplacementDialogOpenChange}
          configured={input.configuredSecretFieldKeys.has("clientSecret")}
          required
          type="password"
          value={input.draft.clientSecret}
        />

        <ConfiguredSecretField
          fieldState={input.fieldStates.webhookSecret}
          secretLabel="webhook secret"
          id="github-webhook-secret"
          label="Webhook secret"
          onCancelReplace={() => {
            input.onRevertSecretReplacement("webhookSecret");
          }}
          onChange={(nextValue) => {
            input.onUpdateFieldDraft("webhookSecret", nextValue);
          }}
          onCommit={() => {
            input.onCommitField("webhookSecret");
          }}
          onReplacementDialogOpenChange={input.onReplacementDialogOpenChange}
          configured={input.configuredSecretFieldKeys.has("webhookSecret")}
          required
          type="password"
          value={input.draft.webhookSecret}
        />
      </div>
    </div>
  );
}

function GitHubSetupUrls(input: {
  setupCallbackUrl: string;
  webhookCallbackState: ManifestWebhookCallbackState;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        description="Copy these URLs into your GitHub App settings so Mistle can receive installation callbacks and webhook events."
        title="Hook URLs"
      />
      <div className="flex flex-col gap-4">
        <CopyableValue label="Post-installation setup URL" value={input.setupCallbackUrl} />
        {input.webhookCallbackState.kind === "loading" ? (
          <CopyableValue label="Webhook callback URL" loading />
        ) : input.webhookCallbackState.kind === "error" ? (
          <Notice title="Could not load webhook URL" variant="alert">
            {input.webhookCallbackState.message}
          </Notice>
        ) : input.webhookCallbackState.kind === "missing" ? (
          <Notice title="Webhook URL is not available yet" variant="alert">
            GitHub setup requires a webhook callback URL, but this connection does not have one yet.
          </Notice>
        ) : (
          <CopyableValue label="Webhook callback URL" value={input.webhookCallbackState.value} />
        )}
      </div>
    </div>
  );
}

function GitHubAppSetupActions(input: {
  canInstall: boolean;
  canCreateManifest: boolean;
  createManifestPending: boolean;
  isInstalled: boolean;
  isManifestMode: boolean;
  isSecretReplacementDialogOpen: boolean;
  onCreateManifest: () => void;
  onStartInstallation: () => void;
  startInstallationPending: boolean;
}): React.JSX.Element {
  return (
    <FormPageActionBar>
      {input.isManifestMode && !input.isInstalled ? (
        <Button
          disabled={!input.canCreateManifest || input.createManifestPending}
          onClick={input.onCreateManifest}
          type="button"
        >
          Create app in GitHub
        </Button>
      ) : null}
      {input.isInstalled || !input.isManifestMode ? (
        <Button
          aria-busy={input.startInstallationPending}
          disabled={
            !input.canInstall ||
            input.startInstallationPending ||
            input.isSecretReplacementDialogOpen
          }
          onClick={input.onStartInstallation}
          type="button"
        >
          {input.startInstallationPending
            ? "Starting install..."
            : input.isInstalled
              ? "Manage Installation"
              : "Install GitHub App"}
          {!input.startInstallationPending && input.isInstalled ? (
            <ArrowSquareOutIcon aria-hidden className="size-4" data-icon="inline-end" />
          ) : null}
        </Button>
      ) : null}
    </FormPageActionBar>
  );
}

export function IntegrationConnectionGitHubAppSetupPage(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const { title, description } = resolvePageFrameText(pageMeta, "Setup GitHub App");
  const targetKey = params["targetKey"];
  const connectionId = params["connectionId"];

  if (targetKey === undefined) {
    throw new Error("Integration target key is required.");
  }

  if (connectionId === undefined) {
    throw new Error("Integration connection id is required.");
  }

  const directoryQuery = useQuery({
    queryKey: SETTINGS_INTEGRATIONS_QUERY_KEY,
    queryFn: async ({ signal }) => listIntegrationDirectory({ signal }),
    retry: false,
  });

  if (directoryQuery.isError) {
    return (
      <FormPageFrame
        description={description}
        headerIcon={pageMeta.headerIcon ?? undefined}
        title={title}
      >
        <FormPageSection>
          <div className="flex flex-col gap-4 p-4">
            <Notice title="Could not load setup" variant="alert">
              {resolveApiErrorMessage({
                error: directoryQuery.error,
                fallbackMessage: "Could not load integrations.",
              })}
            </Notice>
            <div>
              <Button
                onClick={() => {
                  void navigate(`/integrations/${targetKey}`);
                }}
                type="button"
                variant="outline"
              >
                Back to integration
              </Button>
            </div>
          </div>
        </FormPageSection>
      </FormPageFrame>
    );
  }

  if (directoryQuery.isPending || directoryQuery.data === undefined) {
    return (
      <FormPageFrame
        description={description}
        headerIcon={pageMeta.headerIcon ?? undefined}
        title={title}
      >
        {null}
      </FormPageFrame>
    );
  }

  const card = buildIntegrationCards(directoryQuery.data).find(
    (candidate) => candidate.target.targetKey === targetKey,
  );
  if (card === undefined) {
    throw new Error(`Integration target '${targetKey}' was not found.`);
  }

  const connection = card.connections.find((candidate) => candidate.id === connectionId);
  if (connection === undefined) {
    throw new Error(
      `Integration connection '${connectionId}' was not found for target '${targetKey}'.`,
    );
  }

  if (connection.connectionMethodId !== IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION) {
    throw new Error(`Integration connection '${connectionId}' is not a GitHub App connection.`);
  }

  return (
    <FormPageFrame
      description={description}
      headerIcon={pageMeta.headerIcon ?? undefined}
      title={title}
    >
      <GitHubAppSetupPane
        key={connection.id}
        connection={connection}
        manifestCreationSucceeded={searchParams.get("githubAppManifest") === "created"}
      />
    </FormPageFrame>
  );
}

export function GitHubAppSetupPane(input: {
  connection: IntegrationConnection;
  manifestCreationSucceeded?: boolean;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => createInitialDraft(input.connection));
  const [savedDraft, setSavedDraft] = useState(() => createInitialDraft(input.connection));
  const [setupMode, setSetupMode] = useState<GitHubAppSetupMode>(() =>
    resolveInitialGitHubAppSetupMode(input.connection),
  );
  const [manifestValue, setManifestValue] = useState(GitHubDraftManifest);
  const [manifestAppOwnerKind, setManifestAppOwnerKind] =
    useState<GitHubManifestAppOwnerKind | null>(null);
  const [manifestOrganizationSlug, setManifestOrganizationSlug] = useState("");
  const [configuredSecretFieldKeys, setConfiguredSecretFieldKeys] = useState(() =>
    resolveConfiguredSecretFieldKeys(input.connection),
  );
  const [isSecretReplacementDialogOpen, setIsSecretReplacementDialogOpen] = useState(false);
  const [isRedirectingToInstallation, setIsRedirectingToInstallation] = useState(false);
  const [fieldStates, setFieldStates] = useState(() => createInitialFieldStates());
  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(null);
  const fieldTimeoutRefs = useRef(createFieldTimeoutRefs());
  const webhookCallbackState = useManifestWebhookCallbackState({
    enabled: setupMode === "existing-app",
    connectionId: input.connection.id,
  });

  const startInstallationMutation = useMutation({
    mutationFn: async () =>
      startGitHubAppInstallation({
        connectionId: input.connection.id,
      }),
  });
  const startManifestCreationMutation = useMutation({
    mutationFn: async () => {
      if (manifestAppOwnerKind === null) {
        throw new Error("Select where the GitHub App should be created.");
      }

      const normalizedOrganizationSlug = manifestOrganizationSlug.trim();

      return startGitHubAppManifestCreation({
        connectionId: input.connection.id,
        manifest: parseManifestJsonObject(manifestValue),
        owner:
          manifestAppOwnerKind === "personal"
            ? { kind: "personal" }
            : { kind: "organization", organizationSlug: normalizedOrganizationSlug },
      });
    },
  });

  async function startGitHubAppManifestCreationInCurrentWindow(): Promise<void> {
    setActionErrorMessage(null);

    try {
      const { fields, submissionUrl } = await startManifestCreationMutation.mutateAsync();
      submitGitHubAppManifestForm({
        submissionUrl,
        fields,
      });
    } catch (error) {
      setActionErrorMessage(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not create GitHub App manifest.",
        }),
      );
    }
  }

  async function startGitHubAppInstallationInCurrentWindow(): Promise<void> {
    setActionErrorMessage(null);

    try {
      const startedInstallation = await startInstallationMutation.mutateAsync();
      setIsRedirectingToInstallation(true);
      globalThis.location.assign(startedInstallation.authorizationUrl);
    } catch (error) {
      setIsRedirectingToInstallation(false);
      setActionErrorMessage(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not start GitHub App installation.",
        }),
      );
    }
  }

  async function startGitHubAppInstallationManagementInNewWindow(): Promise<void> {
    setActionErrorMessage(null);
    const authorizationWindow = openDeferredExternalWindow({
      loadingMessage: "Opening GitHub App installation...",
      title: "Opening GitHub App installation...",
    });
    if (authorizationWindow === null) {
      setActionErrorMessage("Browser blocked opening a new window.");
      return;
    }

    try {
      const startedInstallation = await startInstallationMutation.mutateAsync();
      authorizationWindow.navigate(startedInstallation.authorizationUrl);
    } catch (error) {
      authorizationWindow.close();
      setActionErrorMessage(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not start GitHub App installation.",
        }),
      );
    }
  }

  useEffect(() => {
    return () => {
      for (const fieldKey of GitHubExistingAppSetupFieldKeys) {
        clearPendingStatusTimeouts({
          fadeEndTimeoutRef: fieldTimeoutRefs.current[fieldKey].fadeEndTimeoutRef,
          fadeStartTimeoutRef: fieldTimeoutRefs.current[fieldKey].fadeStartTimeoutRef,
          scheduler: systemScheduler,
        });
      }
    };
  }, []);

  function resetFieldFeedback(fieldKey: GitHubExistingAppSetupFieldKey): void {
    clearPendingStatusTimeouts({
      fadeEndTimeoutRef: fieldTimeoutRefs.current[fieldKey].fadeEndTimeoutRef,
      fadeStartTimeoutRef: fieldTimeoutRefs.current[fieldKey].fadeStartTimeoutRef,
      scheduler: systemScheduler,
    });
    setFieldStates((currentFieldStates) => ({
      ...currentFieldStates,
      [fieldKey]: {
        status: "idle",
        errorMessage: null,
      },
    }));
  }

  function updateFieldDraft(fieldKey: GitHubExistingAppSetupFieldKey, nextValue: string): void {
    setDraft((currentDraft) => ({
      ...currentDraft,
      [fieldKey]: nextValue,
    }));
    setActionErrorMessage(null);
    if (fieldStates[fieldKey].status !== "idle" || fieldStates[fieldKey].errorMessage !== null) {
      resetFieldFeedback(fieldKey);
    }
  }

  async function persistField(
    fieldKey: GitHubExistingAppSetupFieldKey,
    currentDraft: GitHubExistingAppSetupDraft,
  ): Promise<void> {
    if (fieldStates[fieldKey].status === "saving") {
      return;
    }

    if (
      !isGitHubExistingAppSetupFieldDirty({
        fieldKey,
        draft: currentDraft,
        savedDraft,
      })
    ) {
      setDraft((currentDraft) => ({
        ...currentDraft,
        [fieldKey]: savedDraft[fieldKey],
      }));
      resetFieldFeedback(fieldKey);
      return;
    }

    const validationMessage = getGitHubExistingAppSetupFieldValidationMessage({
      fieldKey,
      draft: currentDraft,
    });
    if (validationMessage !== null) {
      setFieldStates((currentFieldStates) => ({
        ...currentFieldStates,
        [fieldKey]: {
          status: "idle",
          errorMessage: validationMessage,
        },
      }));
      return;
    }

    if (
      !shouldPersistGitHubExistingAppSetupField({
        fieldKey,
        draft: currentDraft,
      })
    ) {
      return;
    }

    setFieldStates((currentFieldStates) => ({
      ...currentFieldStates,
      [fieldKey]: {
        status: "saving",
        errorMessage: null,
      },
    }));

    try {
      const secrets = buildGitHubExistingAppSetupSecrets({
        draft: currentDraft,
        fieldKey,
      });

      const updatedConnection = await updateFormIntegrationConnection({
        connectionId: input.connection.id,
        displayName: input.connection.displayName,
        config: buildGitHubExistingAppSetupConfig(currentDraft),
        ...(secrets === undefined ? {} : { secrets }),
      });

      await queryClient.invalidateQueries({
        queryKey: SETTINGS_INTEGRATIONS_QUERY_KEY,
      });

      const nextSavedDraft = buildDraftWithSavedFieldValues({
        baseDraft: savedDraft,
        draft: currentDraft,
        fieldKey,
      });
      const nextDraft = buildDraftWithSavedFieldValues({
        baseDraft: currentDraft,
        draft: currentDraft,
        fieldKey,
      });

      setSavedDraft(nextSavedDraft);
      setDraft(nextDraft);
      if (isGitHubExistingAppSetupSecretFieldKey(fieldKey)) {
        setConfiguredSecretFieldKeys(resolveConfiguredSecretFieldKeys(updatedConnection));
      }
      setActionErrorMessage(null);
      setFieldStates((currentFieldStates) => ({
        ...currentFieldStates,
        [fieldKey]: {
          status: "saved",
          errorMessage: null,
        },
      }));

      scheduleSavedStateReset({
        fadeEndTimeoutRef: fieldTimeoutRefs.current[fieldKey].fadeEndTimeoutRef,
        fadeStartTimeoutRef: fieldTimeoutRefs.current[fieldKey].fadeStartTimeoutRef,
        onFadeEnd: () => {
          setFieldStates((currentFieldStates) => ({
            ...currentFieldStates,
            [fieldKey]: {
              status: "idle",
              errorMessage: null,
            },
          }));
        },
        onFadeStart: () => {
          setFieldStates((currentFieldStates) => ({
            ...currentFieldStates,
            [fieldKey]: {
              status: "saved-fading",
              errorMessage: null,
            },
          }));
        },
        scheduler: systemScheduler,
        successFadeDurationMs: 700,
        successVisibleDurationMs: 2200,
      });
    } catch (error) {
      setFieldStates((currentFieldStates) => ({
        ...currentFieldStates,
        [fieldKey]: {
          status: "idle",
          errorMessage: resolveApiErrorMessage({
            error,
            fallbackMessage: "Could not save GitHub App setup.",
          }),
        },
      }));
    }
  }

  async function commitField(fieldKey: GitHubExistingAppSetupFieldKey): Promise<void> {
    await persistField(fieldKey, draft);
  }

  function revertSecretReplacement(fieldKey: GitHubExistingAppSetupSecretFieldKey): void {
    setDraft((currentDraft) => ({
      ...currentDraft,
      [fieldKey]: "",
    }));
    resetFieldFeedback(fieldKey);
  }

  const isInstalled = hasInstalledGitHubApp(input.connection);
  const requiredConfigReady = GitHubExistingAppSetupConfigFieldKeys.every((fieldKey) =>
    isGitHubExistingAppSetupFieldReadyForInstall({
      fieldKey,
      draft,
      savedDraft,
      fieldState: fieldStates[fieldKey],
    }),
  );
  const requiredSecretsReady = GitHubExistingAppSetupSecretFieldKeys.every((fieldKey) =>
    isGitHubExistingAppSetupFieldReadyForInstall({
      fieldKey,
      draft,
      savedDraft,
      fieldState: fieldStates[fieldKey],
      isConfiguredOnServer: configuredSecretFieldKeys.has(fieldKey),
    }),
  );
  const canInstall = (requiredConfigReady && requiredSecretsReady) || isInstalled;
  const manifestValidation = validateManifestJsonObject(manifestValue);
  const canCreateManifest =
    manifestValidation.status === "valid" &&
    (manifestAppOwnerKind === "personal" ||
      (manifestAppOwnerKind === "organization" && manifestOrganizationSlug.trim().length > 0));

  if (input.manifestCreationSucceeded === true && !isInstalled) {
    return (
      <FormPageStack>
        <Notice title="GitHub App created successfully" variant="success">
          The app credentials have been saved to this Mistle connection.
        </Notice>
        <FormPageSection>
          <div className="flex flex-col gap-6 p-4">
            <SectionHeader
              description="Click Install App to open GitHub, choose the account and repositories Mistle can access, and finish linking this connection."
              size="large"
              title="Install GitHub App"
            />
            {actionErrorMessage === null ? null : (
              <Notice title="Could not continue setup" variant="alert">
                {actionErrorMessage}
              </Notice>
            )}
            <FormPageActionBar>
              <Button
                disabled={!canInstall || startInstallationMutation.isPending}
                onClick={() => {
                  void startGitHubAppInstallationInCurrentWindow();
                }}
                type="button"
              >
                Install App
              </Button>
            </FormPageActionBar>
          </div>
        </FormPageSection>
      </FormPageStack>
    );
  }

  return (
    <FormPageStack>
      <Tabs
        onValueChange={(nextValue) => {
          if (nextValue === "manifest" || nextValue === "existing-app") {
            setSetupMode(nextValue);
          }
        }}
        value={setupMode}
      >
        <SectionHeader
          className="px-1"
          description="Create a new GitHub App with a manifest or connect an app you've already configured in GitHub"
          size="large"
          title="Choose a setup method"
        />

        <FormPageSection>
          <div className="flex flex-col gap-6 p-4">
            <TabsList className="w-full">
              <TabsTrigger value="manifest">Create from manifest</TabsTrigger>
              <TabsTrigger value="existing-app">Use existing app</TabsTrigger>
            </TabsList>

            {actionErrorMessage === null ? null : (
              <Notice title="Could not continue setup" variant="alert">
                {actionErrorMessage}
              </Notice>
            )}

            <TabsContent value="manifest">
              <GitHubManifestSetupPanel
                appOwnerKind={manifestAppOwnerKind}
                manifestValidation={manifestValidation}
                manifestValue={manifestValue}
                onAppOwnerKindChange={setManifestAppOwnerKind}
                onManifestChange={setManifestValue}
                onOrganizationSlugChange={setManifestOrganizationSlug}
                organizationSlug={manifestOrganizationSlug}
              />
            </TabsContent>

            <TabsContent value="existing-app">
              <GitHubExistingAppSetupPanel
                configuredSecretFieldKeys={configuredSecretFieldKeys}
                draft={draft}
                fieldStates={fieldStates}
                onCommitField={(fieldKey) => {
                  void commitField(fieldKey);
                }}
                onReplacementDialogOpenChange={setIsSecretReplacementDialogOpen}
                onRevertSecretReplacement={revertSecretReplacement}
                onUpdateFieldDraft={updateFieldDraft}
              />
            </TabsContent>

            {setupMode === "existing-app" ? (
              <GitHubSetupUrls
                setupCallbackUrl={new URL(
                  "/p/integration/callbacks/github-app-installation",
                  getDashboardConfig().controlPlaneApiOrigin,
                ).toString()}
                webhookCallbackState={webhookCallbackState}
              />
            ) : null}

            <GitHubAppSetupActions
              canInstall={canInstall}
              isInstalled={isInstalled}
              isManifestMode={setupMode === "manifest"}
              isSecretReplacementDialogOpen={isSecretReplacementDialogOpen}
              onCreateManifest={() => {
                void startGitHubAppManifestCreationInCurrentWindow();
              }}
              onStartInstallation={() => {
                if (isInstalled) {
                  void startGitHubAppInstallationManagementInNewWindow();
                  return;
                }
                void startGitHubAppInstallationInCurrentWindow();
              }}
              canCreateManifest={canCreateManifest}
              createManifestPending={startManifestCreationMutation.isPending}
              startInstallationPending={
                startInstallationMutation.isPending || isRedirectingToInstallation
              }
            />
          </div>
        </FormPageSection>
      </Tabs>
    </FormPageStack>
  );
}
