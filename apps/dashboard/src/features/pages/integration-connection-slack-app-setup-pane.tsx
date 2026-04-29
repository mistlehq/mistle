import { SlackConnectionMethodId } from "@mistle/integrations-definitions/browser";
import { systemScheduler } from "@mistle/time";
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
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import {
  ConfiguredSecretField,
  SavingTextField,
  type SavingFieldState,
} from "../forms/configured-secret-field.js";
import {
  startSlackAppManifestCreation,
  updateFormIntegrationConnection,
} from "../integrations/integrations-service.js";
import type { IntegrationConnection } from "../integrations/integrations-service.js";
import { ManifestCallbackJsonEditor } from "../integrations/manifest-callback-json-editor.js";
import {
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
import { FormPageActionBar, FormPageStack } from "../shared/form-page.js";
import { SectionHeader } from "../shared/section-header.js";
import {
  IntegrationConnectionSetupModeTabs,
  IntegrationConnectionSetupWebhookCallbackValue,
  type IntegrationConnectionSetupMode,
} from "./integration-connection-setup-flow.js";
import {
  type IntegrationSetupAppManifestDraftBuilder,
  resolveManifestDraftControlPlaneBaseUrl,
} from "./integration-connection-setup-manifest-draft.js";
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

function createInitialFieldStates(): Record<SlackExistingAppFieldKey, SavingFieldState> {
  return {
    clientId: { status: "idle", errorMessage: null },
    botToken: { status: "idle", errorMessage: null },
    signingSecret: { status: "idle", errorMessage: null },
    clientSecret: { status: "idle", errorMessage: null },
  };
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

      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-medium">Slack app manifest</h3>
          <p className="text-muted-foreground text-sm">
            Create a Slack app from a basic manifest. You can still change the settings later in
            Slack.
          </p>
        </div>
        <ManifestCallbackJsonEditor
          callbackState={input.manifestCallbackState}
          id="slack-app-manifest-editor"
          onChange={input.onManifestChange}
          validation={input.manifestValidation}
          value={input.manifestValue}
        />
      </div>
    </div>
  );
}

