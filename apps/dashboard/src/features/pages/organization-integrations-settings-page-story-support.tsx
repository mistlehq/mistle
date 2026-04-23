import { json } from "@codemirror/lang-json";
import { EditorView } from "@codemirror/view";
import type { AnyIntegrationDefinition } from "@mistle/integrations-core";
import { createBrowserIntegrationRegistry } from "@mistle/integrations-definitions/browser";
import { createOpenAiRawBindingCapabilitiesByConnectionMethod } from "@mistle/integrations-definitions/openai";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  DefinitionList,
  CardHeader,
  CardTitle,
  Field,
  FieldContent,
  FieldDescription,
  FieldHeader,
  FieldLabel,
  Input,
  Notice,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@mistle/ui";
import { InfoIcon } from "@phosphor-icons/react";
import CodeMirror from "@uiw/react-codemirror";
import { useState } from "react";
import type React from "react";

import { GitHubAppInstallationConnectionConfigForm } from "../../../../../packages/integrations-definitions/src/github/shared/connection-config-form.js";
import {
  IntegrationConnectionEditorPage,
  type IntegrationConnectionMethodId,
} from "../integrations/integration-connection-editor.js";
import type { IntegrationConnectionMethod } from "../integrations/integrations-service-shared.js";
import { FormPageActionBar, FormPageSection, FormPageStack } from "../shared/form-page.js";
import { FormPageFrame } from "../shared/page-frame.js";
import type { OpenIntegrationConnectionEditorInput } from "./integration-connection-editor-state-types.js";
import type { OrganizationIntegrationsSettingsPageCard } from "./organization-integrations-settings-page-view.js";
import {
  createInitialIntegrationConnectionEditorState,
  hasIntegrationConnectionEditorChanges,
  isIntegrationConnectionDisplayNameChanged,
  resolveConnectionMethodFormUiModel,
  resolveDefaultMethodId,
  resolveIntegrationConnectionEditorValidationError,
  resolveNextDraftForMethodChange,
} from "./use-integration-connection-editor-state-helpers.js";

const IntegrationRegistry = createBrowserIntegrationRegistry();
type BuiltInIntegrationVariantId =
  | "github-cloud"
  | "github-enterprise-server"
  | "jira-default"
  | "linear-default"
  | "openai-default";

type StoryIntegrationSpec = {
  connectError?: string | null;
  initialConnectionDisplayNameValue?: string;
  initialMethodId?: IntegrationConnectionMethodId;
  initialSecrets?: Record<string, string>;
  pending?: boolean;
  targetKey?: string;
  variantId: BuiltInIntegrationVariantId;
};

function getDefinitionOrThrow(input: {
  familyId: string;
  variantId: BuiltInIntegrationVariantId;
}): AnyIntegrationDefinition {
  const definition = IntegrationRegistry.getDefinition({
    familyId: input.familyId,
    variantId: input.variantId,
  });
  if (definition === null) {
    throw new Error(
      `Missing browser integration definition '${input.familyId}/${input.variantId}' for Storybook.`,
    );
  }

  if (definition === undefined) {
    throw new Error(
      `Browser integration definition '${input.familyId}/${input.variantId}' resolved to undefined.`,
    );
  }

  return definition;
}

function getStoryDefinitionOrThrow(
  variantId: BuiltInIntegrationVariantId,
): AnyIntegrationDefinition {
  if (variantId === "github-cloud" || variantId === "github-enterprise-server") {
    return getDefinitionOrThrow({
      familyId: "github",
      variantId,
    });
  }

  if (variantId === "jira-default") {
    return getDefinitionOrThrow({
      familyId: "jira",
      variantId,
    });
  }

  if (variantId === "linear-default") {
    return getDefinitionOrThrow({
      familyId: "linear",
      variantId,
    });
  }

  return getDefinitionOrThrow({
    familyId: "openai",
    variantId,
  });
}

