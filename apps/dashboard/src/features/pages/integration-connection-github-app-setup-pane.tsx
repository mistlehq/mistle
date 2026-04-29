import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
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
import { useState } from "react";

import { getDashboardConfig } from "../../config.js";
import { resolveApiErrorMessage } from "../api/error-message.js";
import type { SavingFieldState } from "../forms/configured-secret-field.js";
import {
  startGitHubAppInstallation,
  startGitHubAppManifestCreation,
  updateFormIntegrationConnection,
} from "../integrations/integrations-service.js";
import type { IntegrationConnection } from "../integrations/integrations-service.js";
import {
  type ManifestJsonValidation,
  parseManifestJsonObject,
  validateManifestJsonObject,
} from "../integrations/manifest-json-editor.js";
import {
  type ManifestWebhookCallbackState,
  useManifestWebhookCallbackState,
} from "../integrations/manifest-webhook-callback-state.js";
import { buildSavedFieldValuePatch } from "../shared/auto-save-behavior.js";
import { openDeferredExternalWindow } from "../shared/external-window.js";
import { FormPageActionBar, FormPageSection, FormPageStack } from "../shared/form-page.js";
import { SectionHeader } from "../shared/section-header.js";
import {
  ExistingAppSetupFieldsPanel,
  getSetupFieldState,
  useSetupFieldFeedback,
  useSetupManifestDraft,
} from "./integration-connection-app-setup-shared.js";
import {
  IntegrationConnectionSetupManifestEditorSection,
  IntegrationConnectionSetupModeTabs,
  IntegrationConnectionSetupWebhookCallbackValue,
  type IntegrationConnectionSetupMode,
} from "./integration-connection-setup-flow.js";
import type { IntegrationSetupAppManifestDraftBuilder } from "./integration-connection-setup-manifest-draft.js";
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
  manifestCallbackState: ManifestWebhookCallbackState;
  manifestValue: string;
  manifestValidation: ManifestJsonValidation;
  onAppOwnerKindChange: (value: GitHubManifestAppOwnerKind) => void;
  onManifestChange: (value: string) => void;
  onOrganizationSlugChange: (value: string) => void;
  organizationSlug: string;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <IntegrationConnectionSetupManifestEditorSection
        description="Create a GitHub App from a basic manifest. You can still change the settings later in GitHub."
        editorId="github-app-manifest-editor"
        manifestCallbackState={input.manifestCallbackState}
        manifestValidation={input.manifestValidation}
        manifestValue={input.manifestValue}
        onManifestChange={input.onManifestChange}
        title="GitHub App Manifest"
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
  manifestDraftBuilder: IntegrationSetupAppManifestDraftBuilder;
  manifestCreationSucceeded?: boolean;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => createInitialDraft(input.connection));
  const [savedDraft, setSavedDraft] = useState(() => createInitialDraft(input.connection));
  const [setupMode, setSetupMode] = useState<GitHubAppSetupMode>(() =>
    resolveInitialGitHubAppSetupMode(input.connection),
  );
  const [manifestAppOwnerKind, setManifestAppOwnerKind] =
    useState<GitHubManifestAppOwnerKind | null>(null);
  const [manifestOrganizationSlug, setManifestOrganizationSlug] = useState("");
  const [configuredSecretFieldKeys, setConfiguredSecretFieldKeys] = useState(() =>
    resolveConfiguredGitHubSecretFieldKeys(input.connection),
  );
  const [isSecretReplacementDialogOpen, setIsSecretReplacementDialogOpen] = useState(false);
  const [isRedirectingToInstallation, setIsRedirectingToInstallation] = useState(false);
  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(null);
  const fieldFeedback = useSetupFieldFeedback(GitHubExistingAppSetupFieldKeys);
  const webhookCallbackState = useManifestWebhookCallbackState({
    enabled: true,
    connectionId: input.connection.id,
  });
  const manifestDraft = useSetupManifestDraft({
    manifestDraftBuilder: input.manifestDraftBuilder,
    webhookCallbackState,
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
        manifest: parseManifestJsonObject(manifestDraft.manifestValue),
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

  function updateFieldDraft(fieldKey: GitHubExistingAppSetupFieldKey, nextValue: string): void {
    setDraft((currentDraft) => ({
      ...currentDraft,
      [fieldKey]: nextValue,
    }));
    setActionErrorMessage(null);
    const fieldState = getSetupFieldState(fieldFeedback.fieldStates, fieldKey);
    if (fieldState.status !== "idle" || fieldState.errorMessage !== null) {
      fieldFeedback.resetFieldFeedback(fieldKey);
    }
  }

  async function persistField(
    fieldKey: GitHubExistingAppSetupFieldKey,
    currentDraft: GitHubExistingAppSetupDraft,
  ): Promise<void> {
    if (getSetupFieldState(fieldFeedback.fieldStates, fieldKey).status === "saving") {
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
      fieldFeedback.resetFieldFeedback(fieldKey);
      return;
    }

    const validationMessage = getGitHubExistingAppSetupFieldValidationMessage({
      fieldKey,
      draft: currentDraft,
    });
    if (validationMessage !== null) {
      fieldFeedback.setFieldError(fieldKey, validationMessage);
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

    fieldFeedback.setFieldSaving(fieldKey);

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
      fieldFeedback.markFieldSavedWithReset(fieldKey);
    } catch (error) {
      fieldFeedback.setFieldError(
        fieldKey,
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not save GitHub App setup.",
        }),
      );
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
    fieldFeedback.resetFieldFeedback(fieldKey);
  }

  const isInstalled = hasInstalledGitHubApp(input.connection);
  const requiredConfigReady = GitHubExistingAppSetupConfigFieldKeys.every((fieldKey) =>
    isGitHubExistingAppSetupFieldReadyForInstall({
      fieldKey,
      draft,
      savedDraft,
      fieldState: getSetupFieldState(fieldFeedback.fieldStates, fieldKey),
    }),
  );
  const requiredSecretsReady = GitHubExistingAppSetupSecretFieldKeys.every((fieldKey) =>
    isGitHubExistingAppSetupFieldReadyForInstall({
      fieldKey,
      draft,
      savedDraft,
      fieldState: getSetupFieldState(fieldFeedback.fieldStates, fieldKey),
      isConfiguredOnServer: configuredSecretFieldKeys.has(fieldKey),
    }),
  );
  const canInstall = (requiredConfigReady && requiredSecretsReady) || isInstalled;
  const manifestValidation = validateManifestJsonObject(manifestDraft.manifestValue);
  const canCreateManifest =
    manifestValidation.status === "valid" &&
    webhookCallbackState.kind === "ready" &&
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
          <ExistingAppSetupFieldsPanel
            configFields={[
              {
                fieldKey: "appId",
                id: "github-app-id",
                label: GitHubExistingAppSetupRequiredFieldLabels.appId,
                required: true,
                value: draft.appId,
              },
              {
                fieldKey: "appSlug",
                id: "github-app-slug",
                label: GitHubExistingAppSetupRequiredFieldLabels.appSlug,
                required: true,
                value: draft.appSlug,
              },
              {
                fieldKey: "clientId",
                id: "github-client-id",
                label: GitHubExistingAppSetupRequiredFieldLabels.clientId,
                required: true,
                value: draft.clientId,
              },
            ]}
            description="Paste values from a GitHub App you already created or configured in GitHub."
            fieldStates={fieldFeedback.fieldStates}
            onCommitField={(fieldKey) => {
              void commitField(fieldKey);
            }}
            onReplacementDialogOpenChange={setIsSecretReplacementDialogOpen}
            onRevertSecretReplacement={revertSecretReplacement}
            onUpdateFieldDraft={updateFieldDraft}
            secretFields={[
              {
                configured: configuredSecretFieldKeys.has("appPrivateKeyPem"),
                fieldKey: "appPrivateKeyPem",
                id: "github-app-private-key",
                label: GitHubExistingAppSetupRequiredFieldLabels.appPrivateKeyPem,
                multiline: true,
                placeholder: "-----BEGIN PRIVATE KEY-----",
                required: true,
                rows: 8,
                secretLabel: "app private key",
                value: draft.appPrivateKeyPem,
              },
              {
                configured: configuredSecretFieldKeys.has("clientSecret"),
                fieldKey: "clientSecret",
                id: "github-client-secret",
                label: GitHubExistingAppSetupRequiredFieldLabels.clientSecret,
                required: true,
                secretLabel: "client secret",
                type: "password",
                value: draft.clientSecret,
              },
              {
                configured: configuredSecretFieldKeys.has("webhookSecret"),
                fieldKey: "webhookSecret",
                id: "github-webhook-secret",
                label: GitHubExistingAppSetupRequiredFieldLabels.webhookSecret,
                required: true,
                secretLabel: "webhook secret",
                type: "password",
                value: draft.webhookSecret,
              },
            ]}
            title="Existing GitHub App"
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
            manifestCallbackState={webhookCallbackState}
            manifestValidation={manifestValidation}
            manifestValue={manifestDraft.manifestValue}
            onAppOwnerKindChange={setManifestAppOwnerKind}
            onManifestChange={manifestDraft.onManifestChange}
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
