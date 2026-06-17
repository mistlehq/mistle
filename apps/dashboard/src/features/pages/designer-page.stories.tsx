import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { MemoryRouter } from "react-router";

import { withDashboardPageStory, withDashboardWorkspaceStory } from "../../storybook/decorators.js";
import type { DesignerSession } from "../designer/designer-service.js";
import { DesignerPageView } from "./designer-page-view.js";
import { DesignerSessionPageView } from "./designer-session-page-view.js";

const StoryDesignerSessions: readonly DesignerSession[] = [
  {
    id: "dsn_triage",
    organizationId: "org_story",
    sandboxInstanceId: "sbi_designer_triage",
    initialPrompt: "Build a triaging agent for Linear and GitHub.",
    title: "Design triage agent",
    status: "running",
    connectable: true,
    failureCode: null,
    failureMessage: null,
    canvasTabs: [
      {
        id: "integrations",
        title: "Integrations",
        href: "/integrations",
      },
      {
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
    initialPrompt:
      "Design a billing reconciliation agent for Linear escalations and GitHub incident follow-up.",
    title:
      "Design a billing reconciliation agent for Linear escalations and GitHub incident follow-up",
    status: "starting",
    connectable: true,
    failureCode: null,
    failureMessage: null,
    canvasTabs: [],
    createdAt: "2026-04-01T08:55:00.000Z",
    updatedAt: "2026-04-01T08:55:00.000Z",
  },
  {
    id: "dsn_docs_sidebar",
    organizationId: "org_story",
    sandboxInstanceId: "sbi_designer_docs_sidebar",
    initialPrompt:
      "Compare the current sidebar truncation behavior with the sessions table in Designer.",
    title:
      "Compare the current sidebar truncation behavior with the sessions table so designer conversations stay compact",
    status: "stopped",
    connectable: false,
    failureCode: null,
    failureMessage: null,
    canvasTabs: [],
    createdAt: "2026-03-31T15:30:00.000Z",
    updatedAt: "2026-03-31T15:30:00.000Z",
  },
  {
    id: "dsn_failed_webhook",
    organizationId: "org_story",
    sandboxInstanceId: "sbi_designer_failed_webhook",
    initialPrompt: "Build a webhook debugger agent.",
    title: null,
    status: "failed",
    connectable: false,
    failureCode: "sandbox_bootstrap_failed",
    failureMessage: "Could not start the Designer sandbox runtime because image pull failed.",
    canvasTabs: [],
    createdAt: "2026-03-31T12:00:00.000Z",
    updatedAt: "2026-03-31T12:00:00.000Z",
  },
];

function DesignerPageStory(input: {
  createErrorMessage?: string | null;
  initialPrompt?: string;
  isCreating?: boolean;
  sessions?: readonly DesignerSession[];
  sessionsErrorMessage?: string | null;
}): React.JSX.Element {
  const [prompt, setPrompt] = useState(input.initialPrompt ?? "");

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
    return <DesignerPageStory initialPrompt="Build a triaging agent for Linear and GitHub." />;
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
        initialPrompt="Build an incident response agent."
      />
    );
  },
};

export const Workspace: Story = {
  decorators: [withDashboardWorkspaceStory],
  render: function RenderWorkspaceStory(): React.JSX.Element {
    return (
      <MemoryRouter initialEntries={["/designer/dsn_triage_agent_story"]}>
        <DesignerSessionPageView
          bootstrapErrorMessage={null}
          bootstrapIsPending={false}
          errorMessage={null}
          followUpDraft=""
          followUpErrorMessage={null}
          followUpIsPending={false}
          followUpSuccessMessage={null}
          onFollowUpDraftChange={() => {}}
          onFollowUpSubmit={() => {}}
          runtimeConversationBootstrap={{
            providerConversationId: "thread_designer_triage",
            providerExecutionId: "turn_designer_triage_initial_prompt",
            initialPromptSubmittedAt: "2026-04-01T09:01:00.000Z",
          }}
          session={StoryDesignerSessions[0] ?? null}
          sessionId="dsn_triage"
        />
      </MemoryRouter>
    );
  },
};
