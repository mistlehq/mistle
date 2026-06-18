// @vitest-environment jsdom

import { SidebarProvider } from "@mistle/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { beforeAll, describe, expect, it } from "vitest";

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
  startupOperation: null,
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
  userInputRequests: [],
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
      actionRequest: null,
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
      actionRequest: null,
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
      actionRequest: null,
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

const RuntimeConversationTranscriptWithCompletedLaunchActionRequest = {
  ...RuntimeConversationTranscript,
  actionProposals: [
    {
      id: "dap_profile_launch",
      kind: "designerActionProposal",
      title: "Launch sandbox session",
      summary: "Start an ordinary sandbox session from the selected sandbox profile version.",
      status: "completed",
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

const RuntimeConversationTranscriptWithFailedActionRequest = {
  ...RuntimeConversationTranscript,
  actionProposals: [
    {
      id: "dap_github_webhook_setup",
      kind: "designerActionProposal",
      title: "Create GitHub webhook",
      summary: "Create a webhook on the selected repository for pull request events.",
      status: "failed",
      actionRequest: {
        id: "dar_github_webhook_setup",
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
} satisfies DesignerRuntimeConversationTranscript;

function renderWithQueryClient(
  ui: React.JSX.Element,
  input?: {
    sidebarDefaultOpen?: boolean;
  },
): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <SidebarProvider defaultOpen={input?.sidebarDefaultOpen ?? true}>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </SidebarProvider>,
  );
}

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
  sidebarDefaultOpen?: boolean;
  onTitleSave?: (title: string) => Promise<void> | void;
  transcriptErrorMessage?: string | null;
  transcriptIsPending?: boolean;
  userInputRequestResponseErrorMessage?: string | null;
  userInputRequestResponseIsPending?: boolean;
  userInputRequestResponsePendingId?: string | number | null;
}): ReturnType<typeof render> {
  const runtimeConversationBootstrap = input?.runtimeConversationBootstrap ?? null;
  const runtimeConversationTranscript =
    input !== undefined && "runtimeConversationTranscript" in input
      ? (input.runtimeConversationTranscript ?? null)
      : runtimeConversationBootstrap === null
        ? null
        : RuntimeConversationTranscript;

  return renderWithQueryClient(
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
      onTitleSave={input?.onTitleSave ?? (() => {})}
      onUserInputRequestResponseSubmit={() => {}}
      runtimeConversationBootstrap={runtimeConversationBootstrap}
      runtimeConversationTranscript={runtimeConversationTranscript}
      session={input?.session ?? BaseDesignerSession}
      sessionId="dsn_test"
      transcriptErrorMessage={input?.transcriptErrorMessage ?? null}
      transcriptIsPending={input?.transcriptIsPending ?? false}
      userInputRequestResponseErrorMessage={input?.userInputRequestResponseErrorMessage ?? null}
      userInputRequestResponseIsPending={input?.userInputRequestResponseIsPending ?? false}
      userInputRequestResponsePendingId={input?.userInputRequestResponsePendingId ?? null}
    />,
    input?.sidebarDefaultOpen === undefined
      ? undefined
      : {
          sidebarDefaultOpen: input.sidebarDefaultOpen,
        },
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
        onTitleSave={() => {}}
        onUserInputRequestResponseSubmit={() => {}}
        runtimeConversationBootstrap={RuntimeConversationBootstrap}
        runtimeConversationTranscript={RuntimeConversationTranscriptWithActionProposal}
        session={BaseDesignerSession}
        sessionId="dsn_test"
        transcriptErrorMessage={null}
        transcriptIsPending={false}
        userInputRequestResponseErrorMessage={null}
        userInputRequestResponseIsPending={false}
        userInputRequestResponsePendingId={null}
      />
      <output aria-label="Submitted action proposal response">{submitted}</output>
    </>
  );
}

function DesignerSessionPageViewUserInputResponseHarness(): React.JSX.Element {
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
        onActionProposalResponseSubmit={() => {}}
        onFollowUpDraftChange={() => {}}
        onFollowUpSubmit={() => {}}
        onTitleSave={() => {}}
        onUserInputRequestResponseSubmit={(requestId: string | number, result: unknown) => {
          setSubmitted(
            JSON.stringify({
              requestId,
              result,
            }),
          );
        }}
        runtimeConversationBootstrap={RuntimeConversationBootstrap}
        runtimeConversationTranscript={{
          ...RuntimeConversationTranscript,
          userInputRequests: [
            {
              requestId: 7,
              method: "tool/requestUserInput",
              kind: "tool-user-input",
              questions: [
                {
                  header: "Provider",
                  id: "repository",
                  question: "Which repository should Designer configure?",
                  options: [
                    {
                      label: "mistle/app",
                      description: "Production app repository",
                      isOther: false,
                    },
                    {
                      label: "Other",
                      description: null,
                      isOther: true,
                    },
                  ],
                },
              ],
              status: "pending",
              responseErrorMessage: null,
            },
          ],
        }}
        session={BaseDesignerSession}
        sessionId="dsn_test"
        transcriptErrorMessage={null}
        transcriptIsPending={false}
        userInputRequestResponseErrorMessage={null}
        userInputRequestResponseIsPending={false}
        userInputRequestResponsePendingId={null}
      />
      <output aria-label="Submitted user input response">{submitted}</output>
    </>
  );
}

function DesignerSessionPageViewTitleHarness(): React.JSX.Element {
  const [submittedTitle, setSubmittedTitle] = useState("none");

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
        onActionProposalResponseSubmit={() => {}}
        onFollowUpDraftChange={() => {}}
        onFollowUpSubmit={() => {}}
        onTitleSave={(title) => {
          setSubmittedTitle(title);
        }}
        onUserInputRequestResponseSubmit={() => {}}
        runtimeConversationBootstrap={RuntimeConversationBootstrap}
        runtimeConversationTranscript={RuntimeConversationTranscript}
        session={BaseDesignerSession}
        sessionId="dsn_test"
        transcriptErrorMessage={null}
        transcriptIsPending={false}
        userInputRequestResponseErrorMessage={null}
        userInputRequestResponseIsPending={false}
        userInputRequestResponsePendingId={null}
      />
      <output aria-label="Submitted Designer session title">{submittedTitle}</output>
    </>
  );
}

