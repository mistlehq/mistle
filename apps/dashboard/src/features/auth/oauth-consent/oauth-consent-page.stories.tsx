import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import {
  withDashboardMemoryRouter,
  withDashboardPageStory,
} from "../../../storybook/decorators.js";
import { OAuthConsentPageView } from "./oauth-consent-page.js";

const Organizations = [
  {
    id: "org_mistle",
    name: "Mistle Engineering",
    role: "admin",
    isCurrent: true,
  },
  {
    id: "org_support",
    name: "Support Sandbox",
    role: "member",
    isCurrent: false,
  },
  {
    id: "org_readonly",
    name: "Read-only Audit",
    role: "member",
    isCurrent: false,
  },
] as const;

const RequestedScopes = [
  "sandboxProfile:read",
  "sandboxProfile:update",
  "sandboxSession:create",
  "sandboxSession:read",
  "sandboxSession:connect",
];

const meta = {
  title: "Dashboard/Auth/OAuthConsentFlow",
  component: OAuthConsentStory,
  decorators: [withDashboardPageStory, withDashboardMemoryRouter],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof OAuthConsentStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const OrgAndScopeSelection: Story = {};

export const OrgChangeRestartRequired: Story = {
  args: {
    initialOrganizationId: "org_support",
  },
};

function OAuthConsentStory(input: { initialOrganizationId?: string }): React.JSX.Element {
  const currentOrganization = Organizations.find((organization) => organization.isCurrent);
  if (currentOrganization === undefined) {
    throw new Error("OAuth consent story requires a current organization.");
  }

  const [selectedOrganizationId, setSelectedOrganizationId] = useState(
    input.initialOrganizationId ?? currentOrganization.id,
  );
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(() => new Set(RequestedScopes));
  const [submissionState, setSubmissionState] = useState<
    "editing" | "approving" | "denying" | "switchingOrganization"
  >("editing");
  const organizationChanged = selectedOrganizationId !== currentOrganization.id;
  const hasSubmitted = submissionState !== "editing";

  return (
    <OAuthConsentPageView
      approveErrorMessage={null}
      clientName="Codex"
      denyErrorMessage={null}
      isSubmitting={hasSubmitted}
      onApprove={() => {
        setSubmissionState("approving");
      }}
      onContinueWithSelectedOrganization={() => {
        setSubmissionState("switchingOrganization");
      }}
      onDeny={() => {
        setSubmissionState("denying");
      }}
      onSelectedOrganizationChange={(organizationId) => {
        setSelectedOrganizationId(organizationId);
        setSubmissionState("editing");
      }}
      onSelectedScopesChange={(scopes) => {
        setSelectedScopes(scopes);
        setSubmissionState("editing");
      }}
      organizationChanged={organizationChanged}
      organizationErrorMessage={null}
      organizationName={currentOrganization.name}
      organizations={Organizations}
      requestedScopes={RequestedScopes}
      selectedOrganizationId={selectedOrganizationId}
      selectedScopes={selectedScopes}
      submissionState={submissionState}
    />
  );
}