function resolveStorySchemaProperty(input: {
  propertyKey: string;
  schema: unknown;
}): Record<string, unknown> {
  if (typeof input.schema !== "object" || input.schema === null || Array.isArray(input.schema)) {
    return {};
  }

  const schemaRecord = input.schema as Record<string, unknown>;
  const properties = schemaRecord["properties"];
  if (typeof properties !== "object" || properties === null || Array.isArray(properties)) {
    return {};
  }

  const property = (properties as Record<string, unknown>)[input.propertyKey];
  if (typeof property !== "object" || property === null || Array.isArray(property)) {
    return {};
  }

  return property as Record<string, unknown>;
}

function resolveConnectionMethodsOrThrow(
  definition: AnyIntegrationDefinition,
): readonly IntegrationConnectionMethod[] {
  if (definition.connectionMethods === undefined || definition.connectionMethods.length === 0) {
    throw new Error(
      `Integration definition '${definition.familyId}/${definition.variantId}' has no connection methods.`,
    );
  }

  return definition.connectionMethods.map((method) => {
    if (method.kind === "form") {
      return {
        id: method.id,
        kind: method.kind,
        label: method.label,
        secretFields: method.secretFields.map((secretField) => ({
          description: secretField.description,
          inputType: secretField.inputType,
          label: secretField.label,
          name: secretField.name,
          placeholder: secretField.placeholder,
        })),
      };
    }

    return {
      id: method.id,
      kind: method.kind,
      label: method.label,
      ui: method.ui,
    };
  });
}

function resolveDescriptionOrThrow(definition: AnyIntegrationDefinition): string {
  if (definition.description === undefined) {
    throw new Error(
      `Integration definition '${definition.familyId}/${definition.variantId}' is missing a description.`,
    );
  }

  return definition.description;
}

function createTargetConfig(variantId: BuiltInIntegrationVariantId): Record<string, unknown> {
  if (variantId === "github-cloud") {
    return {
      api_base_url: "https://api.github.com",
      web_base_url: "https://github.com",
      app_id: "17452",
      app_slug: "mistle-cloud",
      client_id: "Iv1.cloudstorybook",
    };
  }

  if (variantId === "github-enterprise-server") {
    return {
      api_base_url: "https://github.acme.example/api/v3",
      web_base_url: "https://github.acme.example",
      app_id: "88421",
      app_slug: "mistle-ghes",
      client_id: "Iv1.ghesstorybook",
    };
  }

  if (variantId === "openai-default") {
    return {
      api_base_url: "https://api.openai.com/v1",
      binding_capabilities_by_connection_method:
        createOpenAiRawBindingCapabilitiesByConnectionMethod(),
    };
  }

  return {};
}

function createEditorInput(
  spec: StoryIntegrationSpec,
): Extract<OpenIntegrationConnectionEditorInput, { mode: "create" }> {
  const definition = getStoryDefinitionOrThrow(spec.variantId);
  const methods = resolveConnectionMethodsOrThrow(definition);

  return {
    mode: "create",
    methods,
    targetConfig: createTargetConfig(spec.variantId),
    targetDisplayName: definition.displayName,
    targetFamilyId: definition.familyId,
    targetKey: spec.targetKey ?? definition.variantId,
    targetVariantId: definition.variantId,
  };
}

export function createAvailableCardsOverview(): readonly OrganizationIntegrationsSettingsPageCard[] {
  const specs: readonly StoryIntegrationSpec[] = [
    { variantId: "jira-default" },
    { variantId: "github-cloud" },
    { variantId: "github-enterprise-server" },
    { variantId: "linear-default" },
    { variantId: "openai-default" },
  ];

  return specs.map((spec) => {
    const definition = getStoryDefinitionOrThrow(spec.variantId);

    return {
      actionLabel: "Add",
      configStatus: "valid",
      description: resolveDescriptionOrThrow(definition),
      displayName: definition.displayName,
      ...(definition.logoKey === undefined ? {} : { logoKey: definition.logoKey }),
      onAction: () => {},
      targetKey: definition.variantId,
    };
  });
}

export function IntegrationSettingsAddFlowStory(spec: StoryIntegrationSpec): React.JSX.Element {
  return <IntegrationSettingsAddFlowStoryContent spec={spec} />;
}

