// @vitest-environment jsdom

import {
  AssociatedProviderResourceKinds,
  AssociatedResourceEventTypes,
} from "@mistle/integrations-core";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import type { SandboxProfileVersion } from "../sandbox-profiles/sandbox-profiles-types.js";
import {
  SandboxProfileAssociatedResourceRoutingFieldGroup,
  type SandboxProfileAssociatedResourceRoutingDraftState,
} from "./sandbox-profile-associated-resource-routing-section.js";

afterEach(() => {
  cleanup();
});

describe("SandboxProfileAssociatedResourceRoutingFieldGroup", () => {
  it("shows default GitHub pull request routing when the profile has a GitHub binding", () => {
    renderSection();

    expect(screen.getByText("3")).toBeDefined();
    expect(screen.getByText("activities selected")).toBeDefined();
    expect(screen.getByRole("button", { name: "Explain agent PR activity" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Configure Agent PR activity" }));

    expect(screen.getByRole("checkbox", { name: "PR comments" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getByRole("checkbox", { name: "PR reviews" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(
      screen.getByRole("checkbox", { name: "Review comments" }).getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("builds an explicit disabled config when pull request activity routing is turned off", () => {
    const draftStates: SandboxProfileAssociatedResourceRoutingDraftState[] = [];
    renderSection({
      onDraftStateChange: (state) => {
        draftStates.push(state);
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Configure Agent PR activity" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "PR comments" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "PR reviews" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Review comments" }));

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

    fireEvent.click(screen.getByRole("button", { name: "Configure Agent PR activity" }));
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

    fireEvent.click(screen.getByRole("button", { name: "Configure Agent PR activity" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "PR comments" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "PR reviews" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Review comments" }));
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

  it("does not expose activity controls for read-only profile versions", () => {
    renderSection({ isDraft: false });

    const configureButton = screen.getByRole("button", { name: "Configure Agent PR activity" });
    expect(configureButton).toHaveProperty("disabled", true);

    fireEvent.click(configureButton);

    expect(screen.queryByRole("checkbox", { name: "PR comments" })).toBeNull();
  });

  it("preserves saved filters when associated resource metadata is unavailable", () => {
    const draftStates: SandboxProfileAssociatedResourceRoutingDraftState[] = [];
    renderSection({
      onDraftStateChange: (state) => {
        draftStates.push(state);
      },
      version: createVersion({
        associatedResourceEventRoutingConfig: {
          enabled: true,
          resources: [
            {
              resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
              eventTypes: [AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_ISSUE_COMMENT_CREATED],
              payloadFilter: {
                [AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_ISSUE_COMMENT_CREATED]: {
                  op: "contains_token",
                  path: ["comment", "body"],
                  value: "@mistle",
                },
              },
            },
          ],
        },
      }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Configure Agent PR activity" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "PR reviews" }));

    const latestDraftState = draftStates.at(-1);
    if (latestDraftState === undefined || latestDraftState.buildDraftChanges === undefined) {
      throw new Error("Expected associated resource routing draft state.");
    }

    expect(latestDraftState.buildDraftChanges()).toEqual({
      enabled: true,
      resources: [
        {
          resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
          eventTypes: [
            AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_ISSUE_COMMENT_CREATED,
            AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_REVIEW_SUBMITTED,
          ],
          payloadFilter: {
            [AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_ISSUE_COMMENT_CREATED]: {
              op: "contains_token",
              path: ["comment", "body"],
              value: "@mistle",
            },
          },
        },
      ],
    });
  });

  it("rehydrates saved filters when associated resource metadata arrives after initial render", () => {
    const version = createVersion({
      associatedResourceEventRoutingConfig: {
        enabled: true,
        resources: [
          {
            resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
            eventTypes: [AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_ISSUE_COMMENT_CREATED],
            payloadFilter: {
              [AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_ISSUE_COMMENT_CREATED]: {
                op: "contains_token",
                path: ["comment", "body"],
                value: "@mistle",
              },
            },
          },
        ],
      },
    });
    const queryClient = createTestQueryClient();
    const rendered = render(
      <QueryClientProvider client={queryClient}>
        <SandboxProfileAssociatedResourceRoutingFieldGroup
          disabled={false}
          hasGitHubBinding
          isDraft
          version={version}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Configure Agent PR activity" }));
    expect(screen.queryByDisplayValue("@mistle")).toBeNull();

    rendered.rerender(
      <QueryClientProvider client={queryClient}>
        <SandboxProfileAssociatedResourceRoutingFieldGroup
          disabled={false}
          hasGitHubBinding
          isDraft
          supportedAssociatedResourceEvents={SupportedAssociatedResourceEvents}
          version={version}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Configure Agent PR activity" }));

    expect(screen.getByDisplayValue("@mistle")).toBeDefined();
  });

  it("keeps expanded filter controls read-only when the section becomes disabled", () => {
    const draftStates: SandboxProfileAssociatedResourceRoutingDraftState[] = [];
    const version = createVersion({
      associatedResourceEventRoutingConfig: {
        enabled: true,
        resources: [
          {
            resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
            eventTypes: [AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_ISSUE_COMMENT_CREATED],
          },
        ],
      },
    });
    const queryClient = createTestQueryClient();
    const rendered = render(
      <QueryClientProvider client={queryClient}>
        <SandboxProfileAssociatedResourceRoutingFieldGroup
          disabled={false}
          hasGitHubBinding
          isDraft
          onDraftStateChange={(state) => {
            draftStates.push(state);
          }}
          supportedAssociatedResourceEvents={SupportedAssociatedResourceEvents}
          version={version}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Configure Agent PR activity" }));
    const filterInput = screen.getByRole("textbox", { name: "includes" });
    expect(filterInput).toHaveProperty("disabled", false);

    rendered.rerender(
      <QueryClientProvider client={queryClient}>
        <SandboxProfileAssociatedResourceRoutingFieldGroup
          disabled
          hasGitHubBinding
          isDraft
          onDraftStateChange={(state) => {
            draftStates.push(state);
          }}
          supportedAssociatedResourceEvents={SupportedAssociatedResourceEvents}
          version={version}
        />
      </QueryClientProvider>,
    );

    const disabledFilterInput = screen.getByRole("textbox", { name: "includes" });
    expect(disabledFilterInput).toHaveProperty("disabled", true);
    const draftStateCount = draftStates.length;

    fireEvent.change(disabledFilterInput, { target: { value: "@mistle" } });

    expect(draftStates).toHaveLength(draftStateCount);
  });
});

function renderSection(input?: {
  disabled?: boolean;
  isDraft?: boolean;
  onDraftStateChange?: (state: SandboxProfileAssociatedResourceRoutingDraftState) => void;
  version?: SandboxProfileVersion;
}) {
  return render(
    <SandboxProfileAssociatedResourceRoutingFieldGroup
      disabled={input?.disabled ?? false}
      hasGitHubBinding
      isDraft={input?.isDraft ?? true}
      {...(input?.onDraftStateChange === undefined
        ? {}
        : { onDraftStateChange: input.onDraftStateChange })}
      version={input?.version ?? createVersion()}
    />,
  );
}

function createVersion(input?: {
  associatedResourceEventRoutingConfig?: SandboxProfileVersion["associatedResourceEventRoutingConfig"];
}): SandboxProfileVersion {
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
    associatedResourceEventRoutingConfig: input?.associatedResourceEventRoutingConfig ?? {},
    isActive: false,
    usable: false,
    latestSnapshotJob: null,
    refreshSchedule: null,
  };
}

const SupportedAssociatedResourceEvents = [
  {
    resourceKind: AssociatedProviderResourceKinds.GITHUB_PULL_REQUEST,
    eventType: AssociatedResourceEventTypes.GITHUB_PULL_REQUEST_ISSUE_COMMENT_CREATED,
    displayName: "PR comments",
    parameters: [
      {
        id: "invocationToken",
        label: "includes",
        kind: "string",
        payloadPath: ["comment", "body"],
        matchMode: "contains_token",
        controlVariant: "invocation-token",
      },
    ],
  },
] satisfies NonNullable<
  ComponentProps<
    typeof SandboxProfileAssociatedResourceRoutingFieldGroup
  >["supportedAssociatedResourceEvents"]
>;
