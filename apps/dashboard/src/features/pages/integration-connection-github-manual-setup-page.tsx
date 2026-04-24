import { systemScheduler, type TimerHandle } from "@mistle/time";
import { Button, CopyableValue, Notice } from "@mistle/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";

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
  listIntegrationWebhookSources,
  startGitHubAppInstallation,
  updateFormIntegrationConnection,
} from "../integrations/integrations-service.js";
import type { IntegrationConnection } from "../integrations/integrations-service.js";
import { useAppPageMeta } from "../navigation/route-meta.js";
import {
  clearPendingStatusTimeouts,
  scheduleSavedStateReset,
} from "../shared/auto-save-behavior.js";
import { FormPageActionBar, FormPageSection, FormPageStack } from "../shared/form-page.js";
import { FormPageFrame, resolvePageFrameText } from "../shared/page-frame.js";
import { SETTINGS_INTEGRATIONS_QUERY_KEY } from "./use-integrations-directory-state.js";

type GitHubManualSetupDraft = {
  appId: string;
  appSlug: string;
  clientId: string;
  clientSecret: string;
  appPrivateKeyPem: string;
  webhookSecret: string;
};

type GitHubManualSetupFieldKey = keyof GitHubManualSetupDraft;

type GitHubManualSetupSecretFieldKey = (typeof GitHubManualSetupSecretFieldKeys)[number];

const GitHubManualSetupRequiredFieldLabels = {
  appId: "App ID",
  appSlug: "App slug",
  clientId: "Client ID",
  clientSecret: "Client secret",
  appPrivateKeyPem: "App private key",
  webhookSecret: "Webhook secret",
} as const;

const GitHubManualSetupFieldKeys: readonly GitHubManualSetupFieldKey[] = [
  "appId",
  "appSlug",
  "clientId",
  "clientSecret",
  "appPrivateKeyPem",
  "webhookSecret",
];

const GitHubManualSetupConfigFieldKeys: readonly GitHubManualSetupFieldKey[] = [
  "appId",
  "appSlug",
  "clientId",
];

const GitHubManualSetupRequiredConfigFieldKeys: readonly GitHubManualSetupFieldKey[] = [
  "appId",
  "appSlug",
  "clientId",
];

const GitHubManualSetupSecretFieldKeys: readonly GitHubManualSetupFieldKey[] = [
  "clientSecret",
  "appPrivateKeyPem",
  "webhookSecret",
];

const GitHubManualSetupRequiredSecretFieldKeys: readonly GitHubManualSetupFieldKey[] = [
  "clientSecret",
  "appPrivateKeyPem",
  "webhookSecret",
];

type GitHubManualSetupTimeoutRefs = Record<
  GitHubManualSetupFieldKey,
  {
    fadeStartTimeoutRef: { current: TimerHandle | null };
    fadeEndTimeoutRef: { current: TimerHandle | null };
  }
>;

function isGitHubManualSetupSecretFieldKey(
  fieldKey: string,
): fieldKey is GitHubManualSetupSecretFieldKey {
  return (
    fieldKey === "clientSecret" || fieldKey === "appPrivateKeyPem" || fieldKey === "webhookSecret"
  );
}

function isGitHubManualSetupConfigFieldKey(fieldKey: GitHubManualSetupFieldKey): boolean {
  return GitHubManualSetupConfigFieldKeys.includes(fieldKey);
}

function createInitialDraft(connection: IntegrationConnection): GitHubManualSetupDraft {
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
): ReadonlySet<GitHubManualSetupSecretFieldKey> {
  const configuredSecretFieldKeys = new Set<GitHubManualSetupSecretFieldKey>();

  for (const configuredSecretName of connection.configuredSecretNames ?? []) {
    if (isGitHubManualSetupSecretFieldKey(configuredSecretName)) {
      configuredSecretFieldKeys.add(configuredSecretName);
    }
  }

  return configuredSecretFieldKeys;
}

function createInitialFieldStates(): Record<GitHubManualSetupFieldKey, SavingFieldState> {
  return {
    appId: { status: "idle", errorMessage: null },
    appSlug: { status: "idle", errorMessage: null },
    clientId: { status: "idle", errorMessage: null },
    clientSecret: { status: "idle", errorMessage: null },
    appPrivateKeyPem: { status: "idle", errorMessage: null },
    webhookSecret: { status: "idle", errorMessage: null },
  };
}

