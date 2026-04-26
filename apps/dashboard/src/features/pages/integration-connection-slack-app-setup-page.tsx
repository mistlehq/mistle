import { json, jsonParseLinter } from "@codemirror/lang-json";
import { linter } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import {
  Button,
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
import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import { resolveApiErrorMessage } from "../api/error-message.js";
import { ConfiguredSecretField, type SavingFieldState } from "../forms/configured-secret-field.js";
import { buildIntegrationCards } from "../integrations/directory-model.js";
import {
  listIntegrationDirectory,
  startSlackAppManifestCreation,
  updateFormIntegrationConnection,
} from "../integrations/integrations-service.js";
import type { IntegrationConnection } from "../integrations/integrations-service.js";
import { useAppPageMeta } from "../navigation/route-meta.js";
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

type ManifestValidation =
  | {
      status: "valid";
    }
  | {
      status: "invalid";
      message: string;
    };

const SlackConnectionMethodId = "slack-bot-token";
const IdleSavingFieldState = {
  status: "idle",
  errorMessage: null,
} as const satisfies SavingFieldState;

const SlackDraftBotScopes = [
  "app_mentions:read",
  "channels:history",
  "channels:read",
  "chat:write",
  "groups:history",
  "groups:read",
  "reactions:read",
  "users:read",
] as const;

const SlackDraftBotEvents = [
  "app_mention",
  "message.channels",
  "message.groups",
  "reaction_added",
  "reaction_removed",
] as const;

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
        bot_events: SlackDraftBotEvents,
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
        bot: SlackDraftBotScopes,
      },
    },
  },
  null,
  2,
);

const SlackManifestEditorExtensions = [json(), linter(jsonParseLinter()), EditorView.lineWrapping];

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

function formatManifestOnBlur(input: { value: string; onChange: (value: string) => void }): void {
  if (validateManifestJson(input.value).status !== "valid") {
    return;
  }

  input.onChange(JSON.stringify(parseManifestObject(input.value), null, 2));
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

function buildSlackExistingAppSecrets(draft: SlackExistingAppDraft): Record<string, string> {
  return Object.fromEntries(
    Object.entries({
      botToken: draft.botToken.trim(),
      signingSecret: draft.signingSecret.trim(),
      clientSecret: draft.clientSecret.trim(),
    }).filter((entry) => entry[1].length > 0),
  );
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
            aria-label="Slack app manifest JSON"
            basicSetup={{
              foldGutter: false,
              highlightActiveLine: false,
              highlightActiveLineGutter: false,
              lineNumbers: false,
            }}
            extensions={SlackManifestEditorExtensions}
            height="360px"
            onBlur={() => {
              formatManifestOnBlur({
                value: input.manifestValue,
                onChange: input.onManifestChange,
              });
            }}
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
  configuredSecretNames: readonly string[];
  draft: SlackExistingAppDraft;
  onDraftChange: (draft: SlackExistingAppDraft) => void;
}): React.JSX.Element {
  function updateDraft(field: keyof SlackExistingAppDraft, value: string): void {
    input.onDraftChange({
      ...input.draft,
      [field]: value,
    });
  }

  function isConfigured(fieldName: "botToken" | "signingSecret" | "clientSecret"): boolean {
    return input.configuredSecretNames.includes(fieldName);
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field>
        <FieldHeader>
          <FieldLabel htmlFor="slack-client-id">Client ID</FieldLabel>
        </FieldHeader>
        <FieldContent>
          <Input
            id="slack-client-id"
            onChange={(event) => updateDraft("clientId", event.target.value)}
            value={input.draft.clientId}
          />
        </FieldContent>
      </Field>
      <ConfiguredSecretField
        configured={isConfigured("clientSecret")}
        fieldState={IdleSavingFieldState}
        id="slack-client-secret"
        label="Client secret"
        onCancelReplace={() => updateDraft("clientSecret", "")}
        onChange={(nextValue) => updateDraft("clientSecret", nextValue)}
        onCommit={() => {}}
        secretLabel="client secret"
        type="password"
        value={input.draft.clientSecret}
      />
      <ConfiguredSecretField
        configured={isConfigured("botToken")}
        fieldState={IdleSavingFieldState}
        id="slack-bot-token"
        label="Bot token"
        onCancelReplace={() => updateDraft("botToken", "")}
        onChange={(nextValue) => updateDraft("botToken", nextValue)}
        onCommit={() => {}}
        placeholder="xoxb-..."
        required={!isConfigured("botToken")}
        secretLabel="bot token"
        type="password"
        value={input.draft.botToken}
      />
      <ConfiguredSecretField
        configured={isConfigured("signingSecret")}
        fieldState={IdleSavingFieldState}
        id="slack-signing-secret"
        label="Signing secret"
        onCancelReplace={() => updateDraft("signingSecret", "")}
        onChange={(nextValue) => updateDraft("signingSecret", nextValue)}
        onCommit={() => {}}
        required={!isConfigured("signingSecret")}
        secretLabel="signing secret"
        type="password"
        value={input.draft.signingSecret}
      />
    </div>
  );
}