function SlackExistingAppSetupPanel(input: {
  configuredSecretFieldKeys: ReadonlySet<SlackExistingAppSecretFieldKey>;
  draft: SlackExistingAppDraft;
  fieldStates: Record<SlackExistingAppFieldKey, SavingFieldState>;
  onCommitField: (fieldKey: SlackExistingAppFieldKey) => void;
  onReplacementDialogOpenChange: (open: boolean) => void;
  onRevertSecretReplacement: (fieldKey: SlackExistingAppSecretFieldKey) => void;
  onUpdateFieldDraft: (fieldKey: SlackExistingAppFieldKey, nextValue: string) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <SectionHeader
          description="Paste values from a Slack app you already created or configured in Slack."
          title="Existing Slack App"
        />
        <SavingTextField
          fieldState={input.fieldStates.clientId}
          id="slack-client-id"
          label="Client ID"
          onBlur={() => {
            input.onCommitField("clientId");
          }}
          onChange={(nextValue) => {
            input.onUpdateFieldDraft("clientId", nextValue);
          }}
          value={input.draft.clientId}
        />
      </div>

      <div className="flex flex-col gap-4">
        <SectionHeader title="Secrets" />
        <ConfiguredSecretField
          configured={input.configuredSecretFieldKeys.has("botToken")}
          fieldState={input.fieldStates.botToken}
          id="slack-bot-token"
          label="Bot token"
          onCancelReplace={() => {
            input.onRevertSecretReplacement("botToken");
          }}
          onChange={(nextValue) => {
            input.onUpdateFieldDraft("botToken", nextValue);
          }}
          onCommit={() => {
            input.onCommitField("botToken");
          }}
          onReplacementDialogOpenChange={input.onReplacementDialogOpenChange}
          placeholder="xoxb-..."
          required={!input.configuredSecretFieldKeys.has("botToken")}
          secretLabel="bot token"
          type="password"
          value={input.draft.botToken}
        />
        <ConfiguredSecretField
          configured={input.configuredSecretFieldKeys.has("signingSecret")}
          fieldState={input.fieldStates.signingSecret}
          id="slack-signing-secret"
          label="Signing secret"
          onCancelReplace={() => {
            input.onRevertSecretReplacement("signingSecret");
          }}
          onChange={(nextValue) => {
            input.onUpdateFieldDraft("signingSecret", nextValue);
          }}
          onCommit={() => {
            input.onCommitField("signingSecret");
          }}
          onReplacementDialogOpenChange={input.onReplacementDialogOpenChange}
          required={!input.configuredSecretFieldKeys.has("signingSecret")}
          secretLabel="signing secret"
          type="password"
          value={input.draft.signingSecret}
        />
        <ConfiguredSecretField
          configured={input.configuredSecretFieldKeys.has("clientSecret")}
          fieldState={input.fieldStates.clientSecret}
          id="slack-client-secret"
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
          secretLabel="client secret"
          type="password"
          value={input.draft.clientSecret}
        />
      </div>
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
  const [manifestValue, setManifestValue] = useState("");
  const [hasEditedManifest, setHasEditedManifest] = useState(false);
  const [appConfigToken, setAppConfigToken] = useState("");
  const [existingAppDraft, setExistingAppDraft] = useState(() =>
    createInitialExistingAppDraft(input.connection),
  );
  const [savedExistingAppDraft, setSavedExistingAppDraft] = useState(() =>
    createInitialExistingAppDraft(input.connection),
  );
  const [configuredSecretFieldKeys, setConfiguredSecretFieldKeys] = useState(() =>
    resolveConfiguredSlackSecretFieldKeys(input.connection),
  );
  const [isSecretReplacementDialogOpen, setIsSecretReplacementDialogOpen] = useState(false);
  const [fieldStates, setFieldStates] = useState(() => createInitialFieldStates());
  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(null);
  const fieldTimeoutRefs = useRef(
    createAutoSaveFieldTimeoutRefs({
      fieldKeys: SlackExistingAppFieldKeys,
    }),
  );
  const webhookCallbackState = useManifestWebhookCallbackState({
    enabled: true,
    connectionId: input.connection.id,
  });
  const webhookCallbackUrl =
    webhookCallbackState.kind === "ready" ? webhookCallbackState.value : null;
  const resolvedManifestValue =
    webhookCallbackUrl === null || hasEditedManifest
      ? manifestValue
      : createManifestJsonDraft(
          input.manifestDraftBuilder({
            controlPlaneBaseUrl: resolveManifestDraftControlPlaneBaseUrl({
              webhookCallbackUrl,
            }),
            webhookCallbackUrl,
          }),
        );

  const startManifestMutation = useMutation({
    mutationFn: async () =>
      startSlackAppManifestCreation({
        connectionId: input.connection.id,
        manifest: parseManifestJsonObject(resolvedManifestValue),
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

  useEffect(() => {
    return () => {
      for (const fieldKey of SlackExistingAppFieldKeys) {
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

  function resetFieldFeedback(fieldKey: SlackExistingAppFieldKey): void {
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

  function updateExistingAppFieldDraft(
    fieldKey: SlackExistingAppFieldKey,
    nextValue: string,
  ): void {
    setExistingAppDraft((currentDraft) => ({
      ...currentDraft,
      [fieldKey]: nextValue,
    }));
    setActionErrorMessage(null);
    if (fieldStates[fieldKey].status !== "idle" || fieldStates[fieldKey].errorMessage !== null) {
      resetFieldFeedback(fieldKey);
    }
  }

  async function persistExistingAppField(fieldKey: SlackExistingAppFieldKey): Promise<void> {
    if (fieldStates[fieldKey].status === "saving") {
      return;
    }

    if (
      !isSlackExistingAppSetupFieldDirty({
        fieldKey,
        draft: existingAppDraft,
        savedDraft: savedExistingAppDraft,
      })
    ) {
      setExistingAppDraft((currentDraft) => ({
        ...currentDraft,
        [fieldKey]: savedExistingAppDraft[fieldKey],
      }));
      resetFieldFeedback(fieldKey);
      return;
    }

    const normalizedValue = normalizeSlackExistingAppSetupValue(existingAppDraft[fieldKey]);
    if (isSlackExistingAppSecretFieldKey(fieldKey) && normalizedValue.length === 0) {
      if (fieldKey === "clientSecret") {
        resetFieldFeedback(fieldKey);
        return;
      }

      setFieldStates((currentFieldStates) => ({
        ...currentFieldStates,
        [fieldKey]: {
          status: "idle",
          errorMessage: `${fieldKey === "botToken" ? "Bot token" : "Signing secret"} is required.`,
        },
      }));
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
      const secrets = buildSlackExistingAppSetupSecrets({
        draft: existingAppDraft,
        fieldKey,
      });
      const updatedConnection = await updateFormIntegrationConnection({
        connectionId: input.connection.id,
        displayName: input.connection.displayName,
        config: buildSlackExistingAppSetupConfig(existingAppDraft),
        ...(secrets === undefined ? {} : { secrets }),
      });

      await queryClient.invalidateQueries({
        queryKey: SETTINGS_INTEGRATIONS_QUERY_KEY,
      });

      const savedFieldValuePatch = buildSavedFieldValuePatch({
        draft: existingAppDraft,
        fieldKeys: resolveSlackExistingAppSetupSavedFieldKeys(fieldKey),
        normalizeValue: normalizeSlackExistingAppSetupValue,
      });
      const nextSavedDraft = {
        ...savedExistingAppDraft,
        ...savedFieldValuePatch,
      };
      const nextDraft = {
        ...existingAppDraft,
        ...savedFieldValuePatch,
      };

      setSavedExistingAppDraft(nextSavedDraft);
      setExistingAppDraft(nextDraft);
      if (isSlackExistingAppSecretFieldKey(fieldKey)) {
        setConfiguredSecretFieldKeys(resolveConfiguredSlackSecretFieldKeys(updatedConnection));
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
            fallbackMessage: "Could not save Slack app setup.",
          }),
        },
      }));
    }
  }

  function revertSecretReplacement(fieldKey: SlackExistingAppSecretFieldKey): void {
    setExistingAppDraft((currentDraft) => ({
      ...currentDraft,
      [fieldKey]: "",
    }));
    resetFieldFeedback(fieldKey);
  }

  const manifestValidation = validateManifestJsonObject(resolvedManifestValue);
  const canCreateManifest =
    manifestValidation.status === "valid" &&
    webhookCallbackState.kind === "ready" &&
    appConfigToken.trim().length > 0;
  const requiredSecretsReady = SlackRequiredExistingAppSecretFieldKeys.every((fieldKey) =>
    isSlackExistingAppRequiredSecretReady({
      fieldKey,
      draft: existingAppDraft,
      savedDraft: savedExistingAppDraft,
      fieldState: fieldStates[fieldKey],
      isConfiguredOnServer: configuredSecretFieldKeys.has(fieldKey),
    }),
  );
  const allFieldsStable = SlackExistingAppFieldKeys.every((fieldKey) =>
    isSlackExistingAppFieldStable({
      fieldKey,
      draft: existingAppDraft,
      savedDraft: savedExistingAppDraft,
      fieldState: fieldStates[fieldKey],
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
          <SlackExistingAppSetupPanel
            configuredSecretFieldKeys={configuredSecretFieldKeys}
            draft={existingAppDraft}
            fieldStates={fieldStates}
            onCommitField={(fieldKey) => {
              void persistExistingAppField(fieldKey);
            }}
            onReplacementDialogOpenChange={setIsSecretReplacementDialogOpen}
            onRevertSecretReplacement={revertSecretReplacement}
            onUpdateFieldDraft={updateExistingAppFieldDraft}
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
            manifestValue={resolvedManifestValue}
            onAppConfigTokenChange={setAppConfigToken}
            onManifestChange={(nextValue) => {
              setHasEditedManifest(true);
              setManifestValue(nextValue);
            }}
          />
        }
        onModeChange={setSetupMode}
        title="Choose a setup method"
        value={setupMode}
      />
    </FormPageStack>
  );
}
