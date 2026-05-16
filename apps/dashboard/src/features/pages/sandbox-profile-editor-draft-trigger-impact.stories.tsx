import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import type {
  SandboxProfileVersionDraftTriggerImpactTrigger,
  SandboxProfileVersionDraftTriggerImpactIssue,
} from "../sandbox-profiles/sandbox-profiles-types.js";
import {
  DefaultSandboxProfileEditorStoryArgs,
  SandboxProfileEditorPageStory,
} from "./sandbox-profile-editor-story-support.js";

const meta = {
  title: "Dashboard/SandboxProfiles/Editor/Draft Trigger Impact",
  component: SandboxProfileEditorPageStory,
  decorators: [withDashboardPageStory],
  parameters: {
    layout: "fullscreen",
  },
  render: function RenderStory(args): React.JSX.Element {
    return <SandboxProfileEditorPageStory {...args} />;
  },
  args: {
    ...DefaultSandboxProfileEditorStoryArgs,
    lifecycleState: "draft-with-published",
  },
} satisfies Meta<typeof SandboxProfileEditorPageStory>;

export default meta;

type Story = StoryObj<typeof meta>;

function createDraftTriggerImpactTriggers(
  triggerNames: readonly string[],
  issueCode: SandboxProfileVersionDraftTriggerImpactIssue["code"],
): readonly SandboxProfileVersionDraftTriggerImpactTrigger[] {
  return triggerNames.map((triggerName, index) => ({
    enabled: true,
    id: `trigger_${String(index + 1)}`,
    kind: index % 2 === 0 ? "webhook" : "schedule",
    issues: [
      {
        code: issueCode,
        message: issueCode,
      },
    ],
    name: triggerName,
  }));
}

export const NoBreakingChanges: Story = {};

export const AgentBindingRequired: Story = {
  name: "No Agent Binding",
  args: {
    draftTriggerImpactAffectedTriggers: createDraftTriggerImpactTriggers(
      ["Repository triage"],
      "AGENT_BINDING_REQUIRED",
    ),
  },
};

export const AgentBindingAmbiguous: Story = {
  name: "Duplicate Agent Provider Bindings",
  args: {
    draftTriggerImpactAffectedTriggers: createDraftTriggerImpactTriggers(
      ["Support escalation"],
      "AGENT_BINDING_AMBIGUOUS",
    ),
  },
};

export const AgentBindingPrimaryRequired: Story = {
  name: "Primary Agent Provider Required",
  args: {
    draftTriggerImpactAffectedTriggers: createDraftTriggerImpactTriggers(
      ["Support escalation"],
      "AGENT_BINDING_PRIMARY_REQUIRED",
    ),
  },
};

export const AgentBindingRuntimeIncompatible: Story = {
  name: "Agent Binding Runtime Incompatible",
  args: {
    draftTriggerImpactAffectedTriggers: createDraftTriggerImpactTriggers(
      ["Support escalation"],
      "AGENT_BINDING_RUNTIME_INCOMPATIBLE",
    ),
  },
};

export const AgentConnectionMissing: Story = {
  name: "Agent Connection Missing",
  args: {
    draftTriggerImpactAffectedTriggers: createDraftTriggerImpactTriggers(
      ["Incident response"],
      "INVALID_BINDING_CONNECTION_REFERENCE",
    ),
  },
};

export const AgentConnectionInactive: Story = {
  name: "Agent Connection Inactive",
  args: {
    draftTriggerImpactAffectedTriggers: createDraftTriggerImpactTriggers(
      ["SLA audit"],
      "CONNECTION_NOT_ACTIVE",
    ),
  },
};

export const AgentTargetDisabled: Story = {
  name: "Agent Target Disabled",
  args: {
    draftTriggerImpactAffectedTriggers: createDraftTriggerImpactTriggers(
      ["Account review"],
      "TARGET_DISABLED",
    ),
  },
};

export const AgentTargetMissing: Story = {
  name: "Agent Target Missing",
  args: {
    draftTriggerImpactAffectedTriggers: createDraftTriggerImpactTriggers(
      ["Customer handoff"],
      "TARGET_MISSING",
    ),
  },
};

export const WebhookSourceConnectionNotBound: Story = {
  name: "Webhook Source Not Bound",
  args: {
    draftTriggerImpactAffectedTriggers: createDraftTriggerImpactTriggers(
      ["GitHub issue triage"],
      "WEBHOOK_SOURCE_CONNECTION_NOT_BOUND",
    ),
  },
};

export const PrimaryRepositoryUnavailable: Story = {
  name: "Primary Repository Unavailable",
  args: {
    draftTriggerImpactAffectedTriggers: createDraftTriggerImpactTriggers(
      ["Weekly repository summary"],
      "PRIMARY_REPOSITORY_UNAVAILABLE",
    ),
  },
};

export const MultipleTriggersAffected: Story = {
  args: {
    draftTriggerImpactAffectedTriggers: createDraftTriggerImpactTriggers(
      [
        "Repository triage",
        "Release notes",
        "Incident response",
        "Support escalation",
        "Weekly repository summary",
      ],
      "WEBHOOK_SOURCE_CONNECTION_NOT_BOUND",
    ),
  },
};

export const ImpactCheckFailed: Story = {
  args: {
    draftTriggerImpactError: "Couldn't check whether this draft affects related triggers.",
  },
};
