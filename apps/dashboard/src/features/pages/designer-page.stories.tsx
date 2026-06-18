import { SidebarProvider } from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { MemoryRouter } from "react-router";

import { withDashboardPageStory, withDashboardWorkspaceStory } from "../../storybook/decorators.js";
import type {
  DesignerActionProposal,
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

function DesignerWorkspaceStoryFrame(input: {
  children: React.ReactNode;
  initialEntries: readonly string[];
}): React.JSX.Element {
  return (
    <SidebarProvider>
      <MemoryRouter initialEntries={[...input.initialEntries]}>{input.children}</MemoryRouter>
    </SidebarProvider>
  );
}

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

const StoryDesignerEmptyCanvasSession = {
  ...StoryDesignerSpecificSession,
  id: "dsn_designer_empty_canvas",
  sandboxInstanceId: "sbi_designer_empty_canvas",
  canvasTabs: [],
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

const StoryProviderConfigurationChangeProposal = {
  id: "dap_story_provider_configuration_change",
  kind: "designerActionProposal",
  title: "Create GitHub webhook",
  summary: "Create a webhook on the selected repository for pull request events.",
  status: "pending",
  actionRequest: null,
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
      {
        label: "Target",
        value: "https://app.mistle.dev/api/github/webhooks",
      },
    ],
  },
} satisfies DesignerActionProposal;

const StorySetupScriptProposal = {
  id: "dap_story_setup_script_update",
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
} satisfies DesignerActionProposal;

const StoryClearSetupScriptProposal = {
  id: "dap_story_setup_script_clear",
  kind: "designerActionProposal",
  title: "Clear setup script",
  summary: "Remove the draft setup script so the profile uses only the base image.",
  status: "pending",
  actionRequest: null,
  operation: {
    kind: "sandboxProfileDraftSetupScriptPut",
    profileId: "sbp_designer_specific",
    version: 7,
    setupScript: null,
  },
} satisfies DesignerActionProposal;

const StoryDraftPublishProposal = {
  id: "dap_story_draft_publish",
  kind: "designerActionProposal",
  title: "Publish draft profile",
  summary: "Publish the saved draft profile configuration as version 7.",
  status: "pending",
  actionRequest: null,
  operation: {
    kind: "sandboxProfileDraftPublish",
    profileId: "sbp_designer_specific",
    version: 7,
  },
} satisfies DesignerActionProposal;

const StoryLaunchProposal = {
  id: "dap_story_launch_without_repository",
  kind: "designerActionProposal",
  title: "Launch sandbox session",
  summary: "Start an ordinary sandbox session from the published profile version.",
  status: "pending",
  actionRequest: null,
  operation: {
    kind: "sandboxProfileVersionLaunch",
    profileId: "sbp_designer_specific",
    version: 7,
    primaryRepositoryId: null,
    idempotencyKey: "story-launch-001",
  },
} satisfies DesignerActionProposal;

const StoryLaunchWithRepositoryProposal = {
  id: "dap_story_launch_with_repository",
  kind: "designerActionProposal",
  title: "Launch sandbox session with repository",
  summary: "Start a sandbox session from the profile version with a primary repository selected.",
  status: "pending",
  actionRequest: null,
  operation: {
    kind: "sandboxProfileVersionLaunch",
    profileId: "sbp_designer_specific",
    version: 7,
    primaryRepositoryId: "repo_mistle_app",
    idempotencyKey: "story-launch-002",
  },
} satisfies DesignerActionProposal;

function withDesignerActionProposalState(input: {
  actionRequest: DesignerActionProposal["actionRequest"];
  id: string;
  proposal: DesignerActionProposal;
  status: DesignerActionProposal["status"];
  title?: string;
}): DesignerActionProposal {
  return {
    ...input.proposal,
    id: input.id,
    title: input.title ?? input.proposal.title,
    status: input.status,
    actionRequest: input.actionRequest,
  };
}

