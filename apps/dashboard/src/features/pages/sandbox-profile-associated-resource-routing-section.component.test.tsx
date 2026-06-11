// @vitest-environment jsdom

import { AssociatedResourceEventTypes } from "@mistle/integrations-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { SandboxProfileVersion } from "../sandbox-profiles/sandbox-profiles-types.js";
import {
  SandboxProfileAssociatedResourceRoutingSection,
  type SandboxProfileAssociatedResourceRoutingDraftState,
} from "./sandbox-profile-associated-resource-routing-section.js";
import type {
  IntegrationConnectionSummary,
  IntegrationTargetSummary,
  SandboxProfileBindingEditorRow,
} from "./sandbox-profile-binding-config-editor.js";

afterEach(() => {
  cleanup();
});

describe("SandboxProfileAssociatedResourceRoutingSection", () => {
  it("shows default GitHub pull request routing when the profile has a GitHub binding", () => {
    renderSection();

    expect(
      screen.getByRole("switch", { name: "GitHub PR routing" }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.getByRole("checkbox", { name: "PR comments" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getByRole("checkbox", { name: "PR reviews" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(
      screen.getByRole("checkbox", { name: "Review comments" }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.getByText("Delivered message preview")).toBeDefined();
  });

  it("builds an explicit disabled config when GitHub PR routing is turned off", () => {
    const draftStates: SandboxProfileAssociatedResourceRoutingDraftState[] = [];
    renderSection({
      onDraftStateChange: (state) => {
        draftStates.push(state);
      },
    });

    fireEvent.click(screen.getByRole("switch", { name: "GitHub PR routing" }));

    const latestDraftState = draftStates.at(-1);
    if (latestDraftState === undefined || latestDraftState.buildDraftChanges === undefined) {
      throw new Error("Expected associated resource routing draft state.");
    }

    expect(latestDraftState.hasUnpersistedChanges).toBe(true);
    expect(latestDraftState.buildDraftChanges()).toEqual({
      enabled: false,
      resources: [],
    });
  });

  it("builds selected GitHub pull request event types", () => {
    const draftStates: SandboxProfileAssociatedResourceRoutingDraftState[] = [];
    renderSection({
      onDraftStateChange: (state) => {
        draftStates.push(state);
      },
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "Review comments" }));

    const latestDraftState = draftStates.at(-1);
    if (latestDraftState === undefined || latestDraftState.buildDraftChanges === undefined) {
      throw new Error("Expected associated resource routing draft state.");
    }

    expect(latestDraftState.buildDraftChanges()).toEqual({
      enabled: true,
      resources: [
        {
          resourceKind: "github.pull_request",
          eventTypes: [
            AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_ISSUE_COMMENT_CREATED,
            AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_REVIEW_SUBMITTED,
          ],
        },
      ],
    });
  });

  it("publishes a clean parent draft state after applying a saved config", () => {
    const draftStates: SandboxProfileAssociatedResourceRoutingDraftState[] = [];
    renderSection({
      onDraftStateChange: (state) => {
        draftStates.push(state);
      },
    });

    fireEvent.click(screen.getByRole("switch", { name: "GitHub PR routing" }));
    const dirtyDraftState = draftStates.at(-1);
    if (
      dirtyDraftState === undefined ||
      dirtyDraftState.applySavedAssociatedResourceEventRoutingConfig === undefined
    ) {
      throw new Error("Expected dirty associated resource routing draft state.");
    }

    dirtyDraftState.applySavedAssociatedResourceEventRoutingConfig({
      enabled: false,
      resources: [],
    });

    const cleanDraftState = draftStates.at(-1);
    if (cleanDraftState === undefined) {
      throw new Error("Expected clean associated resource routing draft state.");
    }

    expect(cleanDraftState.hasUnpersistedChanges).toBe(false);
  });
});

function renderSection(input?: {
  onDraftStateChange?: (state: SandboxProfileAssociatedResourceRoutingDraftState) => void;
}) {
  return render(
    <SandboxProfileAssociatedResourceRoutingSection
      availableConnections={AvailableConnections}
      availableTargets={AvailableTargets}
      disabled={false}
      integrationRows={IntegrationRows}
      isDraft
      {...(input?.onDraftStateChange === undefined
        ? {}
        : { onDraftStateChange: input.onDraftStateChange })}
      version={createVersion()}
    />,
  );
}

function createVersion(): SandboxProfileVersion {
  return {
    sandboxProfileId: "sbp_associated_resource_routing",
    version: 1,
    state: "draft",
    publishedAt: null,
    agentRuntimeId: "codex",
    gitCommitSigningIntegrationConnectionId: null,
    mistleMcpEnabled: false,
    mistleMcpApiKeyId: null,
    sandboxProvider: "docker",
    sandboxConnectionId: null,
    maintenanceScript: null,
    sandboxResources: null,
    skillsConfig: null,
    associatedResourceEventRoutingConfig: {},
    isActive: false,
    usable: false,
    latestSnapshotJob: null,
    refreshSchedule: null,
  };
}

const AvailableTargets: IntegrationTargetSummary[] = [
  {
    targetKey: "github-cloud",
    displayName: "GitHub",
    familyId: "github",
    variantId: "github-cloud",
    config: {},
    targetHealth: {
      configStatus: "valid",
    },
  },
];

const AvailableConnections: IntegrationConnectionSummary[] = [
  {
    id: "icn_github",
    displayName: "GitHub",
    targetKey: "github-cloud",
    status: "active",
  },
];

const IntegrationRows: SandboxProfileBindingEditorRow[] = [
  {
    clientId: "row_github",
    connectionId: "icn_github",
    kind: "agent",
    config: {},
  },
];
