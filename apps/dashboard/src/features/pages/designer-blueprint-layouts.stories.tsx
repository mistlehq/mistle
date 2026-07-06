import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { MemoryRouter } from "react-router";

import type { DesignerBlueprintDocument } from "../designer/designer-blueprint-schema.js";
import { DesignerBlueprintCanvasPanel } from "./designer-session-page-view.js";

const AiSoftwareFactoryBlueprint = {
  version: 1,
  title: "AI Software Factory Draft",
  outcome: {
    label: "Issue-to-PR software factory",
    description:
      "Move well-defined software work from an issue system into implementation, pull request review, rework, and process improvement with agent assistance.",
  },
  items: [
    {
      id: "issue-ready",
      kind: "trigger",
      state: "proposed",
      when: [
        {
          label: "Readiness signal received",
        },
        {
          label: "Acceptance criteria are present",
        },
      ],
    },
    {
      id: "readiness-check",
      kind: "agent_step",
      label: "Check readiness and scope",
      description:
        "Verify acceptance criteria, affected area, blockers, and repository target before implementation starts.",
      state: "proposed",
    },
    {
      id: "implement-change",
      kind: "agent_step",
      label: "Plan, edit, and test",
      description:
        "Create an implementation plan, change the code, and run the relevant checks before producing reviewable work.",
      state: "proposed",
    },
    {
      id: "pr-output",
      kind: "workflow_output",
      label: "Pull request opened or updated",
      description:
        "Produce a pull request with implementation notes, test evidence, and issue linkage.",
      state: "proposed",
    },
    {
      id: "review-step",
      kind: "agent_step",
      label: "Review change quality",
      description:
        "A separate review agent or human reviewer checks acceptance criteria, regressions, tests, and maintainability.",
      state: "proposed",
    },
    {
      id: "review-route",
      kind: "routing_policy",
      state: "proposed",
      rules: [
        {
          conditionLabel: "Changes requested",
          when: [
            {
              field: "review_outcome",
              operator: "equals",
              value: "changes_requested",
            },
          ],
          routeTo: "implement-change",
        },
        {
          conditionLabel: "Accepted",
          when: [
            {
              field: "review_outcome",
              operator: "equals",
              value: "accepted",
            },
          ],
          routeTo: "issue-update",
        },
        {
          conditionLabel: "Blocked or unclear",
          when: [
            {
              field: "review_outcome",
              operator: "equals",
              value: "blocked",
            },
          ],
          routeTo: "issue-update",
        },
      ],
    },
    {
      id: "issue-update",
      kind: "agent_step",
      label: "Update issue status",
      description:
        "Record PR links, review state, blockers, rework needs, or completion in the issue system.",
      state: "proposed",
    },
    {
      id: "improvement-output",
      kind: "workflow_output",
      label: "Factory improvement notes",
      description:
        "Capture repeated blockers, missing issue fields, weak tests, or recurring review feedback for later instruction and process updates.",
      state: "proposed",
    },
  ],
  links: [
    {
      from: "issue-ready",
      to: "readiness-check",
      kind: "triggers",
    },
    {
      from: "readiness-check",
      to: "implement-change",
      kind: "hands_off_to",
    },
    {
      from: "implement-change",
      to: "pr-output",
      kind: "produces",
    },
    {
      from: "pr-output",
      to: "review-step",
      kind: "triggers",
    },
    {
      from: "review-step",
      to: "review-route",
      kind: "routes_to",
    },
    {
      from: "review-route",
      to: "implement-change",
      kind: "routes_to",
    },
    {
      from: "review-route",
      to: "issue-update",
      kind: "routes_to",
    },
    {
      from: "issue-update",
      to: "improvement-output",
      kind: "produces",
    },
  ],
  actions: [],
} satisfies DesignerBlueprintDocument;