describe("DesignerSessionPageView", () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: class ResizeObserver {
        disconnect(): void {}
        observe(): void {}
        unobserve(): void {}
      },
      writable: true,
    });
  });

  it("shows the session title, status indicator, and initial prompt", () => {
    renderDesignerSessionPageView({
      runtimeConversationBootstrap: RuntimeConversationBootstrap,
    });

    expect(screen.getByRole("textbox", { name: "Designer session title" })).toHaveProperty(
      "value",
      "Design triage agent",
    );
    expect(screen.getByRole("status", { name: "Running" })).toBeDefined();
    expect(screen.getByText("Build a triaging agent for Linear bugs.")).toBeDefined();
    expect(screen.getByLabelText("Submit follow-up")).toBeDefined();
    expect(screen.queryByText("Designer")).toBeNull();
    expect(screen.queryByText("dsn_test")).toBeNull();
    expect(screen.queryByText("Runtime ready")).toBeNull();
  });

  it("insets the Designer conversation scrollbar from the canvas split", () => {
    renderDesignerSessionPageView({
      runtimeConversationBootstrap: RuntimeConversationBootstrap,
    });

    const conversationRegion = screen.getByRole("region", { name: "Designer conversation" });

    expect(conversationRegion.getAttribute("style")).toBe("scrollbar-gutter: stable;");
    expect(conversationRegion.className).toContain("overflow-y-auto");
    expect(screen.getAllByRole("region", { name: "Designer conversation" })).toHaveLength(1);
  });

  it("renders the sidebar trigger in the Designer session header when the sidebar is collapsed", () => {
    renderDesignerSessionPageView({
      runtimeConversationBootstrap: RuntimeConversationBootstrap,
      sidebarDefaultOpen: false,
    });
    const workspaceHeader = screen.getByRole("banner");

    expect(
      within(workspaceHeader).getByRole("button", {
        name: "Toggle Sidebar",
      }),
    ).toBeTruthy();
  });

  it("renders the shared workbench split between the Designer conversation and canvas", () => {
    const { container } = renderDesignerSessionPageView({
      session: {
        ...BaseDesignerSession,
        canvasTabs: [
          {
            id: "integrations",
            title: "Integrations",
            href: "/integrations",
          },
        ],
      },
    });

    const resizeHandle = screen.getByTestId("session-workbench-secondary-handle");

    expect(resizeHandle.className).toContain("w-px");
    expect(resizeHandle.className).not.toContain("aria-orientation-vertical:!w-3");
    expect(container.querySelector(".border-r")).toBeNull();
    expect(screen.getByText("/integrations")).toBeDefined();
  });

  it("submits Designer title edits from the shared inline title control", async () => {
    renderWithQueryClient(<DesignerSessionPageViewTitleHarness />);

    const titleInput = screen.getByRole("textbox", { name: "Designer session title" });
    fireEvent.change(titleInput, { target: { value: "Design GitHub triage" } });
    fireEvent.blur(titleInput);

    expect(await screen.findByText("Design GitHub triage")).toBeDefined();
    expect(screen.getByLabelText("Submitted Designer session title").textContent).toBe(
      "Design GitHub triage",
    );
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

    expect(screen.queryByText("Action proposals")).toBeNull();
    expect(screen.getByText("Create GitHub webhook")).toBeDefined();
    expect(
      screen.getByText("Create a webhook on the selected repository for pull request events."),
    ).toBeDefined();
    expect(screen.queryByText("Review required")).toBeNull();
    expect(screen.getByText("pull_request, pull_request_review")).toBeDefined();
    expect(screen.queryByText("GitHub create webhook")).toBeNull();
    expect(screen.queryByText("repository webhook: mistle/agent-runtime")).toBeNull();
    const actionButtons = screen
      .getAllByRole("button")
      .filter((button) => button.textContent === "Decline" || button.textContent === "Approve");
    expect(actionButtons.map((button) => button.textContent)).toEqual(["Decline", "Approve"]);
    expect(screen.getByRole("button", { name: "Approve" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Decline" })).toBeDefined();
    expect(
      Boolean(
        screen
          .getByText("Create GitHub webhook")
          .compareDocumentPosition(screen.getByLabelText("Submit follow-up")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
  });

  it("renders typed Designer setup script action proposals", () => {
    renderDesignerSessionPageView({
      runtimeConversationBootstrap: RuntimeConversationBootstrap,
      runtimeConversationTranscript: RuntimeConversationTranscriptWithSetupScriptActionProposal,
    });

    expect(screen.getByText("Update setup script")).toBeDefined();
    expect(
      screen.getByText((_, element) => element?.textContent === "pnpm install\npnpm build"),
    ).toBeDefined();
    expect(screen.queryByText("Update sandbox profile draft setup script")).toBeNull();
    expect(screen.queryByText("sbp_designer_setup_script version 2")).toBeNull();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDefined();
  });

  it("renders typed Designer publish action proposals", () => {
    renderDesignerSessionPageView({
      runtimeConversationBootstrap: RuntimeConversationBootstrap,
      runtimeConversationTranscript: RuntimeConversationTranscriptWithPublishActionProposal,
    });

    expect(screen.getByText("Publish draft profile")).toBeDefined();
    expect(screen.queryByText("Publish sandbox profile draft")).toBeNull();
    expect(screen.queryByText("sbp_designer_publish version 3")).toBeNull();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDefined();
  });

  it("renders typed Designer launch action proposals", () => {
    renderDesignerSessionPageView({
      runtimeConversationBootstrap: RuntimeConversationBootstrap,
      runtimeConversationTranscript: RuntimeConversationTranscriptWithLaunchActionProposal,
    });

    expect(screen.getByText("Launch sandbox session")).toBeDefined();
    expect(
      screen.getByText(
        "Start an ordinary sandbox session from the selected sandbox profile version.",
      ),
    ).toBeDefined();
    expect(screen.queryByText("sbp_designer_launch version 4")).toBeNull();
    expect(screen.queryByText("Workspace root")).toBeNull();
    expect(screen.queryByText("designer-launch-001")).toBeNull();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDefined();
  });

  it("renders hydrated durable action request results for resumed proposals", () => {
    renderDesignerSessionPageView({
      runtimeConversationBootstrap: RuntimeConversationBootstrap,
      runtimeConversationTranscript: RuntimeConversationTranscriptWithCompletedLaunchActionRequest,
    });

    expect(screen.queryByText("Completed")).toBeNull();
    expect(screen.getByText("Action request")).toBeDefined();
    expect(screen.getByText("dar_profile_launch")).toBeDefined();
    expect(screen.getByText("Launched sandbox session sbi_designer_launch.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
  });

  it("renders hydrated durable action request failures for resumed proposals", () => {
    renderDesignerSessionPageView({
      runtimeConversationBootstrap: RuntimeConversationBootstrap,
      runtimeConversationTranscript: RuntimeConversationTranscriptWithFailedActionRequest,
    });

    expect(screen.queryByText("Failed")).toBeNull();
    expect(screen.getByText("DESIGNER_OPERATION_FAILED")).toBeDefined();
    expect(screen.getByText("GitHub rejected the webhook configuration.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
  });

  it("submits Designer action proposal responses with the selected proposal decision", () => {
    renderWithQueryClient(<DesignerSessionPageViewActionResponseHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(screen.getByLabelText("Submitted action proposal response").textContent).toBe(
      "dap_github_webhook_setup:approved",
    );
  });

  it("submits Designer user input request responses with collected answers", () => {
    renderWithQueryClient(<DesignerSessionPageViewUserInputResponseHarness />);

    fireEvent.click(screen.getByRole("button", { name: "mistle/app" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit responses" }));

    expect(screen.getByLabelText("Submitted user input response").textContent).toBe(
      '{"requestId":7,"result":{"answers":[{"id":"repository","value":"mistle/app"}]}}',
    );
  });

  it("scopes Designer user input response status to the submitted request", () => {
    renderDesignerSessionPageView({
      runtimeConversationBootstrap: RuntimeConversationBootstrap,
      runtimeConversationTranscript: {
        ...RuntimeConversationTranscript,
        userInputRequests: [
          {
            requestId: "request_repository",
            method: "tool/requestUserInput",
            kind: "tool-user-input",
            questions: [
              {
                header: null,
                id: "repository",
                question: "Which repository should Designer configure?",
                options: [
                  {
                    label: "mistle/app",
                    description: null,
                    isOther: false,
                  },
                ],
              },
            ],
            status: "pending",
            responseErrorMessage: null,
          },
          {
            requestId: "request_channel",
            method: "tool/requestUserInput",
            kind: "tool-user-input",
            questions: [
              {
                header: null,
                id: "channel",
                question: "Which Slack channel should Designer use?",
                options: [
                  {
                    label: "#support",
                    description: null,
                    isOther: false,
                  },
                ],
              },
            ],
            status: "pending",
            responseErrorMessage: null,
          },
        ],
      },
      userInputRequestResponseErrorMessage: "Could not submit Designer user input response.",
      userInputRequestResponseIsPending: true,
      userInputRequestResponsePendingId: "request_repository",
    });

    expect(screen.getByText("Could not submit Designer user input response.")).toBeDefined();
    expect(screen.getByText("Which Slack channel should Designer use?")).toBeDefined();
    expect(screen.getAllByRole("button", { name: "Submit responses" })[0]).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getAllByRole("button", { name: "Submit responses" })[1]).toHaveProperty(
      "disabled",
      true,
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

  it("shows the shared connecting chat startup state before runtime bootstrap completes", () => {
    renderDesignerSessionPageView({
      session: {
        ...BaseDesignerSession,
        startupOperation: {
          operationId: "owfr_designer_startup",
          operationKind: "start",
        },
      },
    });

    expect(screen.getByText("Connecting chat")).toBeDefined();
    expect(screen.getByText("No lifecycle events yet.")).toBeDefined();
    expect(screen.queryByLabelText("Submit follow-up")).toBeNull();
    expect(screen.queryByText("Build a triaging agent for Linear bugs.")).toBeNull();
  });

  it("shows shared sandbox startup progress while runtime bootstrap is pending", () => {
    renderDesignerSessionPageView({
      bootstrapIsPending: true,
      session: {
        ...BaseDesignerSession,
        status: "starting",
        connectable: false,
        startupOperation: {
          operationId: "owfr_designer_startup",
          operationKind: "start",
        },
      },
    });

    expect(screen.getByText("Running setup")).toBeDefined();
    expect(screen.getByText("No lifecycle events yet.")).toBeDefined();
    expect(screen.queryByText("Preparing runtime conversation")).toBeNull();
  });

  it("shows shared stopping startup progress while the Designer sandbox is stopping", () => {
    renderDesignerSessionPageView({
      session: {
        ...BaseDesignerSession,
        status: "stopping",
        connectable: false,
      },
    });

    expect(screen.getByRole("status", { name: "Stopping" })).toBeDefined();
    expect(screen.getByText("Stopping sandbox")).toBeDefined();
    expect(screen.queryByText("Waiting for runtime")).toBeNull();
  });

  it("shows only the session status indicator for a stopped Designer sandbox", () => {
    renderDesignerSessionPageView({
      session: {
        ...BaseDesignerSession,
        status: "stopped",
        connectable: false,
      },
    });

    expect(screen.getByRole("status", { name: "Stopped" })).toBeDefined();
    expect(screen.getByText("Build a triaging agent for Linear bugs.")).toBeDefined();
    expect(screen.queryByText("Runtime bootstrap pending")).toBeNull();
  });

  it("shows only the failed session status indicator for a failed Designer sandbox", () => {
    renderDesignerSessionPageView({
      session: {
        ...BaseDesignerSession,
        status: "failed",
        connectable: false,
        failureMessage: "Could not start the Designer sandbox runtime.",
      },
    });

    expect(screen.getByRole("status", { name: "Failed" })).toBeDefined();
    expect(screen.getByText("Build a triaging agent for Linear bugs.")).toBeDefined();
    expect(screen.queryByText("Runtime unavailable")).toBeNull();
    expect(screen.queryByText("Could not start the Designer sandbox runtime.")).toBeNull();
  });

  it("does not show runtime bootstrap endpoint errors as session header content", () => {
    renderDesignerSessionPageView({
      bootstrapErrorMessage: "Designer sandbox is not ready for runtime conversation bootstrap.",
    });

    expect(screen.getByText("Connecting chat")).toBeDefined();
    expect(
      screen.queryByText("Designer sandbox is not ready for runtime conversation bootstrap."),
    ).toBeNull();
    expect(screen.queryByText("Runtime bootstrap failed")).toBeNull();
  });
});
