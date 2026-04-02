import {
  Field,
  FieldContent,
  FieldDescription,
  FieldHeader,
  FieldLabel,
  InlineCode,
} from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { withDashboardPageWidth } from "../../storybook/decorators.js";
import { AgentInstructionsEditor } from "./agent-instructions-editor.js";
import {
  AgentInstructionsNoTriggerHelpText,
  buildAgentInstructionTokenCatalog,
} from "./agent-instructions-token-catalog.js";
import {
  createGithubIssueCommentCreatedEventOption,
  createGithubPullRequestOpenedEventOption,
} from "./webhook-automation-test-fixtures.js";

type StoryHarnessProps = {
  disabled?: boolean;
  invalid?: boolean;
  showNoTriggerCopy?: boolean;
  value: string;
  withSelectedTriggers?: boolean;
};

function StoryHarness(input: StoryHarnessProps): React.JSX.Element {
  const [value, setValue] = useState(input.value);
  const tokens = buildAgentInstructionTokenCatalog({
    selectedEventOptions: input.withSelectedTriggers
      ? [createGithubIssueCommentCreatedEventOption(), createGithubPullRequestOpenedEventOption()]
      : [],
  });

  return (
    <div className="rounded border bg-white p-4">
      <Field>
        <FieldHeader>
          <div className="space-y-1">
            <FieldLabel id="story-agent-instructions-label">Agent Instructions</FieldLabel>
            <FieldDescription>
              <span className="block">These are the instructions the agent will receive.</span>
              <span className="block">
                Use Liquid syntax with{" "}
                <InlineCode variant="muted">{"{{webhookEvent.eventType}}"}</InlineCode> and{" "}
                <InlineCode variant="muted">{"{{payload}}"}</InlineCode>.
              </span>
            </FieldDescription>
          </div>
        </FieldHeader>
        <FieldContent>
          <AgentInstructionsEditor
            ariaLabelledBy="story-agent-instructions-label"
            disabled={input.disabled ?? false}
            invalid={input.invalid ?? false}
            onChange={setValue}
            tokens={tokens}
            value={value}
          />
          {input.showNoTriggerCopy ? (
            <p className="text-muted-foreground mt-2 text-sm">
              {AgentInstructionsNoTriggerHelpText}
            </p>
          ) : null}
          {input.invalid ? (
            <p className="text-destructive text-sm">Input template is required.</p>
          ) : null}
        </FieldContent>
      </Field>
    </div>
  );
}

const meta = {
  title: "Dashboard/Automations/AgentInstructionsEditor",
  component: StoryHarness,
  decorators: [withDashboardPageWidth],
} satisfies Meta<typeof StoryHarness>;

export default meta;

type Story = StoryObj<typeof meta>;

export const WithSelectedTriggers: Story = {
  args: {
    value: [
      "Review the webhook event and decide what action to take.",
      "",
      "Event type: {{webhookEvent.eventType}}",
      "Comment: {{payload.comment.body}}",
      "Author: {{payload.sender.login}}",
    ].join("\n"),
    withSelectedTriggers: true,
  },
};

export const NoTriggerSelected: Story = {
  args: {
    value: [
      "Review the webhook event and decide what action to take.",
      "",
      "Event type: {{webhookEvent.eventType}}",
      "Payload: {{payload}}",
    ].join("\n"),
    showNoTriggerCopy: true,
    withSelectedTriggers: false,
  },
};

export const Invalid: Story = {
  args: {
    invalid: true,
    value: "",
    withSelectedTriggers: true,
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
    value: [
      "Review the webhook event and decide what action to take.",
      "",
      "Event type: {{webhookEvent.eventType}}",
      "Payload: {{payload}}",
    ].join("\n"),
    withSelectedTriggers: true,
  },
};