const SlackBugTriageMissingDetailsBlueprint = {
  version: 1,
  title: "Slack Bug Triage Workflow",
  outcome: {
    label: "Triage bug reports from Slack",
    description:
      "Turn Slack bug reports into classified, actionable triage with the right follow-up path.",
  },
  items: [
    {
      id: "slack_bug_intake",
      kind: "trigger",
      integrationTargetKey: "slack-default",
      state: "proposed",
      when: [
        {
          label: "Bug report posted or app mentioned in Slack",
        },
      ],
    },
    {
      id: "collect_context",
      kind: "agent_step",
      label: "Collect report context",
      description:
        "Read the Slack message and thread, extract product area, expected behavior, actual behavior, reproduction steps, screenshots or links, affected users, impact, and urgency.",
      state: "proposed",
    },
    {
      id: "ask_for_missing_details",
      kind: "agent_step",
      label: "Ask for missing details",
      description:
        "Reply in the Slack thread with concise questions only when the report is not actionable.",
      state: "proposed",
    },
    {
      id: "classify_bug",
      kind: "agent_step",
      label: "Classify and prioritize",
      description:
        "Assign severity, affected area, likely owner or team, duplicate risk, confidence, and recommended next action.",
      state: "proposed",
    },
    {
      id: "triage_route",
      kind: "routing_policy",
      state: "proposed",
      rules: [
        {
          conditionLabel: "Actionable report",
          when: [
            {
              field: "report_actionability",
              operator: "equals",
              value: "actionable",
            },
          ],
          routeTo: "post_triage_summary",
        },
        {
          conditionLabel: "Missing required details",
          when: [
            {
              field: "report_actionability",
              operator: "equals",
              value: "needs_details",
            },
          ],
          routeTo: "ask_for_missing_details",
        },
        {
          conditionLabel: "Critical customer or production impact",
          when: [
            {
              field: "severity",
              operator: "in",
              value: ["sev0", "sev1"],
            },
          ],
          routeTo: "escalate_critical",
        },
      ],
    },
    {
      id: "post_triage_summary",
      kind: "workflow_output",
      label: "Slack triage summary",
      description:
        "Post a structured Slack thread reply with severity, owner recommendation, reproduction summary, evidence, open questions, and next action.",
      state: "proposed",
    },
    {
      id: "escalate_critical",
      kind: "workflow_output",
      label: "Critical escalation",
      description:
        "Notify the selected escalation channel or user group with the evidence and recommended owner.",
      state: "proposed",
    },
  ],
  links: [
    {
      from: "slack_bug_intake",
      to: "collect_context",
      kind: "triggers",
    },
    {
      from: "collect_context",
      to: "classify_bug",
      kind: "requires",
    },
    {
      from: "classify_bug",
      to: "triage_route",
      kind: "requires",
    },
    {
      from: "triage_route",
      to: "post_triage_summary",
      kind: "routes_to",
    },
    {
      from: "triage_route",
      to: "ask_for_missing_details",
      kind: "routes_to",
    },
    {
      from: "triage_route",
      to: "escalate_critical",
      kind: "routes_to",
    },
    {
      from: "ask_for_missing_details",
      to: "collect_context",
      kind: "requires",
    },
  ],
  actions: [],
} satisfies DesignerBlueprintDocument;

function BlueprintLayoutStory(input: {
  blueprint: DesignerBlueprintDocument;
  title: string;
}): React.JSX.Element {
  return (
    <DesignerBlueprintLayoutRuntime>
      <section className="flex h-screen min-h-0 flex-col overflow-hidden bg-background">
        <div className="flex h-10 flex-none items-center border-b bg-background px-3 text-sm font-medium">
          {input.title}
        </div>
        <div className="min-h-0 flex-1">
          <DesignerBlueprintCanvasPanel
            blueprint={input.blueprint}
            onAddComment={function onAddComment() {}}
            onDeleteComment={function onDeleteComment() {}}
            onUpdateComment={function onUpdateComment() {}}
            pendingComments={[]}
          />
        </div>
      </section>
    </DesignerBlueprintLayoutRuntime>
  );
}

function DesignerBlueprintLayoutRuntime(input: { children: React.ReactNode }): React.JSX.Element {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{input.children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const meta = {
  title: "Dashboard/Designer/Blueprint Layouts",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const AiSoftwareFactory: Story = {
  render: function RenderAiSoftwareFactoryStory(): React.JSX.Element {
    return (
      <BlueprintLayoutStory
        blueprint={AiSoftwareFactoryBlueprint}
        title="AI software factory blueprint"
      />
    );
  },
};

export const SlackBugTriageMissingDetails: Story = {
  render: function RenderSlackBugTriageMissingDetailsStory(): React.JSX.Element {
    return (
      <BlueprintLayoutStory
        blueprint={SlackBugTriageMissingDetailsBlueprint}
        title="Slack bug triage missing-details blueprint"
      />
    );
  },
};