const StoryActionProposalStatusExamples = {
  pending: StoryProviderConfigurationChangeProposal,
  approved: withDesignerActionProposalState({
    id: "dap_story_status_approved",
    proposal: StoryProviderConfigurationChangeProposal,
    status: "approved",
    title: "Approved GitHub webhook",
    actionRequest: {
      id: "dar_story_status_approved",
      status: "approved",
      failureCode: null,
      failureMessage: null,
      operationResult: null,
    },
  }),
  declined: withDesignerActionProposalState({
    id: "dap_story_status_declined",
    proposal: StoryProviderConfigurationChangeProposal,
    status: "declined",
    title: "Declined GitHub webhook",
    actionRequest: {
      id: "dar_story_status_declined",
      status: "declined",
      failureCode: null,
      failureMessage: null,
      operationResult: null,
    },
  }),
  executing: withDesignerActionProposalState({
    id: "dap_story_status_executing",
    proposal: StoryDraftPublishProposal,
    status: "executing",
    title: "Publishing draft profile",
    actionRequest: {
      id: "dar_story_status_executing",
      status: "executing",
      failureCode: null,
      failureMessage: null,
      operationResult: null,
    },
  }),
  executionUnsupported: withDesignerActionProposalState({
    id: "dap_story_status_execution_unsupported",
    proposal: StoryProviderConfigurationChangeProposal,
    status: "execution_unsupported",
    title: "Unsupported provider change",
    actionRequest: {
      id: "dar_story_status_execution_unsupported",
      status: "execution_unsupported",
      failureCode: null,
      failureMessage: null,
      operationResult: null,
    },
  }),
  completed: withDesignerActionProposalState({
    id: "dap_story_status_completed",
    proposal: StoryLaunchProposal,
    status: "completed",
    title: "Completed sandbox launch",
    actionRequest: {
      id: "dar_story_status_completed",
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
  }),
  failed: withDesignerActionProposalState({
    id: "dap_story_status_failed",
    proposal: StoryProviderConfigurationChangeProposal,
    status: "failed",
    title: "Failed GitHub webhook",
    actionRequest: {
      id: "dar_story_status_failed",
      status: "failed",
      failureCode: "DESIGNER_OPERATION_FAILED",
      failureMessage: "GitHub rejected the webhook configuration.",
      operationResult: null,
    },
  }),
} satisfies Record<string, DesignerActionProposal>;

function createDesignerActionProposalTranscript(input: {
  proposal: DesignerActionProposal;
}): DesignerRuntimeConversationTranscript {
  return {
    ...StoryRuntimeConversationTranscript,
    providerConversationId: `thread_${input.proposal.id}`,
    name: input.proposal.title,
    preview: input.proposal.summary,
    actionProposals: [input.proposal],
  };
}

function DesignerActionProposalStory(input: {
  errorMessage?: string | null;
  pendingProposalId?: string | null;
  proposal: DesignerActionProposal;
  submittedProposalId?: string | null;
}): React.JSX.Element {
  return (
    <DesignerWorkspaceStoryFrame initialEntries={[`/designer/${StoryDesignerSpecificSession.id}`]}>
      <DesignerSessionPageView
        chatState={null}
        actionProposalResponseErrorMessage={input.errorMessage ?? null}
        actionProposalResponsePendingId={input.pendingProposalId ?? null}
        submittedActionProposalResponseId={input.submittedProposalId ?? null}
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
          providerConversationId: `thread_${input.proposal.id}`,
          providerExecutionId: "turn_designer_action_proposal_story",
          initialPromptSubmittedAt: "2026-04-01T09:11:00.000Z",
        }}
        runtimeConversationTranscript={createDesignerActionProposalTranscript({
          proposal: input.proposal,
        })}
        session={StoryDesignerSpecificSession}
        sessionId={StoryDesignerSpecificSession.id}
        transcriptErrorMessage={null}
        transcriptIsPending={false}
        userInputRequestResponseErrorMessage={null}
        userInputRequestResponseIsPending={false}
        userInputRequestResponsePendingId={null}
      />
    </DesignerWorkspaceStoryFrame>
  );
}

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
      <DesignerWorkspaceStoryFrame initialEntries={["/designer/dsn_triage_agent_story"]}>
        <DesignerSessionPageView
          chatState={null}
          actionProposalResponseErrorMessage={null}
          actionProposalResponsePendingId={null}
          submittedActionProposalResponseId={null}
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
      </DesignerWorkspaceStoryFrame>
    );
  },
};

