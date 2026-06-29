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
  buildAgentInstructionsResourceReferences,
  buildAgentInstructionTokenCatalog,
} from "./agent-instructions-token-catalog.js";
import {
  createGithubIssueCommentCreatedEventOption,
  createGithubPullRequestOpenedEventOption,
} from "./webhook-trigger-test-fixtures.js";

type StoryHarnessProps = {
  disabled?: boolean;
  invalid?: boolean;
  showNoTriggerCopy?: boolean;
  value: string;
  withSelectedTriggers?: boolean;
};

const StoryResourceReferences = buildAgentInstructionsResourceReferences({
  providerLabel: "Slack",
  resources: [
    {
      id: "rsc_story_slack_jonathan",
      displayName: "Jonathan",
      handle: "jonathan",
      externalId: "U12039",
      kind: "user",
    },
    {
      id: "rsc_story_slack_charmaine",
      displayName: "Charmaine",
      handle: "charmaine",
      externalId: "U45012",
      kind: "user",
    },
    {
      id: "rsc_story_slack_alerts",
      displayName: "alerts",
      handle: "alerts",
      externalId: "C_ALERTS_001",
      kind: "channel",
    },
    {
      id: "rsc_story_slack_engineering",
      displayName: "engineering",
      handle: "eng",
      externalId: "C_ENG_001",
      kind: "channel",
    },
  ],
});

function StoryHarness(input: StoryHarnessProps): React.JSX.Element {
  const [value, setValue] = useState(input.value);
  const isUserMessage = input.withSelectedTriggers === true;
  const fieldLabel = isUserMessage ? "User message" : "Agent Instructions for Trigger";
  const tokens = buildAgentInstructionTokenCatalog({
    selectedEventOptions: input.withSelectedTriggers
      ? [createGithubIssueCommentCreatedEventOption(), createGithubPullRequestOpenedEventOption()]
      : [],
  });

  return (
    <PageFrame
      width="form"
      description="Configure the instructions sent to the agent for each webhook event."
      title="Trigger Editor"
    >
      <FormPageStack>
        <FormPageSection>
          <div className="p-4">
            <Field>
              <FieldHeader>
                <div className="space-y-1">
                  <FieldLabel id="story-agent-instructions-label">{fieldLabel}</FieldLabel>
                  <FieldDescription>
                    {isUserMessage ? (
                      <>
                        <span className="block">
                          Sent to the agent each time this trigger runs.
                        </span>
                        <span className="block">
                          Use <InlineCode variant="muted">{"{{ ... }}"}</InlineCode> to insert event
                          fields, or <InlineCode variant="muted">@</InlineCode> to insert resources.
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="block">
                          Appended to the developer message when this trigger runs.
                        </span>
                        <span className="block">
                          Use <InlineCode variant="muted">@</InlineCode> to insert resources.
                        </span>
                      </>
                    )}
                  </FieldDescription>
                </div>
              </FieldHeader>
              <FieldContent>
                <AgentInstructionsEditor
                  ariaLabelledBy="story-agent-instructions-label"
                  disabled={input.disabled ?? false}
                  invalid={input.invalid ?? false}
                  onChange={setValue}
                  resourceReferences={StoryResourceReferences}
                  tokens={tokens}
                  value={value}
                />
                {input.showNoTriggerCopy ? (
                  <p className="text-muted-foreground mt-2 text-sm">
                    {AgentInstructionsNoTriggerHelpText}
                  </p>
                ) : null}
                {input.invalid ? (
                  <p className="text-destructive text-sm">{fieldLabel} is required.</p>
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
      description="Preview the editor inside the trigger form page shell."
      title="Trigger Editor"
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
                  <FieldLabel id="playground-agent-instructions-label">User message</FieldLabel>
                  <FieldDescription>
                    <span className="block">
                      Type inside the user message editor as if this were the real form.
                    </span>
                    <span className="block">
                      Start with <InlineCode variant="muted">{"{{"}</InlineCode> to inspect event
                      field completions, or <InlineCode variant="muted">@</InlineCode> to insert
                      resources.
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
                  resourceReferences={StoryResourceReferences}
                  tokens={tokens}
                  value={value}
                />
                {selectedEventOptions.length === 0 ? (
                  <p className="text-muted-foreground mt-2 text-sm">
                    {AgentInstructionsNoTriggerHelpText}
                  </p>
                ) : null}
                {invalid ? (
                  <p className="text-destructive text-sm">User message is required.</p>
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
  title: "Dashboard/Triggers/AgentInstructionsEditor",
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

export const ResourceReferences: Story = {
  args: {
    value: [
      "When this fires, ask @",
      "",
      "Try typing after the @ sign. Suggestions search display name, handle, and provider ID.",
    ].join("\n"),
  },
};
