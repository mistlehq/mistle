// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import type {
  DesignerActionProposalResponse,
  DesignerActionProposalResponseResult,
  DesignerRuntimeConversationBootstrap,
  DesignerRuntimeConversationTranscript,
  DesignerSession,
} from "../designer/designer-service.js";
import { formatDesignerActionProposalResponseSuccessMessage } from "./designer-action-proposal-response-copy.js";
import { DesignerSessionPageView } from "./designer-session-page-view.js";

const BaseDesignerSession = {
  id: "dsn_test",
  organizationId: "org_test",
  sandboxInstanceId: "sbi_designer_test",
  initialPrompt: "Build a triaging agent for Linear bugs.",
  title: "Design triage agent",
  status: "running",
  connectable: true,
  failureCode: null,
  failureMessage: null,
  canvasTabs: [],
  createdAt: "2026-04-01T09:00:00.000Z",
  updatedAt: "2026-04-01T09:00:00.000Z",
} satisfies DesignerSession;

const RuntimeConversationBootstrap = {
  providerConversationId: "thread_designer_test",
  providerExecutionId: "turn_designer_initial_prompt",
  initialPromptSubmittedAt: "2026-04-01T09:01:00.000Z",
} satisfies DesignerRuntimeConversationBootstrap;

const RuntimeConversationTranscript = {
  providerConversationId: "thread_designer_test",
  name: "Design triage agent",
  preview: "I can help design that workflow.",
  turns: [
    {
      id: "turn_designer_initial_prompt",
      status: "completed",
      items: [
        {
          id: "item_user_initial_prompt",
          type: "userMessage",
          content: [
            {
              type: "text",
              text: "Build a triaging agent for Linear bugs.",
            },
          ],
        },
        {
          id: "item_assistant_initial_response",
          type: "agentMessage",
          text: "I can help design that workflow.",
          status: "completed",
        },
      ],
    },
  ],
  actionProposals: [],
} satisfies DesignerRuntimeConversationTranscript;