export function IntegrationConnectionSlackAppSetupPage(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const params = useParams();
  const [searchParams] = useSearchParams();
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
      <SlackAppSetupPane
        connection={connection}
        installSucceeded={searchParams.get("slackApp") === "installed"}
        key={connection.id}
      />
    </FormPageFrame>
  );
}

export function SlackAppSetupPane(input: {
  connection: IntegrationConnection;
  installSucceeded?: boolean;
}): React.JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [setupMode, setSetupMode] = useState<SlackSetupMode>(() =>
    isSlackAppInstalled(input.connection) ? "existing-app" : "manifest",
  );
  const [manifestValue, setManifestValue] = useState(SlackDraftManifest);
  const [appConfigToken, setAppConfigToken] = useState("");
  const [initialExistingAppDraft] = useState(() => createInitialExistingAppDraft(input.connection));
  const [existingAppDraft, setExistingAppDraft] = useState(() =>
    createInitialExistingAppDraft(input.connection),
  );
  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(null);

  const startManifestMutation = useMutation({
    mutationFn: async () =>
      startSlackAppManifestCreation({
        connectionId: input.connection.id,
        manifest: parseManifestObject(manifestValue),
        appConfigToken,
      }),
  });

  const updateExistingAppMutation = useMutation({
    mutationFn: async () =>
      updateFormIntegrationConnection({
        connectionId: input.connection.id,
        displayName: input.connection.displayName,
        config: {
          connection_method: SlackConnectionMethodId,
          ...(existingAppDraft.clientId.trim().length === 0
            ? {}
            : { client_id: existingAppDraft.clientId.trim() }),
        },
        secrets: buildSlackExistingAppSecrets(existingAppDraft),
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

  async function saveExistingApp(): Promise<void> {
    setActionErrorMessage(null);
    try {
      await updateExistingAppMutation.mutateAsync();
      await queryClient.invalidateQueries({
        queryKey: SETTINGS_INTEGRATIONS_QUERY_KEY,
      });
    } catch (error) {
      setActionErrorMessage(
        resolveApiErrorMessage({
          error,
          fallbackMessage: "Could not save Slack app setup.",
        }),
      );
    }
  }

  const manifestValidation = validateManifestJson(manifestValue);
  const canCreateManifest =
    manifestValidation.status === "valid" && appConfigToken.trim().length > 0;
  const canSaveExistingApp =
    existingAppDraft.botToken.trim().length > 0 ||
    existingAppDraft.signingSecret.trim().length > 0 ||
    existingAppDraft.clientSecret.trim().length > 0 ||
    existingAppDraft.clientId.trim() !== initialExistingAppDraft.clientId.trim();

  if (input.installSucceeded === true) {
    return (
      <FormPageStack>
        <Notice title="Slack app installed" variant="success">
          The Slack app has been installed and its bot token has been saved to this Mistle
          connection.
        </Notice>
        <FormPageSection>
          <div className="flex flex-col gap-6 p-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-medium">Continue with Slack</h2>
              <p className="text-muted-foreground text-sm">
                Mistle has saved the Slack app credentials and webhook configuration for this
                connection.
              </p>
            </div>
            <FormPageActionBar>
              <Button
                onClick={() => {
                  void navigate(
                    `/integrations/${encodeURIComponent(input.connection.targetKey)}?connectionId=${encodeURIComponent(input.connection.id)}`,
                  );
                }}
                type="button"
              >
                Continue
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
                configuredSecretNames={input.connection.configuredSecretNames ?? []}
                draft={existingAppDraft}
                onDraftChange={setExistingAppDraft}
              />
            </TabsContent>

            <FormPageActionBar>
              {setupMode === "manifest" ? (
                <Button
                  disabled={!canCreateManifest || startManifestMutation.isPending}
                  onClick={() => {
                    void createSlackApp();
                  }}
                  type="button"
                >
                  Create Slack App
                </Button>
              ) : (
                <Button
                  disabled={!canSaveExistingApp || updateExistingAppMutation.isPending}
                  onClick={() => {
                    void saveExistingApp();
                  }}
                  type="button"
                >
                  Save Slack App
                </Button>
              )}
            </FormPageActionBar>
          </div>
        </FormPageSection>
      </Tabs>
    </FormPageStack>
  );
}
