// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type {
  DesignerRuntimeConversationBootstrap,
  DesignerRuntimeConversationTranscript,
  DesignerSession,
} from "../designer/designer-service.js";
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
} satisfies DesignerRuntimeConversationTranscript;

function renderDesignerSessionPageView(input?: {
  bootstrapErrorMessage?: string | null;
  bootstrapIsPending?: boolean;
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
      errorMessage={null}
      followUpDraft={input?.followUpDraft ?? ""}
      followUpErrorMessage={input?.followUpErrorMessage ?? null}
      followUpIsPending={input?.followUpIsPending ?? false}
      followUpSuccessMessage={input?.followUpSuccessMessage ?? null}
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