export const WorkspaceDesignerSpecificUi: Story = {
  decorators: [withDashboardWorkspaceStory],
  name: "Workspace Designer-specific UI",
  render: function RenderWorkspaceDesignerSpecificUiStory(): React.JSX.Element {
    return (
      <DesignerWorkspaceStoryFrame initialEntries={["/designer/dsn_designer_specific_ui"]}>
        <DesignerSessionPageView
          chatState={null}
          actionProposalResponseErrorMessage={null}
          actionProposalResponsePendingId={null}
          submittedActionProposalResponseId={null}
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
      </DesignerWorkspaceStoryFrame>
    );
  },
};

export const WorkspaceEmptyCanvas: Story = {
  decorators: [withDashboardWorkspaceStory],
  name: "Workspace Empty Canvas",
  render: function RenderWorkspaceEmptyCanvasStory(): React.JSX.Element {
    return (
      <DesignerWorkspaceStoryFrame initialEntries={["/designer/dsn_designer_empty_canvas"]}>
        <DesignerSessionPageView
          chatState={null}
          actionProposalResponseErrorMessage={null}
          actionProposalResponsePendingId={null}
          submittedActionProposalResponseId={null}
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
          session={StoryDesignerEmptyCanvasSession}
          sessionId="dsn_designer_empty_canvas"
          transcriptErrorMessage={null}
          transcriptIsPending={false}
          userInputRequestResponseErrorMessage={null}
          userInputRequestResponseIsPending={false}
          userInputRequestResponsePendingId={null}
        />
      </DesignerWorkspaceStoryFrame>
    );
  },
};

export const ActionProposalProviderConfigurationChange: Story = {
  decorators: [withDashboardWorkspaceStory],
  name: "Action Proposal / Provider Configuration Change",
  render: function RenderActionProposalProviderConfigurationChangeStory(): React.JSX.Element {
    return <DesignerActionProposalStory proposal={StoryProviderConfigurationChangeProposal} />;
  },
};

export const ActionProposalSetupScriptUpdate: Story = {
  decorators: [withDashboardWorkspaceStory],
  name: "Action Proposal / Setup Script Update",
  render: function RenderActionProposalSetupScriptUpdateStory(): React.JSX.Element {
    return <DesignerActionProposalStory proposal={StorySetupScriptProposal} />;
  },
};

export const ActionProposalSetupScriptClear: Story = {
  decorators: [withDashboardWorkspaceStory],
  name: "Action Proposal / Setup Script Clear",
  render: function RenderActionProposalSetupScriptClearStory(): React.JSX.Element {
    return <DesignerActionProposalStory proposal={StoryClearSetupScriptProposal} />;
  },
};

export const ActionProposalDraftPublish: Story = {
  decorators: [withDashboardWorkspaceStory],
  name: "Action Proposal / Draft Publish",
  render: function RenderActionProposalDraftPublishStory(): React.JSX.Element {
    return <DesignerActionProposalStory proposal={StoryDraftPublishProposal} />;
  },
};

export const ActionProposalVersionLaunch: Story = {
  decorators: [withDashboardWorkspaceStory],
  name: "Action Proposal / Version Launch",
  render: function RenderActionProposalVersionLaunchStory(): React.JSX.Element {
    return <DesignerActionProposalStory proposal={StoryLaunchProposal} />;
  },
};