function IntegrationSettingsAddFlowStoryContent(input: {
  afterEditor?: React.ReactNode;
  spec: StoryIntegrationSpec;
}): React.JSX.Element {
  const spec = input.spec;
  const initialEditorInput = createEditorInput(spec);
  const defaultMethodId =
    spec.initialMethodId ??
    resolveDefaultMethodId(
      resolveConnectionMethodsOrThrow(getStoryDefinitionOrThrow(spec.variantId)),
    );
  const initialState = createInitialIntegrationConnectionEditorState({
    defaultMethodId,
    initialEditorInput,
  });
  const startsWithoutSelectedMethod =
    initialEditorInput.methods.length > 1 && spec.initialMethodId === undefined;
  const [draft, setDraft] = useState(() => ({
    ...initialState.draft,
    connectionDisplayNameValue: spec.initialConnectionDisplayNameValue ?? "",
    error: spec.connectError ?? initialState.draft.error,
    methodId: startsWithoutSelectedMethod ? "" : initialState.draft.methodId,
    secrets: spec.initialSecrets ?? initialState.draft.secrets,
  }));

  const editor = initialState.editor;
  const configForm =
    draft.methodId.length === 0
      ? {
          mode: "none" as const,
        }
      : resolveConnectionMethodFormUiModel({
          editor,
          methodId: draft.methodId,
          currentValue: draft.configValue,
        });

  return (
    <FormPageFrame title={`Add ${initialEditorInput.targetDisplayName} Connection`}>
      <div className="flex flex-col gap-4">
        <IntegrationConnectionEditorPage
          configForm={configForm}
          configValue={draft.configValue}
          closeDisabled={spec.pending ?? false}
          connectionDisplayNamePlaceholder={draft.connectionDisplayNamePlaceholder}
          connectionDisplayNameValue={draft.connectionDisplayNameValue}
          connectError={draft.error}
          editor={editor}
          hasChanges={hasIntegrationConnectionEditorChanges({
            editor,
            configValue: draft.configValue,
            connectionDisplayNamePlaceholder: draft.connectionDisplayNamePlaceholder,
            connectionDisplayNameValue: draft.connectionDisplayNameValue,
            initialConfigValue: draft.initialConfigValue,
            secrets: draft.secrets,
          })}
          isConnectionDisplayNameChanged={isIntegrationConnectionDisplayNameChanged({
            editor,
            connectionDisplayNamePlaceholder: draft.connectionDisplayNamePlaceholder,
            connectionDisplayNameValue: draft.connectionDisplayNameValue,
          })}
          isSecretChanged={Object.values(draft.secrets).some((value) => value.trim().length > 0)}
          methodId={draft.methodId}
          onClose={() => {}}
          onConfigChange={(value) => {
            setDraft((currentDraft) => ({
              ...currentDraft,
              configValue: value,
              error: null,
            }));
          }}
          onConnectionDisplayNameChange={(value) => {
            setDraft((currentDraft) => ({
              ...currentDraft,
              connectionDisplayNameValue: value,
              error: null,
            }));
          }}
          onMethodChange={(methodId) => {
            setDraft((currentDraft) =>
              resolveNextDraftForMethodChange({
                editor,
                nextMethodId: methodId,
                currentDraft,
              }),
            );
          }}
          onSecretChange={(name, value) => {
            setDraft((currentDraft) => ({
              ...currentDraft,
              error: null,
              secrets: {
                ...currentDraft.secrets,
                [name]: value,
              },
            }));
          }}
          onSubmit={() => {
            setDraft((currentDraft) => ({
              ...currentDraft,
              error:
                currentDraft.methodId.length === 0
                  ? "Authentication method is required."
                  : (resolveIntegrationConnectionEditorValidationError({
                      editor,
                      methodId: currentDraft.methodId,
                      connectionDisplayNameValue: currentDraft.connectionDisplayNameValue,
                      secrets: currentDraft.secrets,
                    }) ?? null),
            }));
          }}
          pending={spec.pending ?? false}
          secrets={draft.secrets}
        />
        {input.afterEditor ?? null}
      </div>
    </FormPageFrame>
  );
}

type GitHubAppSetupPath = "existing-app" | "create-app";
type GitHubAppManagedSetupStage =
  | "draft"
  | "redirecting"
  | "credentials-created"
  | "ready-to-install"
  | "installed";

