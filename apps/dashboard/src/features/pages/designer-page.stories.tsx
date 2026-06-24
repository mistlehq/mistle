import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { MemoryRouter } from "react-router";

import { withDashboardPageStory, withDashboardWorkspaceStory } from "../../storybook/decorators.js";
import {
  DesignerBlueprintCurrentTabHref,
  DesignerBlueprintCurrentTabId,
} from "../designer/designer-blueprint-schema.js";
import type { DesignerSession, DesignerSessionListItem } from "../designer/designer-service.js";
import { DesignerPageView } from "./designer-page-view.js";
import { DesignerCanvasWorkspace } from "./designer-session-page-view.js";

const StoryDesignerRuntimeFields: Pick<
  DesignerSession,
  "runtimeContext" | "sandboxProfileId" | "sandboxProfileVersion"
> = {
  sandboxProfileId: "designer",
  sandboxProfileVersion: 1,
  runtimeContext: {
    agentRuntimeId: "codex",
    launchCwd: "/workspace",
    primaryRepositoryRoot: null,
  },
};

const StoryDesignerSessions: readonly DesignerSession[] = [
  {
    id: "dsn_triage",
    organizationId: "org_story",
    sandboxInstanceId: "sbi_designer_triage",
    ...StoryDesignerRuntimeFields,
    title: "Design triage agent",
    status: "running",
    connectable: true,
    failureCode: null,
    failureMessage: null,
    startupOperation: null,
    initialPrompt: "Build a triage agent for incoming GitHub issues and Linear bugs.",
    canvasTabs: [
      {
        kind: "blueprint",
        id: DesignerBlueprintCurrentTabId,
        title: "Blueprint",
        href: DesignerBlueprintCurrentTabHref,
        blueprint: {
          version: 1,
          title: "Triage agent blueprint",
          outcome: {
            label: "Classify Linear and GitHub work and route the next action",
            description: "Shows the workflow from inbound work to triage outcomes.",
          },
          items: [
            {
              id: "linear-trigger",
              kind: "trigger",
              label: "Linear work trigger",
              integrationTargetKey: "linear-default",
              integrationLabel: "Linear",
              eventLabel: "Issue label or state changed",
              state: "proposed",
            },
            {
              id: "github-trigger",
              kind: "trigger",
              label: "GitHub work trigger",
              integrationTargetKey: "github-cloud",
              integrationLabel: "GitHub",
              eventLabel: "PR or issue activity",
              state: "proposed",
            },
            {
              id: "normalize-context",
              kind: "agent_step",
              label: "Normalize context",
              description: "Collect item text, metadata, requester, linked resources, and history.",
              state: "proposed",
            },
            {
              id: "routing",
              kind: "routing_policy",
              label: "Routing policy",
              state: "proposed",
              rules: [
                {
                  label: "Escalations",
                  when: [
                    {
                      field: "severity",
                      operator: "includes",
                      value: "urgent",
                    },
                  ],
                  routeTo: "escalate",
                },
              ],
            },
            {
              id: "triage-update",
              kind: "workflow_output",
              label: "Write triage update",
              state: "proposed",
            },
            {
              id: "escalate",
              kind: "workflow_output",
              label: "Escalate urgent item",
              state: "proposed",
            },
          ],
          links: [
            {
              from: "linear-trigger",
              to: "normalize-context",
              kind: "triggers",
            },
            {
              from: "github-trigger",
              to: "normalize-context",
              kind: "triggers",
            },
            {
              from: "normalize-context",
              to: "routing",
              kind: "routes_to",
            },
            {
              from: "routing",
              to: "triage-update",
              kind: "routes_to",
            },
            {
              from: "routing",
              to: "escalate",
              kind: "routes_to",
            },
          ],
          actions: [],
        },
      },
      {
        kind: "route",
        id: "integrations",
        title: "Integrations",
        href: "/integrations",
      },
      {
        kind: "route",
        id: "sandbox-profile",
        title: "Sandbox Profile",
        href: "/sandbox-profiles/sbp_story/draft",
      },
    ],
    createdAt: "2026-04-01T09:00:00.000Z",
    updatedAt: "2026-04-01T09:00:00.000Z",
  },
  {
    id: "dsn_billing_reconciliation",
    organizationId: "org_story",
    sandboxInstanceId: "sbi_designer_billing_reconciliation",
    ...StoryDesignerRuntimeFields,
    title:
      "Design a billing reconciliation agent for Linear escalations and GitHub incident follow-up",
    status: "starting",
    connectable: true,
    failureCode: null,
    failureMessage: null,
    startupOperation: {
      operationId: "owfr_story_designer_billing_startup",
      operationKind: "start",
    },
    initialPrompt: "Design a billing reconciliation agent for escalations.",
    canvasTabs: [],
    createdAt: "2026-04-01T08:55:00.000Z",
    updatedAt: "2026-04-01T08:55:00.000Z",
  },
  {
    id: "dsn_docs_sidebar",
    organizationId: "org_story",
    sandboxInstanceId: "sbi_designer_docs_sidebar",
    ...StoryDesignerRuntimeFields,
    title:
      "Compare the current sidebar truncation behavior with the sessions table so designer conversations stay compact",
    status: "stopped",
    connectable: false,
    failureCode: null,
    failureMessage: null,
    startupOperation: null,
    initialPrompt: "Compare sidebar truncation behavior.",
    canvasTabs: [],
    createdAt: "2026-03-31T15:30:00.000Z",
    updatedAt: "2026-03-31T15:30:00.000Z",
  },
  {
    id: "dsn_failed_webhook",
    organizationId: "org_story",
    sandboxInstanceId: "sbi_designer_failed_webhook",
    ...StoryDesignerRuntimeFields,
    title: null,
    status: "failed",
    connectable: false,
    failureCode: "sandbox_bootstrap_failed",
    failureMessage: "Could not start the Designer sandbox runtime because image pull failed.",
    startupOperation: null,
    initialPrompt: "Build a webhook failure triage agent.",
    canvasTabs: [],
    createdAt: "2026-03-31T12:00:00.000Z",
    updatedAt: "2026-03-31T12:00:00.000Z",
  },
];

