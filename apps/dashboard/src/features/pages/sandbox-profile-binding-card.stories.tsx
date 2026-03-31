import type { Meta, StoryObj } from "@storybook/react-vite";

import { withDashboardPageWidth } from "../../storybook/decorators.js";
import { SandboxIntegrationBindingKinds } from "../sandbox-profiles/sandbox-profiles-types.js";
import { SandboxProfileBindingCard } from "./sandbox-profile-binding-card.js";
import type {
  IntegrationConnectionSummary,
  IntegrationTargetSummary,
  SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";

const AvailableConnections: readonly IntegrationConnectionSummary[] = [
  {
    id: "icn_story_github",
    displayName: "GitHub Production",
    targetKey: "github",
    status: "active",
  },
] as const;

const AvailableTargets: readonly IntegrationTargetSummary[] = [
  {
    targetKey: "github",
    displayName: "GitHub",
    logoKey: "github",
    familyId: "github",
    variantId: "default",
    config: {},
    targetHealth: {
      configStatus: "valid",
    },
  },
] as const;

const Row: SandboxProfileBindingEditorRow = {
  clientId: "binding_row_story_001",
  connectionId: "icn_story_github",
  kind: SandboxIntegrationBindingKinds.CONNECTOR,
  config: {},
};

const meta = {
  title: "Dashboard/Pages/SandboxProfileBindingCard",
  component: SandboxProfileBindingCard,
  decorators: [withDashboardPageWidth],
  args: {
    availableConnections: AvailableConnections,
    availableTargets: AvailableTargets,
    onEdit: () => {},
    onRemove: () => {},
    row: Row,
  },
} satisfies Meta<typeof SandboxProfileBindingCard>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithError: Story = {
  args: {
    errorMessage: "This binding references an unsupported connection configuration.",
  },
};