const GitHubDraftManifest = JSON.stringify(
  {
    name: "Mistle GitHub",
    url: "https://mistle.example.com/integrations/github",
    description: "GitHub App used by Mistle for repository access and webhook delivery.",
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
      issues: "write",
      metadata: "read",
      pull_requests: "write",
    },
    request_oauth_on_install: true,
    setup_on_update: true,
  },
  null,
  2,
);

function GitHubManagedSetupSummary(input: {
  onBack: () => void;
  onContinue: () => void;
  onReset: () => void;
  stage: GitHubAppManagedSetupStage;
}): React.JSX.Element {
  const [manifestValue, setManifestValue] = useState(GitHubDraftManifest);
  const stageLines: Record<
    GitHubAppManagedSetupStage,
    {
      cta: string;
      description: string;
      helper?: string;
      title: string;
    }
  > = {
    draft: {
      cta: "Create GitHub App In GitHub",
      description:
        "Mistle prepares the app configuration, including permissions, webhook URL, and post-install setup URL.",
      helper:
        "The app is still created inside the user's own GitHub account or organization. Mistle only preconfigures the registration.",
      title: "Start with Mistle-managed setup",
    },
    redirecting: {
      cta: "Simulate GitHub Redirect Back To Mistle",
      description:
        "The user is in GitHub's manifest flow, chooses their GitHub org or personal account, and confirms app creation there.",
      helper:
        "GitHub returns a temporary code. Mistle exchanges that code for the generated app credentials.",
      title: "GitHub creates the customer-owned app",
    },
    "credentials-created": {
      cta: "Continue To Installation",
      description:
        "Mistle has stored the generated app ID, slug, webhook secret, client secret, and private key PEM on the connection.",
      helper:
        "At this point the connection has everything the current manual flow asks the user to paste in by hand.",
      title: "App credentials are now on the connection",
    },
    "ready-to-install": {
      cta: "Simulate Completed Installation",
      description:
        "The app exists already. The remaining step is the existing install flow so GitHub can return installation_id for the selected repos or org.",
      helper:
        "This is the convergence point with today's flow: create app first, then install app.",
      title: "Reuse the existing GitHub App install redirect",
    },
    installed: {
      cta: "Restart Proposed Flow",
      description:
        "The connection now has both the app credentials and installation_id, so webhook delivery and repository access can work with the current contract.",
      helper:
        "This final state matches what Mistle already expects after a successful manual setup plus installation.",
      title: "Installed and ready",
    },
  };
  const stageView = stageLines[input.stage];

  return (
    <FormPageFrame title="Create GitHub App With A Manifest">
      <FormPageStack>
        <FormPageSection>
          <div className="p-4">
            <DefinitionList
              items={[
                {
                  id: "connection-name",
                  label: "Name",
                  value: "Mistle GitHub",
                },
                {
                  id: "auth-method",
                  label: "Authentication method",
                  value: "GitHub App installation",
                },
              ]}
            />
          </div>
        </FormPageSection>
        <FormPageSection>
          <div className="flex flex-col gap-6 p-4">
            {input.stage === "draft" ? (
              <Field contentWidth="fill" orientation="vertical">
                <FieldHeader>
                  <FieldLabel htmlFor="github-app-manifest-editor">GitHub App manifest</FieldLabel>
                  <FieldDescription>
                    Mistle generates this manifest for your GitHub App. You can review or edit it
                    before continuing.
                  </FieldDescription>
                </FieldHeader>
                <FieldContent>
                  <div className="overflow-hidden rounded-md border">
                    <CodeMirror
                      basicSetup={{
                        foldGutter: false,
                        highlightActiveLine: false,
                        highlightActiveLineGutter: false,
                      }}
                      className="text-sm"
                      extensions={[json(), EditorView.lineWrapping]}
                      height="420px"
                      id="github-app-manifest-editor"
                      onChange={(value) => {
                        setManifestValue(value);
                      }}
                      value={manifestValue}
                    />
                  </div>
                </FieldContent>
              </Field>
            ) : (
              <>
                <Notice title={stageView.title}>{stageView.description}</Notice>
                {stageView.helper === undefined ? null : (
                  <p className="text-muted-foreground text-sm">{stageView.helper}</p>
                )}
                <Card className="shadow-none">
                  <CardHeader className="gap-1">
                    <CardTitle className="text-base">Connection shape after this step</CardTitle>
                    <CardDescription>
                      The proposed flow still converges into the existing GitHub App installation
                      connection shape.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-2 text-sm">
                    <div>
                      <span className="font-medium">Connection method:</span> GitHub App
                      installation
                    </div>
                    <div>
                      <span className="font-medium">Before manifest exchange:</span> no app secrets
                      saved yet
                    </div>
                    <div>
                      <span className="font-medium">After manifest exchange:</span> `app_id`,
                      `app_slug`, PEM, webhook secret, optional client secret
                    </div>
                    <div>
                      <span className="font-medium">After installation:</span> `installation_id`
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
            <FormPageActionBar>
              <Button onClick={input.onBack} type="button" variant="outline">
                Back
              </Button>
              <Button
                onClick={input.stage === "installed" ? input.onReset : input.onContinue}
                type="button"
              >
                {stageView.cta}
              </Button>
            </FormPageActionBar>
          </div>
        </FormPageSection>
      </FormPageStack>
    </FormPageFrame>
  );
}

function ExistingGitHubAppSetupStory(): React.JSX.Element {
  const definition = getStoryDefinitionOrThrow("github-cloud");
  const methods = resolveConnectionMethodsOrThrow(definition);
  const appInstallationMethod = methods.find((method) => method.id === "github-app-installation");

  if (appInstallationMethod === undefined || appInstallationMethod.kind !== "form") {
    throw new Error("Expected GitHub App installation form method for Storybook.");
  }

  const initialEditorInput = createEditorInput({
    initialConnectionDisplayNameValue: "Mistle GitHub",
    initialMethodId: "github-app-installation",
    targetKey: "github-cloud",
    variantId: "github-cloud",
  });
  const initialState = createInitialIntegrationConnectionEditorState({
    defaultMethodId: "github-app-installation",
    initialEditorInput,
  });
  const [configValue, setConfigValue] = useState(initialState.draft.configValue);
  const [secrets, setSecrets] = useState<Record<string, string>>(initialState.draft.secrets);
  const configFieldKeys = ["app_id", "app_slug", "client_id"] as const;
  const configSchema = GitHubAppInstallationConnectionConfigForm.schema;

  return (
    <FormPageFrame title="Set Up An Existing GitHub App">
      <FormPageStack>
        <FormPageSection>
          <div className="p-4">
            <DefinitionList
              items={[
                {
                  id: "connection-name",
                  label: "Name",
                  value: "Mistle GitHub",
                },
                {
                  id: "auth-method",
                  label: "Authentication method",
                  value: "GitHub App installation",
                },
              ]}
            />
          </div>
        </FormPageSection>
        <FormPageSection>
          <div className="flex flex-col gap-6 p-4">
            {configFieldKeys.map((propertyKey) => {
              const propertySchema = resolveStorySchemaProperty({
                propertyKey,
                schema: configSchema,
              });
              const title =
                typeof propertySchema["title"] === "string" && propertySchema["title"].length > 0
                  ? propertySchema["title"]
                  : propertyKey;
              const description =
                typeof propertySchema["description"] === "string"
                  ? propertySchema["description"]
                  : undefined;
              const value =
                typeof configValue[propertyKey] === "string" ? configValue[propertyKey] : "";

              return (
                <Field contentWidth="fill" key={propertyKey} orientation="vertical">
                  <FieldHeader>
                    <FieldLabel htmlFor={`existing-github-config-${propertyKey}`}>
                      {title}
                    </FieldLabel>
                    {description === undefined ? null : (
                      <FieldDescription>{description}</FieldDescription>
                    )}
                  </FieldHeader>
                  <FieldContent>
                    <Input
                      id={`existing-github-config-${propertyKey}`}
                      onChange={(event) => {
                        setConfigValue((currentConfigValue) => ({
                          ...currentConfigValue,
                          [propertyKey]: event.currentTarget.value,
                        }));
                      }}
                      type="text"
                      value={value}
                    />
                  </FieldContent>
                </Field>
              );
            })}
            {appInstallationMethod.secretFields.map((secretField) => (
              <Field contentWidth="fill" key={secretField.name} orientation="vertical">
                <FieldHeader>
                  <FieldLabel htmlFor={`existing-github-app-${secretField.name}`}>
                    {secretField.label}
                    {secretField.optional ? " (Optional)" : ""}
                  </FieldLabel>
                  {secretField.description === undefined ? null : (
                    <FieldDescription>{secretField.description}</FieldDescription>
                  )}
                </FieldHeader>
                <FieldContent>
                  {secretField.inputType === "textarea" ? (
                    <Textarea
                      id={`existing-github-app-${secretField.name}`}
                      onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
                        setSecrets((currentSecrets) => ({
                          ...currentSecrets,
                          [secretField.name]: event.currentTarget.value,
                        }));
                      }}
                      placeholder={
                        secretField.placeholder ?? `Enter ${secretField.label.toLowerCase()}`
                      }
                      rows={8}
                      value={secrets[secretField.name] ?? ""}
                    />
                  ) : (
                    <Input
                      id={`existing-github-app-${secretField.name}`}
                      onChange={(event) => {
                        setSecrets((currentSecrets) => ({
                          ...currentSecrets,
                          [secretField.name]: event.currentTarget.value,
                        }));
                      }}
                      placeholder={
                        secretField.placeholder ?? `Enter ${secretField.label.toLowerCase()}`
                      }
                      type={secretField.inputType}
                      value={secrets[secretField.name] ?? ""}
                    />
                  )}
                </FieldContent>
              </Field>
            ))}
            <FormPageActionBar>
              <Button type="button" variant="outline">
                Back
              </Button>
              <Button type="button">Continue</Button>
            </FormPageActionBar>
          </div>
        </FormPageSection>
      </FormPageStack>
    </FormPageFrame>
  );
}