function DesignerPageStory(input: {
  createErrorMessage?: string | null;
  initialDraft?: string;
  isCreating?: boolean;
  sessions?: readonly DesignerSessionListItem[];
  sessionsErrorMessage?: string | null;
}): React.JSX.Element {
  const [prompt, setPrompt] = useState(input.initialDraft ?? "");

  return (
    <MemoryRouter initialEntries={["/designer"]}>
      <DesignerPageView
        createErrorMessage={input.createErrorMessage ?? null}
        isCreating={input.isCreating ?? false}
        onPromptChange={setPrompt}
        onSubmit={() => {}}
        prompt={prompt}
        sessions={input.sessions ?? StoryDesignerSessions}
        sessionsErrorMessage={input.sessionsErrorMessage ?? null}
      />
    </MemoryRouter>
  );
}

function DesignerCanvasWorkspaceStory(input: {
  tabs: DesignerSession["canvasTabs"];
}): React.JSX.Element {
  const [tabs, setTabs] = useState([...input.tabs]);
  const [activeTabHref, setActiveTabHref] = useState<string | null>(tabs[0]?.href ?? null);

  return (
    <DesignerCanvasWorkspace
      activeTabHref={activeTabHref}
      onActiveTabHrefChange={setActiveTabHref}
      onTabClose={(tabId) => {
        setTabs((currentTabs) => currentTabs.filter((tab) => tab.id !== tabId));
      }}
      onTabsChange={(nextTabs) => {
        setTabs([...nextTabs]);
      }}
      tabs={tabs}
    />
  );
}

const meta = {
  title: "Dashboard/Designer/Page",
  component: DesignerPageView,
  args: {
    createErrorMessage: null,
    isCreating: false,
    onPromptChange: () => {},
    onSubmit: () => {},
    prompt: "Build a triaging agent for Linear and GitHub.",
    sessions: StoryDesignerSessions,
    sessionsErrorMessage: null,
  },
  parameters: {
    layout: "fullscreen",
  },
  decorators: [withDashboardPageStory],
  render: function RenderStory(): React.JSX.Element {
    return <DesignerPageStory initialDraft="Build a triaging agent for Linear and GitHub." />;
  },
} satisfies Meta<typeof DesignerPageView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const WithSessions: Story = {};

export const Empty: Story = {
  render: function RenderEmptyStory(): React.JSX.Element {
    return <DesignerPageStory sessions={[]} />;
  },
};

export const CreateError: Story = {
  render: function RenderCreateErrorStory(): React.JSX.Element {
    return (
      <DesignerPageStory
        createErrorMessage="Designer sessions require the Docker sandbox runtime in this first implementation."
        initialDraft="Build an incident response agent."
      />
    );
  },
};

export const Canvas: Story = {
  decorators: [withDashboardWorkspaceStory],
  render: function RenderCanvasStory(): React.JSX.Element {
    return <DesignerCanvasWorkspaceStory tabs={StoryDesignerSessions[0]?.canvasTabs ?? []} />;
  },
};

export const EmptyCanvas: Story = {
  decorators: [withDashboardWorkspaceStory],
  render: function RenderEmptyCanvasStory(): React.JSX.Element {
    return <DesignerCanvasWorkspaceStory tabs={[]} />;
  },
};