const RuntimeConversationTranscriptWithActionProposal = {
  ...RuntimeConversationTranscript,
  actionProposals: [
    {
      id: "dap_github_webhook_setup",
      kind: "designerActionProposal",
      title: "Create GitHub webhook",
      summary: "Create a webhook on the selected repository for pull request events.",
      status: "pending",
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
} satisfies DesignerRuntimeConversationTranscript;

const RuntimeConversationTranscriptWithSetupScriptActionProposal = {
  ...RuntimeConversationTranscript,
  actionProposals: [
    {
      id: "dap_profile_setup_script",
      kind: "designerActionProposal",
      title: "Update setup script",
      summary: "Update the draft setup script for the selected sandbox profile.",
      status: "pending",
      operation: {
        kind: "sandboxProfileDraftSetupScriptPut",
        profileId: "sbp_designer_setup_script",
        version: 2,
        setupScript: "pnpm install\npnpm build",
      },
    },
  ],
} satisfies DesignerRuntimeConversationTranscript;

const RuntimeConversationTranscriptWithPublishActionProposal = {
  ...RuntimeConversationTranscript,
  actionProposals: [
    {
      id: "dap_profile_publish",
      kind: "designerActionProposal",
      title: "Publish draft profile",
      summary: "Publish the selected sandbox profile draft.",
      status: "pending",
      operation: {
        kind: "sandboxProfileDraftPublish",
        profileId: "sbp_designer_publish",
        version: 3,
      },
    },
  ],
} satisfies DesignerRuntimeConversationTranscript;

const RuntimeConversationTranscriptWithLaunchActionProposal = {
  ...RuntimeConversationTranscript,
  actionProposals: [
    {
      id: "dap_profile_launch",
      kind: "designerActionProposal",
      title: "Launch sandbox session",
      summary: "Start an ordinary sandbox session from the selected sandbox profile version.",
      status: "pending",
      operation: {
        kind: "sandboxProfileVersionLaunch",
        profileId: "sbp_designer_launch",
        version: 4,
        primaryRepositoryId: null,
        idempotencyKey: "designer-launch-001",
      },
    },
  ],
} satisfies DesignerRuntimeConversationTranscript;

function renderDesignerSessionPageView(input?: {
  bootstrapErrorMessage?: string | null;
  bootstrapIsPending?: boolean;
  actionProposalResponseErrorMessage?: string | null;
  actionProposalResponsePendingId?: string | null;
  actionProposalResponseSuccessMessage?: string | null;
  followUpDraft?: string;
  followUpErrorMessage?: string | null;
  followUpIsPending?: boolean;
  followUpSuccessMessage?: string | null;
  runtimeConversationBootstrap?: DesignerRuntimeConversationBootstrap | null;
  runtimeConversationTranscript?: DesignerRuntimeConversationTranscript | null;
  session?: DesignerSession | null;
  transcriptErrorMessage?: string | null;
  transcriptIsPending?: boolean;
}): void {
  render(
    <DesignerSessionPageView
      bootstrapErrorMessage={input?.bootstrapErrorMessage ?? null}
      bootstrapIsPending={input?.bootstrapIsPending ?? false}
      actionProposalResponseErrorMessage={input?.actionProposalResponseErrorMessage ?? null}
      actionProposalResponsePendingId={input?.actionProposalResponsePendingId ?? null}
      actionProposalResponseSuccessMessage={input?.actionProposalResponseSuccessMessage ?? null}
      errorMessage={null}
      followUpDraft={input?.followUpDraft ?? ""}
      followUpErrorMessage={input?.followUpErrorMessage ?? null}
      followUpIsPending={input?.followUpIsPending ?? false}
      followUpSuccessMessage={input?.followUpSuccessMessage ?? null}
      onActionProposalResponseSubmit={() => {}}
      onFollowUpDraftChange={() => {}}
      onFollowUpSubmit={() => {}}
      runtimeConversationBootstrap={input?.runtimeConversationBootstrap ?? null}
      runtimeConversationTranscript={input?.runtimeConversationTranscript ?? null}
      session={input?.session ?? BaseDesignerSession}
      sessionId="dsn_test"
      transcriptErrorMessage={input?.transcriptErrorMessage ?? null}
      transcriptIsPending={input?.transcriptIsPending ?? false}
    />,
  );
}

function DesignerSessionPageViewActionResponseHarness(): React.JSX.Element {
  const [submitted, setSubmitted] = useState("none");

  return (
    <>
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
        onActionProposalResponseSubmit={(
          proposalId: string,
          response: DesignerActionProposalResponse,
        ) => {
          setSubmitted(`${proposalId}:${response}`);
        }}
        onFollowUpDraftChange={() => {}}
        onFollowUpSubmit={() => {}}
        runtimeConversationBootstrap={RuntimeConversationBootstrap}
        runtimeConversationTranscript={RuntimeConversationTranscriptWithActionProposal}
        session={BaseDesignerSession}
        sessionId="dsn_test"
        transcriptErrorMessage={null}
        transcriptIsPending={false}
      />
      <output aria-label="Submitted action proposal response">{submitted}</output>
    </>
  );
}

describe("DesignerSessionPageView", () => {
  it("shows the initial prompt and completed runtime bootstrap identity", () => {
    renderDesignerSessionPageView({
      runtimeConversationBootstrap: RuntimeConversationBootstrap,
    });

    expect(screen.getByText("Build a triaging agent for Linear bugs.")).toBeDefined();
    expect(screen.getByText("Runtime conversation ready")).toBeDefined();
    expect(screen.getByText("Runtime conversation")).toBeDefined();
    expect(screen.getByText("Initial prompt submitted")).toBeDefined();
    expect(screen.getByText("Submitted at 2026-04-01T09:01:00.000Z.")).toBeDefined();
    expect(screen.getByText("thread_designer_test")).toBeDefined();
    expect(screen.getAllByText("turn_designer_initial_prompt")).toHaveLength(2);
    expect(screen.getByLabelText("Submit follow-up")).toBeDefined();
  });

  it("enables follow-up submission only after runtime bootstrap is ready", () => {
    renderDesignerSessionPageView({
      followUpDraft: "Add Slack escalation.",
      runtimeConversationBootstrap: RuntimeConversationBootstrap,
    });

    expect(screen.getByLabelText("Submit follow-up")).toHaveProperty("disabled", false);
  });

  it("shows acknowledged runtime follow-up submission status", () => {
    renderDesignerSessionPageView({
      runtimeConversationBootstrap: RuntimeConversationBootstrap,
      followUpSuccessMessage: "Follow-up submitted at 2026-04-01T09:02:00.000Z.",
    });

    expect(screen.getByText("Follow-up submitted at 2026-04-01T09:02:00.000Z.")).toBeDefined();
  });

  it("hydrates the runtime conversation from provider transcript turns", () => {
    renderDesignerSessionPageView({
      runtimeConversationBootstrap: RuntimeConversationBootstrap,
      runtimeConversationTranscript: RuntimeConversationTranscript,
    });

    expect(screen.getByText("Build a triaging agent for Linear bugs.")).toBeDefined();
    expect(screen.getByText("I can help design that workflow.")).toBeDefined();
    expect(screen.queryByText("Initial prompt submitted")).toBeNull();
  });

  it("renders Designer action proposals with response controls", () => {
    renderDesignerSessionPageView({
      runtimeConversationBootstrap: RuntimeConversationBootstrap,
      runtimeConversationTranscript: RuntimeConversationTranscriptWithActionProposal,
    });

    expect(screen.getByText("Action proposals")).toBeDefined();
    expect(screen.getByText("Create GitHub webhook")).toBeDefined();
    expect(
      screen.getByText("Create a webhook on the selected repository for pull request events."),
    ).toBeDefined();
    expect(screen.getByText("GitHub create webhook")).toBeDefined();
    expect(screen.getByText("repository webhook: mistle/agent-runtime")).toBeDefined();
    expect(screen.getByText("pull_request, pull_request_review")).toBeDefined();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Decline" })).toBeDefined();
  });

  it("renders typed Designer setup script action proposals", () => {
    renderDesignerSessionPageView({
      runtimeConversationBootstrap: RuntimeConversationBootstrap,
      runtimeConversationTranscript: RuntimeConversationTranscriptWithSetupScriptActionProposal,
    });

    expect(screen.getByText("Update setup script")).toBeDefined();
    expect(screen.getByText("Update sandbox profile draft setup script")).toBeDefined();
    expect(screen.getByText("sbp_designer_setup_script version 2")).toBeDefined();
    expect(
      screen.getByText((_, element) => element?.textContent === "pnpm install\npnpm build"),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDefined();
  });

  it("renders typed Designer publish action proposals", () => {
    renderDesignerSessionPageView({
      runtimeConversationBootstrap: RuntimeConversationBootstrap,
      runtimeConversationTranscript: RuntimeConversationTranscriptWithPublishActionProposal,
    });

    expect(screen.getByText("Publish draft profile")).toBeDefined();
    expect(screen.getByText("Publish sandbox profile draft")).toBeDefined();
    expect(screen.getByText("sbp_designer_publish version 3")).toBeDefined();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDefined();
  });

  it("renders typed Designer launch action proposals", () => {
    renderDesignerSessionPageView({
      runtimeConversationBootstrap: RuntimeConversationBootstrap,
      runtimeConversationTranscript: RuntimeConversationTranscriptWithLaunchActionProposal,
    });

    expect(screen.getAllByText("Launch sandbox session")).toHaveLength(2);
    expect(
      screen.getByText(
        "Start an ordinary sandbox session from the selected sandbox profile version.",
      ),
    ).toBeDefined();
    expect(screen.getByText("sbp_designer_launch version 4")).toBeDefined();
    expect(screen.getByText("Workspace root")).toBeDefined();
    expect(screen.getByText("designer-launch-001")).toBeDefined();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDefined();
  });

  it("submits Designer action proposal responses with the selected proposal decision", () => {
    render(<DesignerSessionPageViewActionResponseHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(screen.getByLabelText("Submitted action proposal response").textContent).toBe(
      "dap_github_webhook_setup:approved",
    );
  });

  it("disables Designer action proposal response controls while a response is pending", () => {
    renderDesignerSessionPageView({
      actionProposalResponsePendingId: "dap_github_webhook_setup",
      runtimeConversationBootstrap: RuntimeConversationBootstrap,
      runtimeConversationTranscript: RuntimeConversationTranscriptWithActionProposal,
    });

    expect(screen.getAllByRole("button", { name: "Submitting" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Submitting" })[0]).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("shows Designer action proposal response submission status", () => {
    renderDesignerSessionPageView({
      actionProposalResponseErrorMessage: "Designer action proposal is not pending.",
      actionProposalResponseSuccessMessage:
        "Action proposal response submitted at 2026-04-01T09:03:00.000Z.",
      runtimeConversationBootstrap: RuntimeConversationBootstrap,
      runtimeConversationTranscript: RuntimeConversationTranscriptWithActionProposal,
    });

    expect(screen.getByText("Designer action proposal is not pending.")).toBeDefined();
    expect(
      screen.getByText("Action proposal response submitted at 2026-04-01T09:03:00.000Z."),
    ).toBeDefined();
  });

  it("formats completed Designer publish results with persisted snapshot metadata", () => {
    const result = {
      actionProposalResponse: {
        proposalId: "dap_profile_publish",
        response: "approved",
        providerConversationId: "thread_designer_test",
        providerExecutionId: "turn_publish_response",
        submittedAt: "2026-04-01T09:03:00.000Z",
      },
      actionRequest: {
        id: "dar_profile_publish",
        status: "completed",
        failureCode: null,
        failureMessage: null,
        operationResult: {
          kind: "sandboxProfileDraftPublish",
          profileId: "sbp_designer_publish",
          version: 3,
          publishedAt: "2026-04-01T09:03:01.000Z",
          snapshotAction: {
            kind: "created",
            snapshotJobId: "spv_snapshot_job_designer_publish",
            sandboxInstanceId: "sbi_designer_publish_snapshot",
          },
        },
      },
    } satisfies DesignerActionProposalResponseResult;

    expect(formatDesignerActionProposalResponseSuccessMessage(result)).toBe(
      "Action proposal response submitted at 2026-04-01T09:03:00.000Z. Published sbp_designer_publish version 3 and queued snapshot job spv_snapshot_job_designer_publish.",
    );
  });

  it("formats completed Designer launch results with the launched sandbox instance", () => {
    const result = {
      actionProposalResponse: {
        proposalId: "dap_profile_launch",
        response: "approved",
        providerConversationId: "thread_designer_test",
        providerExecutionId: "turn_launch_response",
        submittedAt: "2026-04-01T09:04:00.000Z",
      },
      actionRequest: {
        id: "dar_profile_launch",
        status: "completed",
        failureCode: null,
        failureMessage: null,
        operationResult: {
          kind: "sandboxProfileVersionLaunch",
          profileId: "sbp_designer_launch",
          version: 4,
          sandboxInstanceId: "sbi_designer_launch",
          workflowRunId: "workflow_designer_launch",
        },
      },
    } satisfies DesignerActionProposalResponseResult;

    expect(formatDesignerActionProposalResponseSuccessMessage(result)).toBe(
      "Action proposal response submitted at 2026-04-01T09:04:00.000Z. Launched sandbox session sbi_designer_launch.",
    );
  });

  it("shows transcript load errors while retaining the saved prompt preview", () => {
    renderDesignerSessionPageView({
      runtimeConversationBootstrap: RuntimeConversationBootstrap,
      transcriptErrorMessage: "Could not load Designer runtime conversation transcript.",
    });

    expect(screen.getByText("Build a triaging agent for Linear bugs.")).toBeDefined();
    expect(
      screen.getByText("Could not load Designer runtime conversation transcript."),
    ).toBeDefined();
  });

  it("shows transcript refresh errors while retaining hydrated transcript content", () => {
    renderDesignerSessionPageView({
      runtimeConversationBootstrap: RuntimeConversationBootstrap,
      runtimeConversationTranscript: RuntimeConversationTranscript,
      transcriptErrorMessage: "Could not refresh Designer runtime conversation transcript.",
    });

    expect(screen.getByText("I can help design that workflow.")).toBeDefined();
    expect(
      screen.getByText("Could not refresh Designer runtime conversation transcript."),
    ).toBeDefined();
  });

  it("shows runtime follow-up submission errors without hiding the conversation", () => {
    renderDesignerSessionPageView({
      runtimeConversationBootstrap: RuntimeConversationBootstrap,
      followUpErrorMessage: "Designer runtime conversation is not ready for follow-up submission.",
    });

    expect(screen.getByText("Build a triaging agent for Linear bugs.")).toBeDefined();
    expect(
      screen.getByText("Designer runtime conversation is not ready for follow-up submission."),
    ).toBeDefined();
  });

  it("shows the initial prompt as waiting before runtime bootstrap completes", () => {
    renderDesignerSessionPageView();

    expect(screen.getByText("Runtime conversation")).toBeDefined();
    expect(screen.getByText("Initial prompt")).toBeDefined();
    expect(screen.getByText("Waiting to submit to the Designer runtime.")).toBeDefined();
    expect(screen.getByLabelText("Submit follow-up")).toHaveProperty("disabled", true);
  });

  it("shows runtime bootstrap progress before the conversation is ready", () => {
    renderDesignerSessionPageView({
      bootstrapIsPending: true,
    });

    expect(screen.getByText("Preparing runtime conversation")).toBeDefined();
    expect(screen.getByText("Initial prompt submitting")).toBeDefined();
    expect(screen.getByText("Submitting to the Designer runtime.")).toBeDefined();
    expect(
      screen.getByText("Submitting the initial prompt to the Designer runtime."),
    ).toBeDefined();
  });

  it("shows a waiting state while the Designer sandbox is not ready yet", () => {
    renderDesignerSessionPageView({
      session: {
        ...BaseDesignerSession,
        status: "stopping",
        connectable: false,
      },
    });

    expect(screen.getByText("Waiting for runtime")).toBeDefined();
    expect(
      screen.getByText("Runtime bootstrap will start when the Designer sandbox is ready."),
    ).toBeDefined();
  });

  it("shows pending bootstrap copy for a stopped Designer sandbox", () => {
    renderDesignerSessionPageView({
      session: {
        ...BaseDesignerSession,
        status: "stopped",
        connectable: false,
      },
    });

    expect(screen.getByText("Runtime bootstrap pending")).toBeDefined();
    expect(
      screen.getByText("Runtime bootstrap will start when the session is ready."),
    ).toBeDefined();
  });

  it("shows why bootstrap is unavailable for a failed Designer sandbox", () => {
    renderDesignerSessionPageView({
      session: {
        ...BaseDesignerSession,
        status: "failed",
        connectable: false,
        failureMessage: "Could not start the Designer sandbox runtime.",
      },
    });

    expect(screen.getByText("Runtime unavailable")).toBeDefined();
    expect(screen.getAllByText("Could not start the Designer sandbox runtime.")).toHaveLength(2);
    expect(screen.getByText("Initial prompt not submitted")).toBeDefined();
  });

  it("shows bootstrap endpoint errors without hiding the saved prompt", () => {
    renderDesignerSessionPageView({
      bootstrapErrorMessage: "Designer sandbox is not ready for runtime conversation bootstrap.",
    });

    expect(screen.getByText("Build a triaging agent for Linear bugs.")).toBeDefined();
    expect(screen.getByText("Runtime bootstrap failed")).toBeDefined();
    expect(screen.getByText("Initial prompt status unknown")).toBeDefined();
    expect(screen.getByText("Runtime bootstrap failed while submitting the prompt.")).toBeDefined();
    expect(
      screen.getByText("Designer sandbox is not ready for runtime conversation bootstrap."),
    ).toBeDefined();
  });
});
