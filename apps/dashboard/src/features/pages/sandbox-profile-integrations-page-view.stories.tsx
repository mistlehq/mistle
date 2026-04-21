import {
  Button,
  DetailLabel,
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
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import type React from "react";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import { SchemaFormSelectContentClassName } from "../forms/schema-form.js";
import { AutoSaveTitleHeading } from "../shared/auto-save-inline-heading.js";
import { isRecord } from "../shared/is-record.js";
import { PageFrame } from "../shared/page-frame.js";
import { IntegrationConnectionSelect } from "./integration-connection-select.js";
import {
  StoryAwsConnection,
  createIntegrationsEditorSectionStoryQueryClient,
  seedStoryIntegrationResources,
  StoryGithubConnection,
  StoryGithubResources,
  StoryIntegrationConnections,
  StoryIntegrationTargets,
  StoryJiraConnection,
  StoryLinearConnection,
  StoryOpenAiConnection,
  StoryPlanetScaleConnection,
  StoryPlanetScaleTools,
} from "./integrations-editor-section-story-support.js";
import { IntegrationsEditorSection } from "./integrations-editor-section.js";
import {
  createDefaultBindingConfig,
  resolveBindingConfigUiModel,
  SandboxProfileBindingConfigEditor,
  type IntegrationConnectionSummary,
  type IntegrationTargetSummary,
  type SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";

const InitialRows: readonly SandboxProfileBindingEditorRow[] = [
  {
    clientId: "row-openai-agent",
    connectionId: StoryOpenAiConnection.id,
    kind: "agent",
    config: {
      model: {
        defaultModel: "gpt-5.3-codex",
        options: {
          reasoningEffort: "medium",
          additionalInstructions: "Stay concise and ask before destructive changes.",
        },
      },
      runtime: {
        runtimeId: "codex",
        config: {},
      },
    },
  },
  {
    clientId: "row-github-git",
    connectionId: StoryGithubConnection.id,
    kind: "git",
    config: {
      repositories: [
        "mistle/main-dashboard",
        "mistle/control-plane-api",
        "mistle/sandbox-runtime",
        "mistle/codex-bridge",
        "mistle/session-workbench",
        "mistle/integration-runtime",
      ],
      tools: ["github-cli"],
    },
  },
  {
    clientId: "row-aws-connector",
    connectionId: StoryAwsConnection.id,
    kind: "connector",
    config: {
      services: ["s3", "sts", "secretsmanager"],
      regions: ["us-east-1", "us-west-2"],
      defaultRegion: "us-east-1",
      tools: ["aws-cli"],
    },
  },
  {
    clientId: "row-jira-connector",
    connectionId: StoryJiraConnection.id,
    kind: "connector",
    config: {
      tools: ["jira-cli"],
    },
  },
  {
    clientId: "row-planetscale-connector",
    connectionId: StoryPlanetScaleConnection.id,
    kind: "connector",
    config: {
      tools: [...StoryPlanetScaleTools],
    },
  },
  {
    clientId: "row-linear-connector",
    connectionId: StoryLinearConnection.id,
    kind: "connector",
    config: {
      tools: ["linear-mcp"],
    },
  },
] as const;

const InitialAgentRow = InitialRows[0];

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function resolveNestedSchemaValue(input: { value: unknown; path: readonly string[] }): unknown {
  let current = input.value;

  for (const segment of input.path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }

  return current;
}

function resolveChoiceOptions(input: {
  schema: Record<string, unknown>;
  schemaPath: readonly string[];
}): readonly { label: string; value: string }[] {
  const propertySchema = readRecord(
    resolveNestedSchemaValue({
      path: input.schemaPath,
      value: input.schema,
    }),
  );
  const oneOf = propertySchema["oneOf"];
  if (Array.isArray(oneOf)) {
    const options: { label: string; value: string }[] = [];

    for (const option of oneOf) {
      const optionRecord = readRecord(option);
      const value = optionRecord["const"];
      const label = optionRecord["title"];

      if (typeof value === "string" && typeof label === "string") {
        options.push({ label, value });
      }
    }

    if (options.length > 0) {
      return options;
    }
  }

  const enumValues = propertySchema["enum"];
  if (!Array.isArray(enumValues)) {
    return [];
  }

  return enumValues.flatMap((value) =>
    typeof value === "string"
      ? [
          {
            label: value,
            value,
          },
        ]
      : [],
  );
}

function ComparisonCard(input: {
  title: string;
  description: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="rounded-2xl border bg-background p-8">
      <div className="flex flex-col gap-2">
        <h2 className="text-foreground text-2xl font-semibold">{input.title}</h2>
        <p className="text-muted-foreground text-lg">{input.description}</p>
      </div>
      <div className="pt-8">{input.children}</div>
    </section>
  );
}

function ComparisonActions(input: {
  isDirty: boolean;
  onCancel: () => void;
  onSave: () => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-end gap-2">
      <Button disabled={!input.isDirty} onClick={input.onCancel} type="button" variant="outline">
        Cancel
      </Button>
      <Button disabled={!input.isDirty} onClick={input.onSave} type="button">
        Save
      </Button>
    </div>
  );
}

function CurrentAgentHarnessEditorPreview(input: {
  row: SandboxProfileBindingEditorRow;
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
}): React.JSX.Element {
  const [draftRow, setDraftRow] = useState(input.row);
  const isDirty = JSON.stringify(draftRow) !== JSON.stringify(input.row);
  const availableAgentConnections = input.availableConnections.filter(
    (connection) => connection.targetKey === StoryOpenAiConnection.targetKey,
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <DetailLabel as="p">Connection</DetailLabel>
        <IntegrationConnectionSelect
          ariaLabel="Connection"
          availableConnections={availableAgentConnections}
          availableTargets={input.availableTargets}
          onValueChange={(nextValue) => {
            const nextConnection = availableAgentConnections.find(
              (connection) => connection.id === nextValue,
            );
            const nextTarget = input.availableTargets.find(
              (candidate) => candidate.targetKey === nextConnection?.targetKey,
            );

            setDraftRow((currentRow) => ({
              ...currentRow,
              connectionId: nextValue,
              config:
                nextConnection === undefined || nextTarget === undefined
                  ? {}
                  : createDefaultBindingConfig({
                      connection: nextConnection,
                      target: nextTarget,
                    }),
            }));
          }}
          placeholder="Select integration connection"
          selectedConnectionId={draftRow.connectionId}
        />
      </div>

      <SandboxProfileBindingConfigEditor
        availableConnections={input.availableConnections}
        availableTargets={input.availableTargets}
        formContext={{
          columns: 2,
          labelTone: "detail",
          layout: "vertical",
        }}
        onIntegrationBindingRowChange={(clientId, changes) => {
          setDraftRow((currentRow) =>
            clientId === currentRow.clientId ? { ...currentRow, ...changes } : currentRow,
          );
        }}
        row={draftRow}
      />

      <ComparisonActions
        isDirty={isDirty}
        onCancel={() => {
          setDraftRow(input.row);
        }}
        onSave={() => {
          setDraftRow(draftRow);
        }}
      />
    </div>
  );
}

function PreviousAgentHarnessEditorPreview(input: {
  row: SandboxProfileBindingEditorRow;
  availableConnections: readonly IntegrationConnectionSummary[];
  availableTargets: readonly IntegrationTargetSummary[];
}): React.JSX.Element {
  const [draftRow, setDraftRow] = useState(input.row);
  const isDirty = JSON.stringify(draftRow) !== JSON.stringify(input.row);
  const availableAgentConnections = input.availableConnections.filter(
    (connection) => connection.targetKey === StoryOpenAiConnection.targetKey,
  );
  const configUiModel = resolveBindingConfigUiModel({
    connections: input.availableConnections,
    row: draftRow,
    targets: input.availableTargets,
  });
  const schemaRecord = configUiModel.mode === "form" ? readRecord(configUiModel.schema) : null;
  const defaultModelOptions =
    schemaRecord === null
      ? []
      : resolveChoiceOptions({
          schema: schemaRecord,
          schemaPath: ["properties", "model", "properties", "defaultModel"],
        });
  const reasoningEffortOptions =
    schemaRecord === null
      ? []
      : resolveChoiceOptions({
          schema: schemaRecord,
          schemaPath: [
            "properties",
            "model",
            "properties",
            "options",
            "properties",
            "reasoningEffort",
          ],
        });
  const currentDefaultModel = readString(
    resolveNestedSchemaValue({
      path: ["model", "defaultModel"],
      value: draftRow.config,
    }),
  );
  const currentReasoningEffort = readString(
    resolveNestedSchemaValue({
      path: ["model", "options", "reasoningEffort"],
      value: draftRow.config,
    }),
  );
  const currentAdditionalInstructions = readString(
    resolveNestedSchemaValue({
      path: ["model", "options", "additionalInstructions"],
      value: draftRow.config,
    }),
  );

  return (
    <div className="flex flex-col gap-4 py-2">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <DetailLabel as="p">Connection</DetailLabel>
          <IntegrationConnectionSelect
            ariaLabel="Connection"
            availableConnections={availableAgentConnections}
            availableTargets={input.availableTargets}
            onValueChange={(nextValue) => {
              const nextConnection = availableAgentConnections.find(
                (connection) => connection.id === nextValue,
              );
              const nextTarget = input.availableTargets.find(
                (candidate) => candidate.targetKey === nextConnection?.targetKey,
              );

              setDraftRow((currentRow) => ({
                ...currentRow,
                connectionId: nextValue,
                config:
                  nextConnection === undefined || nextTarget === undefined
                    ? {}
                    : createDefaultBindingConfig({
                        connection: nextConnection,
                        target: nextTarget,
                      }),
              }));
            }}
            placeholder="Select integration connection"
            selectedConnectionId={draftRow.connectionId}
          />
        </div>

        <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
          <div className="min-w-0 flex flex-col gap-1.5">
            <DetailLabel as="p">Default model</DetailLabel>
            <Select
              onValueChange={(nextValue) => {
                setDraftRow((currentRow) => ({
                  ...currentRow,
                  config: {
                    ...currentRow.config,
                    model: {
                      ...readRecord(currentRow.config["model"]),
                      defaultModel: nextValue,
                    },
                  },
                }));
              }}
              value={currentDefaultModel}
            >
              <SelectTrigger aria-label="Default model" className="w-full">
                <SelectValue placeholder="Select model">{currentDefaultModel}</SelectValue>
              </SelectTrigger>
              <SelectContent className={SchemaFormSelectContentClassName}>
                {defaultModelOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-0 flex flex-col gap-1.5">
            <DetailLabel as="p">Reasoning effort</DetailLabel>
            <Select
              onValueChange={(nextValue) => {
                setDraftRow((currentRow) => ({
                  ...currentRow,
                  config: {
                    ...currentRow.config,
                    model: {
                      ...readRecord(currentRow.config["model"]),
                      options: {
                        ...readRecord(readRecord(currentRow.config["model"])["options"]),
                        reasoningEffort: nextValue,
                      },
                    },
                  },
                }));
              }}
              value={currentReasoningEffort}
            >
              <SelectTrigger aria-label="Reasoning effort" className="w-full">
                <SelectValue placeholder="Select reasoning effort">
                  {currentReasoningEffort}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className={SchemaFormSelectContentClassName}>
                {reasoningEffortOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="min-w-0 flex flex-col gap-1.5">
          <div className="flex items-center gap-1">
            <DetailLabel as="p">Agent Instructions</DetailLabel>
            <Tooltip delay={0}>
              <TooltipTrigger
                aria-label="Explain agent instructions"
                render={
                  <button
                    className="text-muted-foreground hover:text-foreground inline-flex size-4 shrink-0 items-center justify-center rounded-sm"
                    type="button"
                  />
                }
              >
                <InfoIcon aria-hidden className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent className="max-w-64 text-left" side="top">
                Appended to the developer message.
              </TooltipContent>
            </Tooltip>
          </div>
          <Textarea
            aria-label="Agent Instructions"
            className="min-h-28 w-full text-sm"
            onChange={(event) => {
              const nextInstructions = event.currentTarget.value;

              setDraftRow((currentRow) => ({
                ...currentRow,
                config: {
                  ...currentRow.config,
                  model: {
                    ...readRecord(currentRow.config["model"]),
                    options: {
                      ...readRecord(readRecord(currentRow.config["model"])["options"]),
                      additionalInstructions: nextInstructions,
                    },
                  },
                },
              }));
            }}
            rows={8}
            value={currentAdditionalInstructions ?? ""}
          />
        </div>

        <ComparisonActions
          isDirty={isDirty}
          onCancel={() => {
            setDraftRow(input.row);
          }}
          onSave={() => {
            setDraftRow(draftRow);
          }}
        />
      </div>
    </div>
  );
}

function AgentHarnessLayoutComparisonStory(): React.JSX.Element {
  const [queryClient] = useState(() => createIntegrationsEditorSectionStoryQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <PageFrame maxWidthClassName="max-w-7xl" title="">
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-2">
            <h1 className="text-foreground text-4xl font-semibold">
              Agent Harness Layout Comparison
            </h1>
            <p className="text-muted-foreground text-xl">
              Current schema-driven config rendering on the left, previous promoted-field layout on
              the right.
            </p>
          </div>

          <div className="grid gap-8 xl:grid-cols-2">
            <ComparisonCard
              description="Production path using `SandboxProfileBindingConfigEditor`."
              title="Current Config-Driven Layout"
            >
              <CurrentAgentHarnessEditorPreview
                availableConnections={StoryIntegrationConnections}
                availableTargets={StoryIntegrationTargets}
                row={InitialAgentRow}
              />
            </ComparisonCard>

            <ComparisonCard
              description="Story-only recreation of the prior promoted-field layout."
              title="Previous Agent Editor Layout"
            >
              <PreviousAgentHarnessEditorPreview
                availableConnections={StoryIntegrationConnections}
                availableTargets={StoryIntegrationTargets}
                row={InitialAgentRow}
              />
            </ComparisonCard>
          </div>
        </div>
      </PageFrame>
    </QueryClientProvider>
  );
}

function SandboxProfileIntegrationsPageViewStory(): React.JSX.Element {
  const [queryClient] = useState(() => {
    const client = createIntegrationsEditorSectionStoryQueryClient();
    seedStoryIntegrationResources({
      queryClient: client,
      resources: StoryGithubResources,
    });
    return client;
  });
  const [profileName, setProfileName] = useState("Customer Support Sandbox");
  const [rows, setRows] = useState<readonly SandboxProfileBindingEditorRow[]>(InitialRows);

  return (
    <QueryClientProvider client={queryClient}>
      <PageFrame maxWidthClassName="max-w-5xl" title="">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <AutoSaveTitleHeading
              ariaLabel="Profile name"
              emptyDisplayText="Untitled profile"
              onSave={async (nextValue) => {
                setProfileName(nextValue);
              }}
              requiredLabel="Profile name"
              value={profileName}
            />
          </div>

          <IntegrationsEditorSection
            availableConnections={StoryIntegrationConnections}
            availableTargets={StoryIntegrationTargets}
            integrationBindingsQuery={{
              isError: false,
              error: null,
              isPending: false,
            }}
            integrationDirectoryQuery={{
              isError: false,
              error: null,
              isPending: false,
            }}
            integrationRowErrorsByClientId={{}}
            integrationRows={rows}
            integrationSaveError={null}
            isSubmittingIntegrationBindings={false}
            onAddIntegrationBindingRow={async (input) => {
              setRows((currentRows) => [
                ...currentRows,
                {
                  clientId: `row-${String(currentRows.length + 1)}`,
                  connectionId: input.connectionId,
                  kind: input.kind,
                  config: input.config,
                },
              ]);
              return true;
            }}
            onIntegrationBindingRowChange={(clientId, changes) => {
              setRows((currentRows) =>
                currentRows.map((row) =>
                  row.clientId === clientId ? { ...row, ...changes } : row,
                ),
              );
            }}
            onRemoveIntegrationBindingRow={(clientId) => {
              setRows((currentRows) => currentRows.filter((row) => row.clientId !== clientId));
            }}
          />
        </div>
      </PageFrame>
    </QueryClientProvider>
  );
}

const meta = {
  title: "Dashboard/SandboxProfiles/Integrations/PageView",
  component: SandboxProfileIntegrationsPageViewStory,
  decorators: [withDashboardPageStory],
} satisfies Meta<typeof SandboxProfileIntegrationsPageViewStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const AgentHarnessLayoutComparison: Story = {
  render: () => <AgentHarnessLayoutComparisonStory />,
};
