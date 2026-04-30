import {
  Button,
  Field,
  FieldContent,
  FieldDescription,
  FieldHeader,
  FieldLabel,
  InlineCode,
  Switch,
} from "@mistle/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import { FormPageSection, FormPageStack } from "../shared/form-page.js";
import { PageFrame } from "../shared/page-frame.js";
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
    <PageFrame
      width="form"
      description="Configure the instructions sent to the agent for each webhook event."
      title="Automation Editor"
    >
      <FormPageStack>
        <FormPageSection>
          <div className="p-4">
            <Field>
              <FieldHeader>
                <div className="space-y-1">
                  <FieldLabel id="story-agent-instructions-label">Message Template</FieldLabel>
                  <FieldDescription>
                    <span className="block">
                      These are the instructions the agent will receive.
                    </span>
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
        </FormPageSection>
      </FormPageStack>
    </PageFrame>
  );
}

function PlaygroundHarness(): React.JSX.Element {
  const [value, setValue] = useState("");
  const [includeIssueComment, setIncludeIssueComment] = useState(true);
  const [includePullRequest, setIncludePullRequest] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const [disabled, setDisabled] = useState(false);

  const selectedEventOptions = [
    ...(includeIssueComment ? [createGithubIssueCommentCreatedEventOption()] : []),
    ...(includePullRequest ? [createGithubPullRequestOpenedEventOption()] : []),
  ];
  const tokens = buildAgentInstructionTokenCatalog({
    selectedEventOptions,
  });

  return (
    <PageFrame
      width="form"
      description="Preview the editor inside the automation form page shell."
      title="Automation Editor"
    >
      <FormPageStack>
        <FormPageSection header={<h2 className="text-base font-semibold">Story Controls</h2>}>
          <div className="flex flex-wrap items-center gap-4 p-4">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                aria-label="Issue comment trigger enabled"
                checked={includeIssueComment}
                onCheckedChange={setIncludeIssueComment}
              />
              Issue comment trigger
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                aria-label="Pull request trigger enabled"
                checked={includePullRequest}
                onCheckedChange={setIncludePullRequest}
              />
              Pull request trigger
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                aria-label="Invalid state enabled"
                checked={invalid}
                onCheckedChange={setInvalid}
              />
              Invalid state
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                aria-label="Disabled state enabled"
                checked={disabled}
                onCheckedChange={setDisabled}
              />
              Disabled state
            </label>
            <Button
              onClick={() => {
                setValue("");
              }}
              type="button"
              variant="outline"
            >
              Reset text
            </Button>
          </div>
        </FormPageSection>

        <FormPageSection>
          <div className="p-4">
            <Field>
              <FieldHeader>
                <div className="space-y-1">
                  <FieldLabel id="playground-agent-instructions-label">Message Template</FieldLabel>
                  <FieldDescription>
                    <span className="block">
                      Type inside the editor as if this were the real form.
                    </span>
                    <span className="block">
                      Start with <InlineCode variant="muted">{"{{"}</InlineCode> to inspect
                      completions.
                    </span>
                  </FieldDescription>
                </div>
              </FieldHeader>
              <FieldContent>
                <AgentInstructionsEditor
                  ariaLabelledBy="playground-agent-instructions-label"
                  disabled={disabled}
                  invalid={invalid}
                  onChange={setValue}
                  tokens={tokens}
                  value={value}
                />
                {selectedEventOptions.length === 0 ? (
                  <p className="text-muted-foreground mt-2 text-sm">
                    {AgentInstructionsNoTriggerHelpText}
                  </p>
                ) : null}
                {invalid ? (
                  <p className="text-destructive text-sm">Input template is required.</p>
                ) : null}
              </FieldContent>
            </Field>
          </div>
        </FormPageSection>
      </FormPageStack>
    </PageFrame>
  );
}

const meta = {
  title: "Dashboard/Automations/AgentInstructionsEditor",
  component: StoryHarness,
  decorators: [withDashboardPageStory],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof StoryHarness>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: {
    value: "",
  },
  render: function RenderStory(): React.JSX.Element {
    return <PlaygroundHarness />;
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
    value: ["Event type: {{webhookEvent.eventType}}", "Payload: {{payload}}"].join("\n"),
    withSelectedTriggers: true,
  },
};

export const Highlighting: Story = {
  args: {
    value: [
      "Recognized tokens should show the valid color:",
      "{{payload.comment.body}}",
      "{{webhookEvent.eventType}}",
      "",
      "Unknown complete tokens should show the error color:",
      "{{payload.not_real}}",
      "{{webhookEvent.notARealField}}",
    ].join("\n"),
    withSelectedTriggers: true,
  },
};
