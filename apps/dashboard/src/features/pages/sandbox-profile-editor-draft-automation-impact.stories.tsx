import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageStory } from "../../storybook/decorators.js";
import type {
  SandboxProfileVersionDraftAutomationImpactAutomation,
  SandboxProfileVersionDraftAutomationImpactIssue,
} from "../sandbox-profiles/sandbox-profiles-types.js";
import {
  DefaultSandboxProfileEditorStoryArgs,
  SandboxProfileEditorPageStory,
} from "./sandbox-profile-editor-story-support.js";

const meta = {
  title: "Dashboard/SandboxProfiles/Editor/Draft Automation Impact",
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

function createDraftAutomationImpactAutomations(
  automationNames: readonly string[],
  issueCode: SandboxProfileVersionDraftAutomationImpactIssue["code"],
): readonly SandboxProfileVersionDraftAutomationImpactAutomation[] {
  return automationNames.map((automationName, index) => ({
    enabled: true,
    id: `automation_${String(index + 1)}`,
    kind: index % 2 === 0 ? "webhook" : "schedule",
    issues: [
      {
        code: issueCode,
        message: issueCode,
      },
    ],
    name: automationName,
  }));
}

export const NoBreakingChanges: Story = {};

export const AgentBindingRequired: Story = {
  name: "No Agent Binding",
  args: {
    draftAutomationImpactAffectedAutomations: createDraftAutomationImpactAutomations(
      ["Repository triage"],
      "AGENT_BINDING_REQUIRED",
    ),
  },
};

export const AgentBindingAmbiguous: Story = {
  name: "Duplicate Agent Provider Bindings",
  args: {
    draftAutomationImpactAffectedAutomations: createDraftAutomationImpactAutomations(
      ["Support escalation"],
      "AGENT_BINDING_AMBIGUOUS",
    ),
  },
};

export const AgentBindingPrimaryRequired: Story = {
  name: "Primary Agent Provider Required",
  args: {
    draftAutomationImpactAffectedAutomations: createDraftAutomationImpactAutomations(
      ["Support escalation"],
      "AGENT_BINDING_PRIMARY_REQUIRED",
    ),
  },
};

export const AgentBindingRuntimeIncompatible: Story = {
  name: "Agent Binding Runtime Incompatible",
  args: {
    draftAutomationImpactAffectedAutomations: createDraftAutomationImpactAutomations(
      ["Support escalation"],
      "AGENT_BINDING_RUNTIME_INCOMPATIBLE",
    ),
  },
};

export const AgentConnectionMissing: Story = {
  name: "Agent Connection Missing",
  args: {
    draftAutomationImpactAffectedAutomations: createDraftAutomationImpactAutomations(
      ["Incident response"],
      "INVALID_BINDING_CONNECTION_REFERENCE",
    ),
  },
};

export const AgentConnectionInactive: Story = {
  name: "Agent Connection Inactive",
  args: {
    draftAutomationImpactAffectedAutomations: createDraftAutomationImpactAutomations(
      ["SLA audit"],
      "CONNECTION_NOT_ACTIVE",
    ),
  },
};

export const AgentTargetDisabled: Story = {
  name: "Agent Target Disabled",
  args: {
    draftAutomationImpactAffectedAutomations: createDraftAutomationImpactAutomations(
      ["Account review"],
      "TARGET_DISABLED",
    ),
  },
};

export const AgentTargetMissing: Story = {
  name: "Agent Target Missing",
  args: {
    draftAutomationImpactAffectedAutomations: createDraftAutomationImpactAutomations(
      ["Customer handoff"],
      "TARGET_MISSING",
    ),
  },
};

export const WebhookSourceConnectionNotBound: Story = {
  name: "Webhook Source Not Bound",
  args: {
    draftAutomationImpactAffectedAutomations: createDraftAutomationImpactAutomations(
      ["GitHub issue triage"],
      "WEBHOOK_SOURCE_CONNECTION_NOT_BOUND",
    ),
  },
};

export const PrimaryRepositoryUnavailable: Story = {
  name: "Primary Repository Unavailable",
  args: {
    draftAutomationImpactAffectedAutomations: createDraftAutomationImpactAutomations(
      ["Weekly repository summary"],
      "PRIMARY_REPOSITORY_UNAVAILABLE",
    ),
  },
};

export const MultipleAutomationsAffected: Story = {
  args: {
    draftAutomationImpactAffectedAutomations: createDraftAutomationImpactAutomations(
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
    draftAutomationImpactError: "Couldn't check whether this draft affects related automations.",
  },
};
