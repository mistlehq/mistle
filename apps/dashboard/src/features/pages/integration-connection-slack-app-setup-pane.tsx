import { SlackConnectionMethodId } from "@mistle/integrations-definitions/browser";
import {
  Button,
  Field,
  FieldContent,
  FieldDescription,
  FieldHeader,
  FieldLabel,
  Input,
  TextLink,
} from "@mistle/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import type { SavingFieldState } from "../forms/configured-secret-field.js";
import {
  startSlackAppManifestCreation,
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
import { FormPageActionBar, FormPageStack } from "../shared/form-page.js";
import { SectionHeader } from "../shared/section-header.js";
import {
  ExistingAppSetupFieldsPanel,
  getSetupFieldState,
  useExistingAppSetupAutoSave,
  useSetupManifestDraft,
} from "./integration-connection-app-setup-shared.js";
import {
  IntegrationConnectionSetupManifestEditorSection,
  IntegrationConnectionSetupModeTabs,
  IntegrationConnectionSetupWebhookCallbackValue,
  type IntegrationConnectionSetupMode,
} from "./integration-connection-setup-flow.js";
import type { IntegrationSetupAppManifestDraftBuilder } from "./integration-connection-setup-manifest-draft.js";
import {
  hasConfiguredSetupSecretField,
  resolveConfiguredSetupSecretFieldKeys,
} from "./integration-connection-setup-secret-fields.js";
import { SETTINGS_INTEGRATIONS_QUERY_KEY } from "./use-integrations-directory-state.js";

type SlackSetupMode = IntegrationConnectionSetupMode;

type SlackExistingAppDraft = {
  clientId: string;
  botToken: string;
  signingSecret: string;
  clientSecret: string;
};

type SlackExistingAppFieldKey = keyof SlackExistingAppDraft;

const SlackExistingAppSetupFieldLabels = {
  clientId: "Client ID",
  botToken: "Bot token",
  signingSecret: "Signing secret",
  clientSecret: "Client secret",
} satisfies Record<SlackExistingAppFieldKey, string>;

const SlackExistingAppFieldKeys = [
  "clientId",
  "botToken",
  "signingSecret",
  "clientSecret",
] satisfies readonly SlackExistingAppFieldKey[];

const SlackExistingAppConfigFieldKeys = ["clientId"] satisfies readonly SlackExistingAppFieldKey[];

const SlackExistingAppSecretFieldKeys = [
  "botToken",
  "signingSecret",
  "clientSecret",
] satisfies readonly SlackExistingAppFieldKey[];

type SlackExistingAppSecretFieldKey = (typeof SlackExistingAppSecretFieldKeys)[number];

const SlackRequiredExistingAppSecretFieldKeys = [
  "botToken",
  "signingSecret",
] satisfies readonly SlackExistingAppSecretFieldKey[];

function normalizeInputValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function createInitialExistingAppDraft(connection: IntegrationConnection): SlackExistingAppDraft {
  return {
    clientId: normalizeInputValue(connection.config?.["client_id"]),
    botToken: "",
    signingSecret: "",
    clientSecret: "",
  };
}

function isSlackExistingAppSecretFieldKey(
  fieldKey: SlackExistingAppFieldKey,
): fieldKey is SlackExistingAppSecretFieldKey {
  return fieldKey === "botToken" || fieldKey === "signingSecret" || fieldKey === "clientSecret";
}

function resolveConfiguredSlackSecretFieldKeys(
  connection: IntegrationConnection,
): ReadonlySet<SlackExistingAppSecretFieldKey> {
  return resolveConfiguredSetupSecretFieldKeys({
    configuredSecretNames: connection.configuredSecretNames,
    fieldKeys: SlackExistingAppSecretFieldKeys,
  });
}

function isSlackAppInstalled(connection: IntegrationConnection): boolean {
  return (
    typeof connection.config?.["client_id"] === "string" &&
    hasConfiguredSetupSecretField({
      configuredSecretNames: connection.configuredSecretNames,
      fieldName: "botToken",
    }) &&
    hasConfiguredSetupSecretField({
      configuredSecretNames: connection.configuredSecretNames,
      fieldName: "signingSecret",
    })
  );
}

function normalizeSlackExistingAppSetupValue(value: string): string {
  return value.trim();
}

function buildSlackExistingAppSetupConfig(draft: SlackExistingAppDraft): Record<string, string> {
  const clientId = normalizeSlackExistingAppSetupValue(draft.clientId);

  return {
    connection_method: SlackConnectionMethodId,
    ...(clientId.length === 0 ? {} : { client_id: clientId }),
  };
}

function buildSlackExistingAppSetupSecrets(input: {
  draft: SlackExistingAppDraft;
  fieldKey: SlackExistingAppFieldKey;
}): Record<string, string> | undefined {
  if (!isSlackExistingAppSecretFieldKey(input.fieldKey)) {
    return undefined;
  }

  const value = normalizeSlackExistingAppSetupValue(input.draft[input.fieldKey]);
  return value.length === 0 ? undefined : { [input.fieldKey]: value };
}

function isSlackExistingAppSetupFieldDirty(input: {
  fieldKey: SlackExistingAppFieldKey;
  draft: SlackExistingAppDraft;
  savedDraft: SlackExistingAppDraft;
}): boolean {
  return (
    normalizeSlackExistingAppSetupValue(input.draft[input.fieldKey]) !==
    normalizeSlackExistingAppSetupValue(input.savedDraft[input.fieldKey])
  );
}

function isSlackExistingAppFieldStable(input: {
  fieldKey: SlackExistingAppFieldKey;
  draft: SlackExistingAppDraft;
  savedDraft: SlackExistingAppDraft;
  fieldState: SavingFieldState;
}): boolean {
  return (
    input.fieldState.status !== "saving" &&
    input.fieldState.errorMessage === null &&
    !isSlackExistingAppSetupFieldDirty({
      fieldKey: input.fieldKey,
      draft: input.draft,
      savedDraft: input.savedDraft,
    })
  );
}

function getSlackExistingAppSetupFieldValidationMessage(input: {
  fieldKey: SlackExistingAppFieldKey;
  draft: SlackExistingAppDraft;
}): string | null {
  const normalizedValue = normalizeSlackExistingAppSetupValue(input.draft[input.fieldKey]);

  if (isSlackExistingAppSecretFieldKey(input.fieldKey) && normalizedValue.length === 0) {
    if (input.fieldKey === "clientSecret") {
      return null;
    }

    return `${SlackExistingAppSetupFieldLabels[input.fieldKey]} is required.`;
  }

  return null;
}

function shouldPersistSlackExistingAppSetupField(input: {
  fieldKey: SlackExistingAppFieldKey;
  draft: SlackExistingAppDraft;
}): boolean {
  return (
    !isSlackExistingAppSecretFieldKey(input.fieldKey) ||
    normalizeSlackExistingAppSetupValue(input.draft[input.fieldKey]).length > 0
  );
}

function isSlackExistingAppRequiredSecretReady(input: {
  fieldKey: SlackExistingAppSecretFieldKey;
  draft: SlackExistingAppDraft;
  savedDraft: SlackExistingAppDraft;
  fieldState: SavingFieldState;
  isConfiguredOnServer: boolean;
}): boolean {
  if (
    input.isConfiguredOnServer &&
    normalizeSlackExistingAppSetupValue(input.draft[input.fieldKey]).length === 0 &&
    normalizeSlackExistingAppSetupValue(input.savedDraft[input.fieldKey]).length === 0 &&
    isSlackExistingAppFieldStable(input)
  ) {
    return true;
  }

  return (
    normalizeSlackExistingAppSetupValue(input.savedDraft[input.fieldKey]).length > 0 &&
    isSlackExistingAppFieldStable(input)
  );
}

function resolveSlackExistingAppSetupSavedFieldKeys(
  fieldKey: SlackExistingAppFieldKey,
): ReadonlyArray<SlackExistingAppFieldKey> {
  if (isSlackExistingAppSecretFieldKey(fieldKey)) {
    return [...SlackExistingAppConfigFieldKeys, fieldKey];
  }

  return SlackExistingAppConfigFieldKeys;
}

function SlackManifestSetupPanel(input: {
  appConfigToken: string;
  manifestCallbackState: ManifestWebhookCallbackState;
  manifestValue: string;
  manifestValidation: ManifestJsonValidation;
  onAppConfigTokenChange: (value: string) => void;
  onManifestChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <Field>
        <FieldHeader>
          <FieldLabel htmlFor="slack-app-config-token" required>
            App configuration token
          </FieldLabel>
          <FieldDescription>
            Generate one from{" "}
            <TextLink href="https://api.slack.com/apps" opensInNewWindow>
              Slack app settings
            </TextLink>
            , then paste it here.
          </FieldDescription>
        </FieldHeader>
        <FieldContent>
          <Input
            autoComplete="off"
            id="slack-app-config-token"
            onChange={(event) => input.onAppConfigTokenChange(event.target.value)}
            placeholder="xoxe.xoxp-..."
            type="password"
            value={input.appConfigToken}
          />
        </FieldContent>
      </Field>

      <IntegrationConnectionSetupManifestEditorSection
        description="Create a Slack app from a basic manifest. You can still change the settings later in Slack."
        editorId="slack-app-manifest-editor"
        headingLevel="h3"
        manifestCallbackState={input.manifestCallbackState}
        manifestValidation={input.manifestValidation}
        manifestValue={input.manifestValue}
        onManifestChange={input.onManifestChange}
        title="Slack app manifest"
      />
    </div>
  );
}

function SlackSetupUrls(input: {
  webhookCallbackState: ManifestWebhookCallbackState;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        description="Copy this URL into Slack Event Subscriptions, then return here to connect Slack to Mistle."
        title="Slack app URLs"
      />
      <div className="flex flex-col gap-4">
        <IntegrationConnectionSetupWebhookCallbackValue
          errorTitle="Could not load Events API Request URL"
          label="Events API Request URL"
          missingMessage="Slack setup requires an Events API Request URL, but this connection does not have one yet."
          missingTitle="Events API Request URL is not available yet"
          webhookCallbackState={input.webhookCallbackState}
        />
      </div>
    </div>
  );
}

export function SlackAppSetupPane(input: {
  connection: IntegrationConnection;
  manifestDraftBuilder: IntegrationSetupAppManifestDraftBuilder;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [setupMode, setSetupMode] = useState<SlackSetupMode>(() =>
    isSlackAppInstalled(input.connection) ? "existing-app" : "manifest",
  );
  const [appConfigToken, setAppConfigToken] = useState("");
  const [configuredSecretFieldKeys, setConfiguredSecretFieldKeys] = useState(() =>
    resolveConfiguredSlackSecretFieldKeys(input.connection),
  );
  const [isSecretReplacementDialogOpen, setIsSecretReplacementDialogOpen] = useState(false);
  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(null);
  const existingAppAutoSave = useExistingAppSetupAutoSave<
    SlackExistingAppFieldKey,
    IntegrationConnection
  >({
    clearActionError: () => {
      setActionErrorMessage(null);
    },
    createInitialDraft: () => createInitialExistingAppDraft(input.connection),
    fieldKeys: SlackExistingAppFieldKeys,
    normalizeValue: normalizeSlackExistingAppSetupValue,
    onFieldSaved: (updatedConnection, fieldKey) => {
      if (isSlackExistingAppSecretFieldKey(fieldKey)) {
        setConfiguredSecretFieldKeys(resolveConfiguredSlackSecretFieldKeys(updatedConnection));
      }
    },
    resolveSavedFieldKeys: resolveSlackExistingAppSetupSavedFieldKeys,
    resolveSaveErrorMessage: (error) =>
      resolveApiErrorMessage({
        error,
        fallbackMessage: "Could not save Slack app setup.",
      }),
    saveField: async ({ draft, fieldKey }) => {
      const secrets = buildSlackExistingAppSetupSecrets({
        draft,
        fieldKey,
      });
      const updatedConnection = await updateFormIntegrationConnection({
        connectionId: input.connection.id,
        displayName: input.connection.displayName,
        config: buildSlackExistingAppSetupConfig(draft),
        ...(secrets === undefined ? {} : { secrets }),
      });

      await queryClient.invalidateQueries({
        queryKey: SETTINGS_INTEGRATIONS_QUERY_KEY,
      });

      return updatedConnection;
    },
    shouldPersistField: shouldPersistSlackExistingAppSetupField,
    validateField: getSlackExistingAppSetupFieldValidationMessage,
  });
  const webhookCallbackState = useManifestWebhookCallbackState({
    enabled: true,
    connectionId: input.connection.id,
  });
  const manifestDraft = useSetupManifestDraft({
    manifestDraftBuilder: input.manifestDraftBuilder,
    webhookCallbackState,
  });

  const startManifestMutation = useMutation({
    mutationFn: async () =>
      startSlackAppManifestCreation({
        connectionId: input.connection.id,
        manifest: parseManifestJsonObject(manifestDraft.manifestValue),
        appConfigToken,
      }),
  });

  async function createSlackApp(): Promise<void> {
    setActionErrorMessage(null);
    try {
      const started = await startManifestMutation.mutateAsync();
      globalThis.location.assign(started.authorizationUrl);
    } catch (error) {
      setActionErrorMessage(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not create Slack app manifest.",
        }),
      );
    }
  }

  const manifestValidation = validateManifestJsonObject(manifestDraft.manifestValue);
  const canCreateManifest =
    manifestValidation.status === "valid" &&
    webhookCallbackState.kind === "ready" &&
    appConfigToken.trim().length > 0;
  const requiredSecretsReady = SlackRequiredExistingAppSecretFieldKeys.every((fieldKey) =>
    isSlackExistingAppRequiredSecretReady({
      fieldKey,
      draft: existingAppAutoSave.draft,
      savedDraft: existingAppAutoSave.savedDraft,
      fieldState: getSetupFieldState(existingAppAutoSave.fieldStates, fieldKey),
      isConfiguredOnServer: configuredSecretFieldKeys.has(fieldKey),
    }),
  );
  const allFieldsStable = SlackExistingAppFieldKeys.every((fieldKey) =>
    isSlackExistingAppFieldStable({
      fieldKey,
      draft: existingAppAutoSave.draft,
      savedDraft: existingAppAutoSave.savedDraft,
      fieldState: getSetupFieldState(existingAppAutoSave.fieldStates, fieldKey),
    }),
  );
  const canConnectExistingApp =
    requiredSecretsReady &&
    allFieldsStable &&
    !isSecretReplacementDialogOpen &&
    webhookCallbackState.kind === "ready";

  return (
    <FormPageStack>
      <IntegrationConnectionSetupModeTabs
        actionErrorMessage={actionErrorMessage}
        description="Create a new Slack app with a manifest or connect an app you've already configured in Slack."
        existingAppContent={
          <ExistingAppSetupFieldsPanel
            configFields={[
              {
                fieldKey: "clientId",
                id: "slack-client-id",
                label: SlackExistingAppSetupFieldLabels.clientId,
                value: existingAppAutoSave.draft.clientId,
              },
            ]}
            description="Paste values from a Slack app you already created or configured in Slack."
            fieldStates={existingAppAutoSave.fieldStates}
            onCommitField={(fieldKey) => {
              void existingAppAutoSave.persistField(fieldKey);
            }}
            onReplacementDialogOpenChange={setIsSecretReplacementDialogOpen}
            onRevertSecretReplacement={existingAppAutoSave.revertField}
            onUpdateFieldDraft={existingAppAutoSave.updateFieldDraft}
            secretFields={[
              {
                configured: configuredSecretFieldKeys.has("botToken"),
                fieldKey: "botToken",
                id: "slack-bot-token",
                label: SlackExistingAppSetupFieldLabels.botToken,
                placeholder: "xoxb-...",
                required: !configuredSecretFieldKeys.has("botToken"),
                secretLabel: "bot token",
                type: "password",
                value: existingAppAutoSave.draft.botToken,
              },
              {
                configured: configuredSecretFieldKeys.has("signingSecret"),
                fieldKey: "signingSecret",
                id: "slack-signing-secret",
                label: SlackExistingAppSetupFieldLabels.signingSecret,
                required: !configuredSecretFieldKeys.has("signingSecret"),
                secretLabel: "signing secret",
                type: "password",
                value: existingAppAutoSave.draft.signingSecret,
              },
              {
                configured: configuredSecretFieldKeys.has("clientSecret"),
                fieldKey: "clientSecret",
                id: "slack-client-secret",
                label: SlackExistingAppSetupFieldLabels.clientSecret,
                secretLabel: "client secret",
                type: "password",
                value: existingAppAutoSave.draft.clientSecret,
              },
            ]}
            title="Existing Slack App"
          />
        }
        footer={
          <>
            {setupMode === "existing-app" ? (
              <SlackSetupUrls webhookCallbackState={webhookCallbackState} />
            ) : null}

            {setupMode === "existing-app" ? (
              <FormPageActionBar>
                <Button
                  disabled={!canConnectExistingApp}
                  onClick={() => {
                    void navigate(`/integrations/${input.connection.targetKey}`);
                  }}
                  type="button"
                >
                  Connect Slack to Mistle
                </Button>
              </FormPageActionBar>
            ) : setupMode === "manifest" ? (
              <FormPageActionBar>
                <Button
                  disabled={!canCreateManifest || startManifestMutation.isPending}
                  onClick={() => {
                    void createSlackApp();
                  }}
                  type="button"
                >
                  Create and connect Slack app
                </Button>
              </FormPageActionBar>
            ) : null}
          </>
        }
        manifestContent={
          <SlackManifestSetupPanel
            appConfigToken={appConfigToken}
            manifestCallbackState={webhookCallbackState}
            manifestValidation={manifestValidation}
            manifestValue={manifestDraft.manifestValue}
            onAppConfigTokenChange={setAppConfigToken}
            onManifestChange={manifestDraft.onManifestChange}
          />
        }
        onModeChange={setSetupMode}
        title="Choose a setup method"
        value={setupMode}
      />
    </FormPageStack>
  );
}
