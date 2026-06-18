import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { MemoryRouter } from "react-router";

import { withDashboardPageStory, withDashboardWorkspaceStory } from "../../storybook/decorators.js";
import type {
  DesignerRuntimeConversationTranscript,
  DesignerSession,
} from "../designer/designer-service.js";
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
    startupOperation: null,
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
    startupOperation: {
      operationId: "owfr_story_designer_billing_startup",
      operationKind: "start",
    },
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
    startupOperation: null,
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
    startupOperation: null,
    canvasTabs: [],
    createdAt: "2026-03-31T12:00:00.000Z",
    updatedAt: "2026-03-31T12:00:00.000Z",
  },
];

const StoryRuntimeConversationTranscript = {
  providerConversationId: "thread_designer_triage",
  name: "Design triage agent",
  preview:
    "I can help design a triage workflow that connects Linear intake with GitHub repository context.",
  turns: [
    {
      id: "turn_designer_triage_initial_prompt",
      status: "completed",
      items: [
        {
          id: "item_designer_triage_user_prompt",
          type: "userMessage",
          content: [
            {
              type: "text",
              text: "Build a triaging agent for Linear and GitHub.",
            },
          ],
        },
        {
          id: "item_designer_triage_assistant_response",
          type: "agentMessage",
          text: "I can help design that. I will start by checking which Linear and GitHub integrations are available, then we can choose the target project, repository, and triage labels.",
          status: "completed",
        },
      ],
    },
  ],
  actionProposals: [],
  userInputRequests: [],
} satisfies DesignerRuntimeConversationTranscript;

const StoryDesignerSpecificSession = {
  id: "dsn_designer_specific_ui",
  organizationId: "org_story",
  sandboxInstanceId: "sbi_designer_specific_ui",
  initialPrompt:
    "Prepare a workspace that can publish the draft profile and launch a test sandbox session.",
  title: null,
  status: "running",
  connectable: true,
  failureCode: null,
  failureMessage: null,
  startupOperation: null,
  canvasTabs: [
    {
      id: "draft-profile",
      title: "Draft Profile",
      href: "/sandbox-profiles/sbp_designer_specific/draft",
    },
    {
      id: "provider-config",
      title: "Provider Config",
      href: "/integrations/github",
    },
  ],
  createdAt: "2026-04-01T09:10:00.000Z",
  updatedAt: "2026-04-01T09:12:00.000Z",
} satisfies DesignerSession;

