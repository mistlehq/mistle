import { json, jsonParseLinter } from "@codemirror/lang-json";
import { linter } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import {
  SlackAppManifestBotEvents,
  SlackAppManifestBotScopes,
  SlackConnectionMethodId,
} from "@mistle/integrations-definitions/browser";
import { systemScheduler, type TimerHandle } from "@mistle/time";
import {
  Button,
  CopyableValue,
  Field,
  FieldContent,
  FieldDescription,
  FieldHeader,
  FieldLabel,
  Input,
  Notice,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TextLink,
} from "@mistle/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import CodeMirror from "@uiw/react-codemirror";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";

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
  startSlackAppManifestCreation,
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

type SlackSetupMode = "manifest" | "existing-app";

type SlackExistingAppDraft = {
  clientId: string;
  botToken: string;
  signingSecret: string;
  clientSecret: string;
};

type SlackExistingAppFieldKey = keyof SlackExistingAppDraft;
type SlackExistingAppSecretFieldKey = "botToken" | "signingSecret" | "clientSecret";
type SlackExistingAppTimeoutRefs = Record<
  SlackExistingAppFieldKey,
  {
    fadeStartTimeoutRef: { current: TimerHandle | null };
    fadeEndTimeoutRef: { current: TimerHandle | null };
  }
>;

type ManifestValidation =
  | {
      status: "valid";
    }
  | {
      status: "invalid";
      message: string;
    };

const SlackExistingAppFieldKeys = [
  "clientId",
  "botToken",
  "signingSecret",
  "clientSecret",
] as const satisfies readonly SlackExistingAppFieldKey[];

export const SlackDraftManifest = JSON.stringify(
  {
    display_information: {
      name: "Mistle",
      description: "Connect Slack events and messages to Mistle automations.",
      background_color: "#2f855a",
    },
    features: {
      bot_user: {
        display_name: "mistle",
        always_online: false,
      },
    },
    settings: {
      event_subscriptions: {
        request_url: "https://mistle.example.com/api/integrations/slack/webhook",
        bot_events: SlackAppManifestBotEvents,
      },
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
    oauth_config: {
      redirect_urls: [
        "https://mistle.example.com/api/integrations/slack/install/callback",
        "https://mistle.example.com/api/identity-linking/slack/callback",
      ],
      scopes: {
        bot: SlackAppManifestBotScopes,
      },
    },
  },
  null,
  2,
);

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

function createFieldTimeoutRefs(): SlackExistingAppTimeoutRefs {
  return {
    clientId: {
      fadeStartTimeoutRef: { current: null },
      fadeEndTimeoutRef: { current: null },
    },
    botToken: {
      fadeStartTimeoutRef: { current: null },
      fadeEndTimeoutRef: { current: null },
    },
    signingSecret: {
      fadeStartTimeoutRef: { current: null },
      fadeEndTimeoutRef: { current: null },
    },
    clientSecret: {
      fadeStartTimeoutRef: { current: null },
      fadeEndTimeoutRef: { current: null },
    },
  };
}

function resolveConfiguredSecretFieldKeys(
  connection: IntegrationConnection,
): ReadonlySet<SlackExistingAppSecretFieldKey> {
  const configuredSecretFieldKeys = new Set<SlackExistingAppSecretFieldKey>();

  for (const configuredSecretName of connection.configuredSecretNames ?? []) {
    if (
      configuredSecretName === "botToken" ||
      configuredSecretName === "signingSecret" ||
      configuredSecretName === "clientSecret"
    ) {
      configuredSecretFieldKeys.add(configuredSecretName);
    }
  }

  return configuredSecretFieldKeys;
}

function validateManifestJson(value: string): ManifestValidation {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {
        status: "invalid",
        message: "Manifest JSON must be an object.",
      };
    }

    return { status: "valid" };
  } catch (error) {
    return {
      status: "invalid",
      message: error instanceof Error ? error.message : "Manifest JSON is invalid.",
    };
  }
}

function parseManifestObject(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Manifest JSON must be an object.");
  }

  return Object.fromEntries(Object.entries(parsed));
}

function formatSlackManifestJson(value: string): string {
  return JSON.stringify(parseManifestObject(value), null, 2);
}

function createSlackManifestFormatOnBlurExtension(input: {
  onManifestChange: (value: string) => void;
}): ReturnType<typeof EditorView.domEventHandlers> {
  return EditorView.domEventHandlers({
    blur: (_event, view) => {
      const currentValue = view.state.doc.toString();
      const validation = validateManifestJson(currentValue);
      if (validation.status === "invalid") {
        return;
      }

      const formattedValue = formatSlackManifestJson(currentValue);
      if (formattedValue !== currentValue) {
        input.onManifestChange(formattedValue);
      }
    },
  });
}