export const ActionProposalVersionLaunchWithPrimaryRepository: Story = {
  decorators: [withDashboardWorkspaceStory],
  name: "Action Proposal / Version Launch With Primary Repository",
  render:
    function RenderActionProposalVersionLaunchWithPrimaryRepositoryStory(): React.JSX.Element {
      return <DesignerActionProposalStory proposal={StoryLaunchWithRepositoryProposal} />;
    },
};

export const ActionProposalStatusPending: Story = {
  decorators: [withDashboardWorkspaceStory],
  name: "Action Proposal Status / Pending",
  render: function RenderActionProposalStatusPendingStory(): React.JSX.Element {
    return <DesignerActionProposalStory proposal={StoryActionProposalStatusExamples.pending} />;
  },
};

export const ActionProposalStatusApproved: Story = {
  decorators: [withDashboardWorkspaceStory],
  name: "Action Proposal Status / Approved",
  render: function RenderActionProposalStatusApprovedStory(): React.JSX.Element {
    return <DesignerActionProposalStory proposal={StoryActionProposalStatusExamples.approved} />;
  },
};

export const ActionProposalStatusDeclined: Story = {
  decorators: [withDashboardWorkspaceStory],
  name: "Action Proposal Status / Declined",
  render: function RenderActionProposalStatusDeclinedStory(): React.JSX.Element {
    return <DesignerActionProposalStory proposal={StoryActionProposalStatusExamples.declined} />;
  },
};

export const ActionProposalStatusExecuting: Story = {
  decorators: [withDashboardWorkspaceStory],
  name: "Action Proposal Status / Executing",
  render: function RenderActionProposalStatusExecutingStory(): React.JSX.Element {
    return <DesignerActionProposalStory proposal={StoryActionProposalStatusExamples.executing} />;
  },
};

export const ActionProposalStatusExecutionUnsupported: Story = {
  decorators: [withDashboardWorkspaceStory],
  name: "Action Proposal Status / Execution Unsupported",
  render: function RenderActionProposalStatusExecutionUnsupportedStory(): React.JSX.Element {
    return (
      <DesignerActionProposalStory
        proposal={StoryActionProposalStatusExamples.executionUnsupported}
      />
    );
  },
};

export const ActionProposalStatusCompleted: Story = {
  decorators: [withDashboardWorkspaceStory],
  name: "Action Proposal Status / Completed",
  render: function RenderActionProposalStatusCompletedStory(): React.JSX.Element {
    return <DesignerActionProposalStory proposal={StoryActionProposalStatusExamples.completed} />;
  },
};

export const ActionProposalStatusFailed: Story = {
  decorators: [withDashboardWorkspaceStory],
  name: "Action Proposal Status / Failed",
  render: function RenderActionProposalStatusFailedStory(): React.JSX.Element {
    return <DesignerActionProposalStory proposal={StoryActionProposalStatusExamples.failed} />;
  },
};

export const ActionProposalSubmittingResponse: Story = {
  decorators: [withDashboardWorkspaceStory],
  name: "Action Proposal State / Submitting Response",
  render: function RenderActionProposalSubmittingResponseStory(): React.JSX.Element {
    return (
      <DesignerActionProposalStory
        pendingProposalId={StoryProviderConfigurationChangeProposal.id}
        proposal={StoryProviderConfigurationChangeProposal}
      />
    );
  },
};

export const ActionProposalResponseError: Story = {
  decorators: [withDashboardWorkspaceStory],
  name: "Action Proposal State / Response Error",
  render: function RenderActionProposalResponseErrorStory(): React.JSX.Element {
    return (
      <DesignerActionProposalStory
        errorMessage="Designer action proposal is not pending."
        proposal={StoryProviderConfigurationChangeProposal}
      />
    );
  },
};