export function ProposedGitHubCloudAddFlowStory(): React.JSX.Element {
  const githubDefinition = getStoryDefinitionOrThrow("github-cloud");
  const githubMethods = resolveConnectionMethodsOrThrow(githubDefinition);
  const [connectionName, setConnectionName] = useState("Mistle GitHub");
  const [methodId, setMethodId] =
    useState<IntegrationConnectionMethodId>("github-app-installation");
  const [selectedSetupPath, setSelectedSetupPath] = useState<GitHubAppSetupPath>("create-app");
  const [path, setPath] = useState<GitHubAppSetupPath | null>(null);
  const [managedSetupStage, setManagedSetupStage] = useState<GitHubAppManagedSetupStage>("draft");
  const proposedGitHubSpec = {
    initialConnectionDisplayNameValue: connectionName,
    initialMethodId: methodId,
    targetKey: "github-cloud",
    variantId: "github-cloud",
  } satisfies StoryIntegrationSpec;

  if (path === "existing-app") {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <Button
            onClick={() => {
              setPath(null);
            }}
            type="button"
            variant="outline"
          >
            Back
          </Button>
        </div>
        <IntegrationSettingsAddFlowStory {...proposedGitHubSpec} />
      </div>
    );
  }

  if (path === "create-app") {
    return (
      <GitHubManagedSetupSummary
        onBack={() => {
          setPath(null);
          setManagedSetupStage("draft");
        }}
        onContinue={() => {
          setManagedSetupStage((currentStage) => {
            if (currentStage === "draft") {
              return "redirecting";
            }

            if (currentStage === "redirecting") {
              return "credentials-created";
            }

            if (currentStage === "credentials-created") {
              return "ready-to-install";
            }

            if (currentStage === "ready-to-install") {
              return "installed";
            }

            return currentStage;
          });
        }}
        onReset={() => {
          setPath(null);
          setManagedSetupStage("draft");
        }}
        stage={managedSetupStage}
      />
    );
  }

  return (
    <FormPageFrame title="Add GitHub Connection">
      <FormPageStack>
        <FormPageSection>
          <div className="flex flex-col gap-6 p-4">
            <Field contentWidth="fill" orientation="vertical">
              <FieldHeader>
                <FieldLabel htmlFor="storybook-github-connection-name">Name</FieldLabel>
              </FieldHeader>
              <FieldContent>
                <Input
                  id="storybook-github-connection-name"
                  onChange={(event) => {
                    setConnectionName(event.currentTarget.value);
                  }}
                  value={connectionName}
                />
              </FieldContent>
            </Field>

            <Field contentWidth="fill" orientation="vertical">
              <FieldHeader>
                <FieldLabel htmlFor="storybook-github-auth-method">
                  Authentication method
                </FieldLabel>
              </FieldHeader>
              <FieldContent>
                <Select
                  onValueChange={(nextValue) => {
                    if (nextValue === null || nextValue === undefined || nextValue.length === 0) {
                      return;
                    }

                    setMethodId(nextValue);
                    setSelectedSetupPath("create-app");
                    setPath(null);
                    setManagedSetupStage("draft");
                  }}
                  value={methodId}
                >
                  <SelectTrigger className="w-full" id="storybook-github-auth-method">
                    <SelectValue>
                      {githubMethods.find((method) => method.id === methodId)?.label}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    {githubMethods.map((method) => (
                      <SelectItem key={method.id} value={method.id}>
                        {method.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldContent>
            </Field>

            {methodId === "github-app-installation" ? (
              <>
                <Field contentWidth="fill" orientation="vertical">
                  <FieldHeader>
                    <div className="flex items-center gap-2">
                      <FieldLabel>GitHub app setup</FieldLabel>
                      <Tooltip delay={0}>
                        <TooltipTrigger
                          aria-label="About GitHub app setup"
                          className="text-muted-foreground inline-flex"
                        >
                          <InfoIcon aria-hidden className="size-3.5" />
                        </TooltipTrigger>
                        <TooltipContent
                          className="max-w-80 whitespace-pre-wrap text-left"
                          side="top"
                        >
                          Choose whether this connection should use an existing GitHub App or create
                          a new customer-owned app through Mistle&apos;s guided manifest flow.
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </FieldHeader>
                  <FieldContent>
                    <RadioGroup
                      aria-label="GitHub app setup"
                      onValueChange={(nextValue) => {
                        if (nextValue === null || nextValue === undefined) {
                          return;
                        }

                        setSelectedSetupPath(nextValue as GitHubAppSetupPath);
                      }}
                      value={selectedSetupPath}
                    >
                      <div className="flex items-start gap-3">
                        <RadioGroupItem id="storybook-github-setup-new" value="create-app" />
                        <label className="text-sm" htmlFor="storybook-github-setup-new">
                          Create a new GitHub App with a manifest
                        </label>
                      </div>
                      <div className="flex items-start gap-3">
                        <RadioGroupItem id="storybook-github-setup-existing" value="existing-app" />
                        <label className="text-sm" htmlFor="storybook-github-setup-existing">
                          Use an existing GitHub app
                        </label>
                      </div>
                    </RadioGroup>
                  </FieldContent>
                </Field>
                <FormPageActionBar>
                  <Button
                    onClick={() => {
                      setPath(selectedSetupPath);
                    }}
                    type="button"
                  >
                    Continue
                  </Button>
                </FormPageActionBar>
              </>
            ) : (
              <Notice>
                API key uses the existing single-step setup. This proposed multi-step branch only
                applies to <strong>GitHub App installation</strong>.
              </Notice>
            )}
          </div>
        </FormPageSection>
      </FormPageStack>
    </FormPageFrame>
  );
}

export function ProposedGitHubCloudExistingAppSetupStory(): React.JSX.Element {
  return <ExistingGitHubAppSetupStory />;
}

export function ProposedGitHubCloudManifestSetupStory(): React.JSX.Element {
  return (
    <GitHubManagedSetupSummary
      onBack={() => {}}
      onContinue={() => {}}
      onReset={() => {}}
      stage="draft"
    />
  );
}

export const AddFlowStorySpecs = {
  GitHubCloud: {
    variantId: "github-cloud",
  },
  GitHubEnterpriseServer: {
    variantId: "github-enterprise-server",
  },
  Jira: {
    variantId: "jira-default",
  },
  Linear: {
    variantId: "linear-default",
  },
  OpenAI: {
    variantId: "openai-default",
  },
} satisfies Record<string, StoryIntegrationSpec>;