function hasConfiguredSecret(connection: IntegrationConnection, fieldName: string): boolean {
  return connection.configuredSecretNames?.includes(fieldName) ?? false;
}

function isSlackAppInstalled(connection: IntegrationConnection): boolean {
  return (
    typeof connection.config?.["client_id"] === "string" &&
    hasConfiguredSecret(connection, "botToken") &&
    hasConfiguredSecret(connection, "signingSecret")
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

function buildDraftWithSavedFieldValues(input: {
  baseDraft: SlackExistingAppDraft;
  draft: SlackExistingAppDraft;
  fieldKey: SlackExistingAppFieldKey;
}): SlackExistingAppDraft {
  return {
    ...input.baseDraft,
    clientId: normalizeSlackExistingAppSetupValue(input.draft.clientId),
    ...(isSlackExistingAppSecretFieldKey(input.fieldKey)
      ? { [input.fieldKey]: normalizeSlackExistingAppSetupValue(input.draft[input.fieldKey]) }
      : {}),
  };
}

function SlackManifestSetupPanel(input: {
  appConfigToken: string;
  manifestValue: string;
  manifestValidation: ManifestValidation;
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
        <div className="overflow-hidden rounded-md border">
          <CodeMirror
            basicSetup={{
              foldGutter: false,
              highlightActiveLine: false,
              highlightActiveLineGutter: false,
              lineNumbers: false,
            }}
            className="text-sm"
            extensions={[
              json(),
              linter(jsonParseLinter()),
              createSlackManifestFormatOnBlurExtension({
                onManifestChange: input.onManifestChange,
              }),
            ]}
            id="slack-app-manifest-editor"
            onChange={input.onManifestChange}
            value={input.manifestValue}
          />
        </div>
        {input.manifestValidation.status === "invalid" ? (
          <p className="text-destructive text-sm">{input.manifestValidation.message}</p>
        ) : null}
      </div>
    </div>
  );
}

function SlackExistingAppSetupPanel(input: {
  configuredSecretFieldKeys: ReadonlySet<SlackExistingAppSecretFieldKey>;
  draft: SlackExistingAppDraft;
  fieldStates: Record<SlackExistingAppFieldKey, SavingFieldState>;
  onCommitField: (fieldKey: SlackExistingAppFieldKey) => void;
  onRevertSecretReplacement: (fieldKey: SlackExistingAppSecretFieldKey) => void;
  onUpdateFieldDraft: (fieldKey: SlackExistingAppFieldKey, nextValue: string) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-medium">Existing Slack App</h2>
          <p className="text-muted-foreground text-sm">
            Paste values from a Slack app you already created or configured in Slack.
          </p>
        </div>
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
        <h2 className="text-base font-medium">Secrets</h2>
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
          secretLabel="client secret"
          type="password"
          value={input.draft.clientSecret}
        />
      </div>
    </div>
  );
}

function SlackSetupUrls(input: {
  webhookCallbackState:
    | {
        kind: "loading";
      }
    | {
        kind: "error";
        message: string;
      }
    | {
        kind: "ready";
        value: string;
      }
    | {
        kind: "missing";
      };
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-medium">Slack app URLs</h2>
        <p className="text-muted-foreground text-sm">
          Copy this URL into Slack Event Subscriptions so Mistle can receive app events.
        </p>
      </div>
      <div className="flex flex-col gap-4">
        {input.webhookCallbackState.kind === "loading" ? (
          <CopyableValue label="Events API Request URL" loading />
        ) : input.webhookCallbackState.kind === "error" ? (
          <Notice title="Could not load Events API Request URL" variant="alert">
            {input.webhookCallbackState.message}
          </Notice>
        ) : input.webhookCallbackState.kind === "missing" ? (
          <Notice title="Events API Request URL is not available yet" variant="alert">
            Slack setup requires an Events API Request URL, but this connection does not have one
            yet.
          </Notice>
        ) : (
          <CopyableValue label="Events API Request URL" value={input.webhookCallbackState.value} />
        )}
      </div>
    </div>
  );
}

export function IntegrationConnectionSlackAppSetupPage(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const params = useParams();
  const { title, description } = resolvePageFrameText(pageMeta, "Set Up Slack App");
  const targetKey = params["targetKey"];
  const connectionId = params["connectionId"];

  if (targetKey === undefined || connectionId === undefined) {
    throw new Error("Integration target key and connection id are required.");
  }

  const directoryQuery = useQuery({
    queryKey: SETTINGS_INTEGRATIONS_QUERY_KEY,
    queryFn: async ({ signal }) => listIntegrationDirectory({ signal }),
    retry: false,
  });

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

  return (
    <FormPageFrame
      description={description}
      headerIcon={pageMeta.headerIcon ?? undefined}
      title={title}
    >
      <SlackAppSetupPane connection={connection} key={connection.id} />
    </FormPageFrame>
  );
}

export function SlackAppSetupPane(input: { connection: IntegrationConnection }): React.JSX.Element {
  const queryClient = useQueryClient();
  const [setupMode, setSetupMode] = useState<SlackSetupMode>(() =>
    isSlackAppInstalled(input.connection) ? "existing-app" : "manifest",
  );
  const [manifestValue, setManifestValue] = useState(SlackDraftManifest);
  const [appConfigToken, setAppConfigToken] = useState("");
  const [existingAppDraft, setExistingAppDraft] = useState(() =>
    createInitialExistingAppDraft(input.connection),
  );
  const [savedExistingAppDraft, setSavedExistingAppDraft] = useState(() =>
    createInitialExistingAppDraft(input.connection),
  );
  const [configuredSecretFieldKeys, setConfiguredSecretFieldKeys] = useState(() =>
    resolveConfiguredSecretFieldKeys(input.connection),
  );
  const [fieldStates, setFieldStates] = useState(() => createInitialFieldStates());
  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(null);
  const fieldTimeoutRefs = useRef(createFieldTimeoutRefs());
  const webhookSourcesQuery = useQuery({
    enabled: setupMode === "existing-app",
    queryKey: ["integration-webhook-sources", input.connection.id],
    queryFn: async ({ signal }) =>
      listIntegrationWebhookSources({
        connectionId: input.connection.id,
        signal,
      }),
    retry: false,
  });

  const startManifestMutation = useMutation({
    mutationFn: async () =>
      startSlackAppManifestCreation({
        connectionId: input.connection.id,
        manifest: parseManifestObject(manifestValue),
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
        clearPendingStatusTimeouts({
          fadeEndTimeoutRef: fieldTimeoutRefs.current[fieldKey].fadeEndTimeoutRef,
          fadeStartTimeoutRef: fieldTimeoutRefs.current[fieldKey].fadeStartTimeoutRef,
          scheduler: systemScheduler,
        });
      }
    };
  }, []);

  function resetFieldFeedback(fieldKey: SlackExistingAppFieldKey): void {
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

      const nextSavedDraft = buildDraftWithSavedFieldValues({
        baseDraft: savedExistingAppDraft,
        draft: existingAppDraft,
        fieldKey,
      });
      const nextDraft = buildDraftWithSavedFieldValues({
        baseDraft: existingAppDraft,
        draft: existingAppDraft,
        fieldKey,
      });

      setSavedExistingAppDraft(nextSavedDraft);
      setExistingAppDraft(nextDraft);
      if (isSlackExistingAppSecretFieldKey(fieldKey)) {
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

  const manifestValidation = validateManifestJson(manifestValue);
  const canCreateManifest =
    manifestValidation.status === "valid" && appConfigToken.trim().length > 0;
  const webhookCallbackUrl = webhookSourcesQuery.data?.[0]?.callbackUrl;
  const webhookCallbackState:
    | {
        kind: "loading";
      }
    | {
        kind: "error";
        message: string;
      }
    | {
        kind: "ready";
        value: string;
      }
    | {
        kind: "missing";
      } = webhookSourcesQuery.isPending
    ? { kind: "loading" }
    : webhookSourcesQuery.isError
      ? {
          kind: "error",
          message: resolveApiErrorMessage({
            error: webhookSourcesQuery.error,
            fallbackMessage: "Could not load integration webhook sources.",
          }),
        }
      : webhookCallbackUrl === undefined
        ? { kind: "missing" }
        : { kind: "ready", value: webhookCallbackUrl };

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
        <div className="flex flex-col gap-1 px-1">
          <h2 className="text-lg font-medium">Choose a setup method</h2>
          <p className="text-muted-foreground text-sm">
            Create a new Slack app with a manifest or connect an app you&apos;ve already configured
            in Slack.
          </p>
        </div>

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
              <SlackManifestSetupPanel
                appConfigToken={appConfigToken}
                manifestValidation={manifestValidation}
                manifestValue={manifestValue}
                onAppConfigTokenChange={setAppConfigToken}
                onManifestChange={setManifestValue}
              />
            </TabsContent>

            <TabsContent value="existing-app">
              <SlackExistingAppSetupPanel
                configuredSecretFieldKeys={configuredSecretFieldKeys}
                draft={existingAppDraft}
                fieldStates={fieldStates}
                onCommitField={(fieldKey) => {
                  void persistExistingAppField(fieldKey);
                }}
                onRevertSecretReplacement={revertSecretReplacement}
                onUpdateFieldDraft={updateExistingAppFieldDraft}
              />
            </TabsContent>

            {setupMode === "existing-app" ? (
              <SlackSetupUrls webhookCallbackState={webhookCallbackState} />
            ) : null}

            {setupMode === "manifest" ? (
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
          </div>
        </FormPageSection>
      </Tabs>
    </FormPageStack>
  );
}