const StoryDesignerSpecificRuntimeConversationTranscript = {
  providerConversationId: "thread_designer_specific_ui",
  name: "Designer-specific workspace UI",
  preview: "I found a few Designer actions that need review before I can update the workspace.",
  turns: [
    {
      id: "turn_designer_specific_initial_prompt",
      status: "completed",
      items: [
        {
          id: "item_designer_specific_user_prompt",
          type: "userMessage",
          content: [
            {
              type: "text",
              text: "Prepare a workspace that can publish the draft profile and launch a test sandbox session.",
            },
          ],
        },
        {
          id: "item_designer_specific_assistant_response",
          type: "agentMessage",
          text: "I prepared the draft setup plan. Review the pending setup script change before I publish the draft profile or launch a sandbox session.",
          status: "completed",
        },
      ],
    },
  ],
  actionProposals: [
    {
      id: "dap_story_setup_script",
      kind: "designerActionProposal",
      title: "Update setup script",
      summary: "Install the GitHub and Linear CLIs before the agent runtime starts.",
      status: "pending",
      actionRequest: null,
      operation: {
        kind: "sandboxProfileDraftSetupScriptPut",
        profileId: "sbp_designer_specific",
        version: 7,
        setupScript: "pnpm install\npnpm run build",
      },
    },
    {
      id: "dap_story_launch",
      kind: "designerActionProposal",
      title: "Launch sandbox session",
      summary: "Start an ordinary sandbox session from the published profile version.",
      status: "completed",
      actionRequest: {
        id: "dar_story_launch",
        status: "completed",
        failureCode: null,
        failureMessage: null,
        operationResult: {
          kind: "sandboxProfileVersionLaunch",
          profileId: "sbp_designer_specific",
          version: 7,
          sandboxInstanceId: "sbi_story_launch",
          workflowRunId: "workflow_story_launch",
        },
      },
      operation: {
        kind: "sandboxProfileVersionLaunch",
        profileId: "sbp_designer_specific",
        version: 7,
        primaryRepositoryId: null,
        idempotencyKey: "story-launch-001",
      },
    },
    {
      id: "dap_story_provider",
      kind: "designerActionProposal",
      title: "Create GitHub webhook",
      summary: "Create a webhook on the selected repository for pull request events.",
      status: "failed",
      actionRequest: {
        id: "dar_story_provider",
        status: "failed",
        failureCode: "DESIGNER_OPERATION_FAILED",
        failureMessage: "GitHub rejected the webhook configuration.",
        operationResult: null,
      },
      operation: {
        kind: "providerConfigurationChange",
        provider: "GitHub",
        resourceType: "repository webhook",
        resourceLabel: "mistle/agent-runtime",
        action: "create webhook",
        details: [
          {
            label: "Events",
            value: "pull_request, pull_request_review",
          },
        ],
      },
    },
  ],
  userInputRequests: [],
} satisfies DesignerRuntimeConversationTranscript;

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
          actionProposalResponseErrorMessage={null}
          actionProposalResponsePendingId={null}
          actionProposalResponseSuccessMessage={null}
          bootstrapErrorMessage={null}
          bootstrapIsPending={false}
          errorMessage={null}
          followUpDraft=""
          followUpErrorMessage={null}
          followUpIsPending={false}
          followUpSuccessMessage={null}
          onActionProposalResponseSubmit={() => {}}
          onFollowUpDraftChange={() => {}}
          onFollowUpSubmit={() => {}}
          onTitleSave={() => {}}
          onUserInputRequestResponseSubmit={() => {}}
          runtimeConversationBootstrap={{
            providerConversationId: "thread_designer_triage",
            providerExecutionId: "turn_designer_triage_initial_prompt",
            initialPromptSubmittedAt: "2026-04-01T09:01:00.000Z",
          }}
          runtimeConversationTranscript={StoryRuntimeConversationTranscript}
          session={StoryDesignerSessions[0] ?? null}
          sessionId="dsn_triage"
          transcriptErrorMessage={null}
          transcriptIsPending={false}
          userInputRequestResponseErrorMessage={null}
          userInputRequestResponseIsPending={false}
          userInputRequestResponsePendingId={null}
        />
      </MemoryRouter>
    );
  },
};

export const WorkspaceDesignerSpecificUi: Story = {
  decorators: [withDashboardWorkspaceStory],
  name: "Workspace Designer-specific UI",
  render: function RenderWorkspaceDesignerSpecificUiStory(): React.JSX.Element {
    return (
      <MemoryRouter initialEntries={["/designer/dsn_designer_specific_ui"]}>
        <DesignerSessionPageView
          actionProposalResponseErrorMessage={null}
          actionProposalResponsePendingId={null}
          actionProposalResponseSuccessMessage="Designer saved the launch action request."
          bootstrapErrorMessage={null}
          bootstrapIsPending={false}
          errorMessage={null}
          followUpDraft=""
          followUpErrorMessage={null}
          followUpIsPending={false}
          followUpSuccessMessage={null}
          onActionProposalResponseSubmit={() => {}}
          onFollowUpDraftChange={() => {}}
          onFollowUpSubmit={() => {}}
          onTitleSave={() => {}}
          onUserInputRequestResponseSubmit={() => {}}
          runtimeConversationBootstrap={{
            providerConversationId: "thread_designer_specific_ui",
            providerExecutionId: "turn_designer_specific_initial_prompt",
            initialPromptSubmittedAt: "2026-04-01T09:11:00.000Z",
          }}
          runtimeConversationTranscript={StoryDesignerSpecificRuntimeConversationTranscript}
          session={StoryDesignerSpecificSession}
          sessionId="dsn_designer_specific_ui"
          transcriptErrorMessage={null}
          transcriptIsPending={false}
          userInputRequestResponseErrorMessage={null}
          userInputRequestResponseIsPending={false}
          userInputRequestResponsePendingId={null}
        />
      </MemoryRouter>
    );
  },
};
