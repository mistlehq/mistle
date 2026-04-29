import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { GitHubAppManifestTemplate } from "@mistle/integrations-definitions/browser";
import { systemScheduler } from "@mistle/time";
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
} from "@mistle/ui";
import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { getDashboardConfig } from "../../config.js";
import { resolveApiErrorMessage } from "../api/error-message.js";
import {
  ConfiguredSecretField,
  SavingTextField,
  type SavingFieldState,
} from "../forms/configured-secret-field.js";
import {
  startGitHubAppInstallation,
  startGitHubAppManifestCreation,
  updateFormIntegrationConnection,
} from "../integrations/integrations-service.js";
import type { IntegrationConnection } from "../integrations/integrations-service.js";
import {
  ManifestJsonEditor,
  type ManifestJsonValidation,
  createManifestJsonDraft,
  parseManifestJsonObject,
  validateManifestJsonObject,
} from "../integrations/manifest-json-editor.js";
import {
  type ManifestWebhookCallbackState,
  useManifestWebhookCallbackState,
} from "../integrations/manifest-webhook-callback-state.js";
import {
  buildSavedFieldValuePatch,
  clearPendingStatusTimeouts,
  createAutoSaveFieldTimeoutRefs,
  resolveAutoSaveFieldTimeoutRefs,
  scheduleSavedStateReset,
} from "../shared/auto-save-behavior.js";
import { openDeferredExternalWindow } from "../shared/external-window.js";
import { FormPageActionBar, FormPageSection, FormPageStack } from "../shared/form-page.js";
import { SectionHeader } from "../shared/section-header.js";
import {
  IntegrationConnectionSetupModeTabs,
  IntegrationConnectionSetupWebhookCallbackValue,
  type IntegrationConnectionSetupMode,
} from "./integration-connection-setup-flow.js";
import { resolveConfiguredSetupSecretFieldKeys } from "./integration-connection-setup-secret-fields.js";
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
type GitHubAppSetupMode = IntegrationConnectionSetupMode;
type GitHubManifestAppOwnerKind = "personal" | "organization";

const GitHubExistingAppSetupRequiredFieldLabels = {
  appId: "App ID",
  appSlug: "App slug",
  clientId: "Client ID",
  clientSecret: "Client secret",
  appPrivateKeyPem: "App private key",
  webhookSecret: "Webhook secret",
} satisfies Record<GitHubExistingAppSetupFieldKey, string>;

const GitHubExistingAppSetupFieldKeys = [
  "appId",
  "appSlug",
  "clientId",
  "clientSecret",
  "appPrivateKeyPem",
  "webhookSecret",
] satisfies readonly GitHubExistingAppSetupFieldKey[];

const GitHubExistingAppSetupConfigFieldKeys = [
  "appId",
  "appSlug",
  "clientId",
] satisfies readonly GitHubExistingAppSetupFieldKey[];

type GitHubExistingAppSetupConfigFieldKey = (typeof GitHubExistingAppSetupConfigFieldKeys)[number];

const GitHubExistingAppSetupSecretFieldKeys = [
  "clientSecret",
  "appPrivateKeyPem",
  "webhookSecret",
] satisfies readonly GitHubExistingAppSetupFieldKey[];

type GitHubExistingAppSetupSecretFieldKey = (typeof GitHubExistingAppSetupSecretFieldKeys)[number];

const GitHubDraftManifest = createManifestJsonDraft(GitHubAppManifestTemplate);

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