function createFieldTimeoutRefs(): GitHubManualSetupTimeoutRefs {
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

function normalizeGitHubManualSetupValue(value: string): string {
  return value.trim();
}

function hasRequiredGitHubSetupConfigValues(draft: GitHubManualSetupDraft): boolean {
  return (
    normalizeGitHubManualSetupValue(draft.appId).length > 0 &&
    normalizeGitHubManualSetupValue(draft.appSlug).length > 0 &&
    normalizeGitHubManualSetupValue(draft.clientId).length > 0
  );
}

function buildGitHubManualSetupConfig(draft: GitHubManualSetupDraft): Record<string, string> {
  return {
    connection_method: "github-app-installation",
    app_id: normalizeGitHubManualSetupValue(draft.appId),
    app_slug: normalizeGitHubManualSetupValue(draft.appSlug),
    ...(normalizeGitHubManualSetupValue(draft.clientId).length === 0
      ? {}
      : { client_id: normalizeGitHubManualSetupValue(draft.clientId) }),
  };
}

function buildGitHubManualSetupSecrets(input: {
  draft: GitHubManualSetupDraft;
  fieldKey: GitHubManualSetupFieldKey;
}): Record<string, string> | undefined {
  if (input.fieldKey === "clientSecret") {
    const clientSecret = normalizeGitHubManualSetupValue(input.draft.clientSecret);
    return clientSecret.length === 0 ? undefined : { clientSecret };
  }

  if (input.fieldKey === "appPrivateKeyPem") {
    return {
      appPrivateKeyPem: normalizeGitHubManualSetupValue(input.draft.appPrivateKeyPem),
    };
  }

  if (input.fieldKey === "webhookSecret") {
    return {
      webhookSecret: normalizeGitHubManualSetupValue(input.draft.webhookSecret),
    };
  }

  return undefined;
}

function getGitHubManualSetupFieldValidationMessage(input: {
  fieldKey: GitHubManualSetupFieldKey;
  draft: GitHubManualSetupDraft;
  savedDraft: GitHubManualSetupDraft;
}): string | null {
  const normalizedValue = normalizeGitHubManualSetupValue(input.draft[input.fieldKey]);

  if (input.fieldKey === "appId" && normalizedValue.length === 0) {
    return `${GitHubManualSetupRequiredFieldLabels.appId} is required.`;
  }

  if (input.fieldKey === "appSlug" && normalizedValue.length === 0) {
    return `${GitHubManualSetupRequiredFieldLabels.appSlug} is required.`;
  }

  if (input.fieldKey === "appPrivateKeyPem" && normalizedValue.length === 0) {
    return `${GitHubManualSetupRequiredFieldLabels.appPrivateKeyPem} is required.`;
  }

  if (input.fieldKey === "clientId" && normalizedValue.length === 0) {
    return `${GitHubManualSetupRequiredFieldLabels.clientId} is required.`;
  }

  if (input.fieldKey === "clientSecret" && normalizedValue.length === 0) {
    return `${GitHubManualSetupRequiredFieldLabels.clientSecret} is required.`;
  }

  if (input.fieldKey === "webhookSecret" && normalizedValue.length === 0) {
    return `${GitHubManualSetupRequiredFieldLabels.webhookSecret} is required.`;
  }

  return null;
}

function shouldPersistGitHubManualSetupField(input: {
  fieldKey: GitHubManualSetupFieldKey;
  draft: GitHubManualSetupDraft;
}): boolean {
  if (isGitHubManualSetupConfigFieldKey(input.fieldKey)) {
    return hasRequiredGitHubSetupConfigValues(input.draft);
  }

  if (!hasRequiredGitHubSetupConfigValues(input.draft)) {
    return false;
  }

  return normalizeGitHubManualSetupValue(input.draft[input.fieldKey]).length > 0;
}

function buildNextSavedDraft(input: {
  savedDraft: GitHubManualSetupDraft;
  draft: GitHubManualSetupDraft;
  fieldKey: GitHubManualSetupFieldKey;
}): GitHubManualSetupDraft {
  const nextSavedDraft: GitHubManualSetupDraft = {
    ...input.savedDraft,
  };

  for (const configFieldKey of GitHubManualSetupConfigFieldKeys) {
    nextSavedDraft[configFieldKey] = normalizeGitHubManualSetupValue(input.draft[configFieldKey]);
  }

  if (isGitHubManualSetupSecretFieldKey(input.fieldKey)) {
    nextSavedDraft[input.fieldKey] = normalizeGitHubManualSetupValue(input.draft[input.fieldKey]);
  }

  return nextSavedDraft;
}

function buildNextDraftAfterSave(input: {
  draft: GitHubManualSetupDraft;
  fieldKey: GitHubManualSetupFieldKey;
}): GitHubManualSetupDraft {
  const nextDraft: GitHubManualSetupDraft = {
    ...input.draft,
  };

  for (const configFieldKey of GitHubManualSetupConfigFieldKeys) {
    nextDraft[configFieldKey] = normalizeGitHubManualSetupValue(input.draft[configFieldKey]);
  }

  if (isGitHubManualSetupSecretFieldKey(input.fieldKey)) {
    nextDraft[input.fieldKey] = normalizeGitHubManualSetupValue(input.draft[input.fieldKey]);
  }

  return nextDraft;
}

function isGitHubManualSetupFieldDirty(input: {
  fieldKey: GitHubManualSetupFieldKey;
  draft: GitHubManualSetupDraft;
  savedDraft: GitHubManualSetupDraft;
}): boolean {
  return (
    normalizeGitHubManualSetupValue(input.draft[input.fieldKey]) !==
    normalizeGitHubManualSetupValue(input.savedDraft[input.fieldKey])
  );
}

function isGitHubManualSetupFieldReadyForInstall(input: {
  fieldKey: GitHubManualSetupFieldKey;
  draft: GitHubManualSetupDraft;
  savedDraft: GitHubManualSetupDraft;
  fieldState: SavingFieldState;
  isConfiguredOnServer?: boolean;
}): boolean {
  const normalizedDraftValue = normalizeGitHubManualSetupValue(input.draft[input.fieldKey]);
  const normalizedSavedValue = normalizeGitHubManualSetupValue(input.savedDraft[input.fieldKey]);

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

function isGitHubAppInstallationConnection(connection: IntegrationConnection): boolean {
  return connection.connectionMethodId === "github-app-installation";
}

function buildGitHubAppSetupCallbackUrl(): string {
  return new URL(
    "/p/integration/callbacks/github-app-installation",
    getDashboardConfig().controlPlaneApiOrigin,
  ).toString();
}

export function IntegrationConnectionGitHubManualSetupPage(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const navigate = useNavigate();
  const params = useParams();
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

  if (!isGitHubAppInstallationConnection(connection)) {
    throw new Error(`Integration connection '${connectionId}' is not a GitHub App connection.`);
  }

  return (
    <FormPageFrame
      description={description}
      headerIcon={pageMeta.headerIcon ?? undefined}
      title={title}
    >
      <GitHubManualSetupPane
        key={connection.id}
        connection={connection}
        onBack={() => {
          void navigate("/integrations");
        }}
      />
    </FormPageFrame>
  );
}

export function GitHubManualSetupPane(input: {
  connection: IntegrationConnection;
  onBack?: () => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => createInitialDraft(input.connection));
  const [savedDraft, setSavedDraft] = useState(() => createInitialDraft(input.connection));
  const [configuredSecretFieldKeys, setConfiguredSecretFieldKeys] = useState(() =>
    resolveConfiguredSecretFieldKeys(input.connection),
  );
  const [isSecretReplacementDialogOpen, setIsSecretReplacementDialogOpen] = useState(false);
  const [fieldStates, setFieldStates] = useState(() => createInitialFieldStates());
  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(null);
  const fieldTimeoutRefs = useRef(createFieldTimeoutRefs());
  const webhookSourcesQuery = useQuery({
    queryKey: ["integration-webhook-sources", input.connection.id],
    queryFn: async ({ signal }) =>
      listIntegrationWebhookSources({
        connectionId: input.connection.id,
        signal,
      }),
    retry: false,
  });

  const startInstallationMutation = useMutation({
    mutationFn: async () =>
      startGitHubAppInstallation({
        connectionId: input.connection.id,
      }),
    onSuccess: ({ authorizationUrl }) => {
      globalThis.location.assign(authorizationUrl);
    },
    onError: (error) => {
      setActionErrorMessage(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not start GitHub App installation.",
        }),
      );
    },
  });

  useEffect(() => {
    return () => {
      for (const fieldKey of GitHubManualSetupFieldKeys) {
        clearPendingStatusTimeouts({
          fadeEndTimeoutRef: fieldTimeoutRefs.current[fieldKey].fadeEndTimeoutRef,
          fadeStartTimeoutRef: fieldTimeoutRefs.current[fieldKey].fadeStartTimeoutRef,
          scheduler: systemScheduler,
        });
      }
    };
  }, []);

  function resetFieldFeedback(fieldKey: GitHubManualSetupFieldKey): void {
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

  function updateFieldDraft(fieldKey: GitHubManualSetupFieldKey, nextValue: string): void {
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
    fieldKey: GitHubManualSetupFieldKey,
    currentDraft: GitHubManualSetupDraft,
  ): Promise<void> {
    if (fieldStates[fieldKey].status === "saving") {
      return;
    }

    if (
      !isGitHubManualSetupFieldDirty({
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

    const validationMessage = getGitHubManualSetupFieldValidationMessage({
      fieldKey,
      draft: currentDraft,
      savedDraft,
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
      !shouldPersistGitHubManualSetupField({
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
      const secrets = buildGitHubManualSetupSecrets({
        draft: currentDraft,
        fieldKey,
      });

      await updateFormIntegrationConnection({
        connectionId: input.connection.id,
        displayName: input.connection.displayName,
        config: buildGitHubManualSetupConfig(currentDraft),
        ...(secrets === undefined ? {} : { secrets }),
      });

      await queryClient.invalidateQueries({
        queryKey: SETTINGS_INTEGRATIONS_QUERY_KEY,
      });

      const nextSavedDraft = buildNextSavedDraft({
        savedDraft,
        draft: currentDraft,
        fieldKey,
      });
      const nextDraft = buildNextDraftAfterSave({
        draft: currentDraft,
        fieldKey,
      });

      setSavedDraft(nextSavedDraft);
      setDraft(nextDraft);
      if (isGitHubManualSetupSecretFieldKey(fieldKey)) {
        setConfiguredSecretFieldKeys((currentConfiguredSecretFieldKeys) => {
          const nextConfiguredSecretFieldKeys = new Set(currentConfiguredSecretFieldKeys);
          nextConfiguredSecretFieldKeys.add(fieldKey);
          return nextConfiguredSecretFieldKeys;
        });
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

  async function commitField(fieldKey: GitHubManualSetupFieldKey): Promise<void> {
    await persistField(fieldKey, draft);
  }

  function revertSecretReplacement(fieldKey: GitHubManualSetupSecretFieldKey): void {
    setDraft((currentDraft) => ({
      ...currentDraft,
      [fieldKey]: "",
    }));
    resetFieldFeedback(fieldKey);
  }

  const webhookCallbackUrl = webhookSourcesQuery.data?.[0]?.callbackUrl;
  const isInstalled = hasInstalledGitHubApp(input.connection);
  const requiredConfigReady = GitHubManualSetupRequiredConfigFieldKeys.every((fieldKey) =>
    isGitHubManualSetupFieldReadyForInstall({
      fieldKey,
      draft,
      savedDraft,
      fieldState: fieldStates[fieldKey],
      ...(isGitHubManualSetupSecretFieldKey(fieldKey)
        ? { isConfiguredOnServer: configuredSecretFieldKeys.has(fieldKey) }
        : {}),
    }),
  );
  const requiredSecretsReady = GitHubManualSetupRequiredSecretFieldKeys.every((fieldKey) =>
    isGitHubManualSetupFieldReadyForInstall({
      fieldKey,
      draft,
      savedDraft,
      fieldState: fieldStates[fieldKey],
      isConfiguredOnServer: configuredSecretFieldKeys.has(fieldKey),
    }),
  );
  const canInstall = (requiredConfigReady && requiredSecretsReady) || isInstalled;
  const installButtonDisabled =
    !canInstall || startInstallationMutation.isPending || isSecretReplacementDialogOpen;
  return (
    <FormPageStack>
      <FormPageSection>
        <div className="flex flex-col gap-6 p-4">
          {actionErrorMessage === null ? null : (
            <Notice title="Could not continue setup" variant="alert">
              {actionErrorMessage}
            </Notice>
          )}

          <CopyableValue
            label="Post-installation setup URL"
            value={buildGitHubAppSetupCallbackUrl()}
          />
          {webhookSourcesQuery.isPending ? (
            <CopyableValue label="Webhook callback URL" loading />
          ) : webhookSourcesQuery.isError ? (
            <Notice title="Could not load webhook URL" variant="alert">
              {resolveApiErrorMessage({
                error: webhookSourcesQuery.error,
                fallbackMessage: "Could not load integration webhook sources.",
              })}
            </Notice>
          ) : webhookCallbackUrl === undefined ? (
            <Notice title="Webhook URL is not available yet" variant="alert">
              GitHub setup requires a webhook callback URL, but this connection does not have one
              yet.
            </Notice>
          ) : (
            <CopyableValue label="Webhook callback URL" value={webhookCallbackUrl} />
          )}

          <SavingTextField
            fieldState={fieldStates.appId}
            id="github-app-id"
            label="App ID"
            onBlur={() => {
              void commitField("appId");
            }}
            onChange={(nextValue) => {
              updateFieldDraft("appId", nextValue);
            }}
            required
            value={draft.appId}
          />

          <SavingTextField
            fieldState={fieldStates.appSlug}
            id="github-app-slug"
            label="App slug"
            onBlur={() => {
              void commitField("appSlug");
            }}
            onChange={(nextValue) => {
              updateFieldDraft("appSlug", nextValue);
            }}
            required
            value={draft.appSlug}
          />

          <ConfiguredSecretField
            fieldState={fieldStates.appPrivateKeyPem}
            secretLabel="app private key"
            id="github-app-private-key"
            label="App private key"
            multiline
            onCancelReplace={() => {
              revertSecretReplacement("appPrivateKeyPem");
            }}
            onChange={(nextValue) => {
              updateFieldDraft("appPrivateKeyPem", nextValue);
            }}
            onCommit={() => {
              void commitField("appPrivateKeyPem");
            }}
            onReplacementDialogOpenChange={setIsSecretReplacementDialogOpen}
            placeholder="-----BEGIN PRIVATE KEY-----"
            configured={configuredSecretFieldKeys.has("appPrivateKeyPem")}
            required
            rows={8}
            value={draft.appPrivateKeyPem}
          />

          <SavingTextField
            fieldState={fieldStates.clientId}
            id="github-client-id"
            label="Client ID"
            onBlur={() => {
              void commitField("clientId");
            }}
            onChange={(nextValue) => {
              updateFieldDraft("clientId", nextValue);
            }}
            required
            value={draft.clientId}
          />

          <ConfiguredSecretField
            fieldState={fieldStates.clientSecret}
            secretLabel="client secret"
            id="github-client-secret"
            label="Client secret"
            onCancelReplace={() => {
              revertSecretReplacement("clientSecret");
            }}
            onChange={(nextValue) => {
              updateFieldDraft("clientSecret", nextValue);
            }}
            onCommit={() => {
              void commitField("clientSecret");
            }}
            onReplacementDialogOpenChange={setIsSecretReplacementDialogOpen}
            configured={configuredSecretFieldKeys.has("clientSecret")}
            required
            type="password"
            value={draft.clientSecret}
          />

          <ConfiguredSecretField
            fieldState={fieldStates.webhookSecret}
            secretLabel="webhook secret"
            id="github-webhook-secret"
            label="Webhook secret"
            onCancelReplace={() => {
              revertSecretReplacement("webhookSecret");
            }}
            onChange={(nextValue) => {
              updateFieldDraft("webhookSecret", nextValue);
            }}
            onCommit={() => {
              void commitField("webhookSecret");
            }}
            onReplacementDialogOpenChange={setIsSecretReplacementDialogOpen}
            configured={configuredSecretFieldKeys.has("webhookSecret")}
            required
            type="password"
            value={draft.webhookSecret}
          />

          <FormPageActionBar>
            {input.onBack === undefined ? null : (
              <Button
                onClick={() => {
                  input.onBack?.();
                }}
                type="button"
                variant="outline"
              >
                Back
              </Button>
            )}
            <Button
              disabled={installButtonDisabled}
              onClick={() => {
                void startInstallationMutation.mutateAsync();
              }}
              type="button"
            >
              {isInstalled ? "Manage Installation" : "Install App"}
            </Button>
          </FormPageActionBar>
        </div>
      </FormPageSection>
    </FormPageStack>
  );
}