function resolveConfiguredGitHubSecretFieldKeys(
  connection: IntegrationConnection,
): ReadonlySet<GitHubExistingAppSetupSecretFieldKey> {
  return resolveConfiguredSetupSecretFieldKeys({
    configuredSecretNames: connection.configuredSecretNames,
    fieldKeys: GitHubExistingAppSetupSecretFieldKeys,
  });
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

function resolveGitHubExistingAppSetupSavedFieldKeys(
  fieldKey: GitHubExistingAppSetupFieldKey,
): ReadonlyArray<GitHubExistingAppSetupFieldKey> {
  if (isGitHubExistingAppSetupSecretFieldKey(fieldKey)) {
    return [...GitHubExistingAppSetupConfigFieldKeys, fieldKey];
  }

  return GitHubExistingAppSetupConfigFieldKeys;
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
        <IntegrationConnectionSetupWebhookCallbackValue
          errorTitle="Could not load webhook URL"
          label="Webhook callback URL"
          missingMessage="GitHub setup requires a webhook callback URL, but this connection does not have one yet."
          missingTitle="Webhook URL is not available yet"
          webhookCallbackState={input.webhookCallbackState}
        />
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
    resolveConfiguredGitHubSecretFieldKeys(input.connection),
  );
  const [isSecretReplacementDialogOpen, setIsSecretReplacementDialogOpen] = useState(false);
  const [isRedirectingToInstallation, setIsRedirectingToInstallation] = useState(false);
  const [fieldStates, setFieldStates] = useState(() => createInitialFieldStates());
  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(null);
  const fieldTimeoutRefs = useRef(
    createAutoSaveFieldTimeoutRefs({
      fieldKeys: GitHubExistingAppSetupFieldKeys,
    }),
  );
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
        const timeoutRefs = resolveAutoSaveFieldTimeoutRefs({
          timeoutRefs: fieldTimeoutRefs.current,
          fieldKey,
        });
        clearPendingStatusTimeouts({
          fadeEndTimeoutRef: timeoutRefs.fadeEndTimeoutRef,
          fadeStartTimeoutRef: timeoutRefs.fadeStartTimeoutRef,
          scheduler: systemScheduler,
        });
      }
    };
  }, []);

  function resetFieldFeedback(fieldKey: GitHubExistingAppSetupFieldKey): void {
    const timeoutRefs = resolveAutoSaveFieldTimeoutRefs({
      timeoutRefs: fieldTimeoutRefs.current,
      fieldKey,
    });
    clearPendingStatusTimeouts({
      fadeEndTimeoutRef: timeoutRefs.fadeEndTimeoutRef,
      fadeStartTimeoutRef: timeoutRefs.fadeStartTimeoutRef,
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

      const savedFieldValuePatch = buildSavedFieldValuePatch({
        draft: currentDraft,
        fieldKeys: resolveGitHubExistingAppSetupSavedFieldKeys(fieldKey),
        normalizeValue: normalizeGitHubExistingAppSetupValue,
      });
      const nextSavedDraft = {
        ...savedDraft,
        ...savedFieldValuePatch,
      };
      const nextDraft = {
        ...currentDraft,
        ...savedFieldValuePatch,
      };

      setSavedDraft(nextSavedDraft);
      setDraft(nextDraft);
      if (isGitHubExistingAppSetupSecretFieldKey(fieldKey)) {
        setConfiguredSecretFieldKeys(resolveConfiguredGitHubSecretFieldKeys(updatedConnection));
      }
      setActionErrorMessage(null);
      setFieldStates((currentFieldStates) => ({
        ...currentFieldStates,
        [fieldKey]: {
          status: "saved",
          errorMessage: null,
        },
      }));

      const timeoutRefs = resolveAutoSaveFieldTimeoutRefs({
        timeoutRefs: fieldTimeoutRefs.current,
        fieldKey,
      });
      scheduleSavedStateReset({
        fadeEndTimeoutRef: timeoutRefs.fadeEndTimeoutRef,
        fadeStartTimeoutRef: timeoutRefs.fadeStartTimeoutRef,
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
      <IntegrationConnectionSetupModeTabs
        actionErrorMessage={actionErrorMessage}
        description="Create a new GitHub App with a manifest or connect an app you've already configured in GitHub"
        existingAppContent={
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
        }
        footer={
          <>
            {setupMode === "existing-app" ? (
              <GitHubSetupUrls
                setupCallbackUrl={new URL(
                  "/p/integration/callbacks/setup/github-app-installation",
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
          </>
        }
        manifestContent={
          <GitHubManifestSetupPanel
            appOwnerKind={manifestAppOwnerKind}
            manifestValidation={manifestValidation}
            manifestValue={manifestValue}
            onAppOwnerKindChange={setManifestAppOwnerKind}
            onManifestChange={setManifestValue}
            onOrganizationSlugChange={setManifestOrganizationSlug}
            organizationSlug={manifestOrganizationSlug}
          />
        }
        onModeChange={setSetupMode}
        title="Choose a setup method"
        value={setupMode}
      />
    </FormPageStack>
  );
}
