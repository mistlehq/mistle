// @vitest-environment jsdom

import {
  AssociatedProviderResourceKinds,
  AssociatedResourceEventTypes,
  SlackThreadMessageModes,
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

    expect(screen.queryByRole("switch", { name: "Agent PR activity" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Configure Agent PR activity" }).textContent,
    ).toContain("3 activities selected");
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

  it("keeps the resource title independent from the settings disclosure control", () => {
    renderSection();

    fireEvent.click(screen.getByText("Agent PR activity"));

    expect(screen.queryByRole("checkbox", { name: "PR comments" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Configure Agent PR activity" }));

    expect(screen.getByRole("checkbox", { name: "PR comments" }).getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("shows default Slack thread reply routing when the profile has a Slack association-capable binding", () => {
    renderSection({ hasGitHubBinding: false, hasSlackThreadBinding: true });

    expect(
      screen.getByRole("button", { name: "Configure Agent-started Slack threads" }).textContent,
    ).toContain("1 activity selected");
    expect(screen.queryByRole("switch", { name: "Agent-started Slack threads" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Explain agent-started Slack threads" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Configure Agent-started Slack threads" }));
    expect(
      screen.getByRole("checkbox", { name: "Enable thread messages" }).getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.getByRole("combobox", { name: "Thread messages" })).toBeTruthy();
  });

  it("updates default Slack thread reply routing when a Slack association-capable binding is added", () => {
    const runtime = renderSection({
      hasGitHubBinding: true,
      hasSlackThreadBinding: false,
    });

    expect(
      screen.getByRole("button", { name: "Configure Agent-started Slack threads" }).textContent,
    ).toContain("0 activities selected");
    expect(screen.queryByRole("switch", { name: "Agent-started Slack threads" })).toBeNull();

    runtime.rerender(
      <SandboxProfileAssociatedResourceRoutingFieldGroup
        disabled={false}
        hasGitHubBinding={true}
        hasSlackThreadBinding={true}
        isDraft
        version={createVersion()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Configure Agent-started Slack threads" }).textContent,
    ).toContain("1 activity selected");
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

  it("builds Slack thread reply routing after GitHub routing is disabled", () => {
    const draftStates: SandboxProfileAssociatedResourceRoutingDraftState[] = [];
    renderSection({
      hasSlackThreadBinding: true,
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

    expect(latestDraftState.buildDraftChanges()).toEqual({
      enabled: true,
      resources: [
        {
          resourceKind: "slack.thread",
          eventTypes: [AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED],
        },
      ],
    });
  });

  it("builds Slack thread reply payload filters", () => {
    const draftStates: SandboxProfileAssociatedResourceRoutingDraftState[] = [];
    renderSection({
      hasGitHubBinding: false,
      hasSlackThreadBinding: true,
      onDraftStateChange: (state) => {
        draftStates.push(state);
      },
      supportedAssociatedResourceEvents: SupportedSlackAssociatedResourceEvents,
    });

    fireEvent.click(screen.getByRole("button", { name: "Configure Agent-started Slack threads" }));
    fireEvent.change(screen.getByRole("textbox", { name: "includes" }), {
      target: { value: "@mistle" },
    });

    const latestDraftState = draftStates.at(-1);
    if (latestDraftState === undefined || latestDraftState.buildDraftChanges === undefined) {
      throw new Error("Expected associated resource routing draft state.");
    }

    expect(latestDraftState.buildDraftChanges()).toEqual({
      enabled: true,
      resources: [
        {
          resourceKind: "slack.thread",
          eventTypes: [AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED],
          payloadFilter: {
            [AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED]: {
              op: "contains_token",
              path: ["event", "text"],
              value: "@mistle",
            },
          },
        },
      ],
    });
  });

  it("preserves Slack app mention only thread message routing when building draft changes", () => {
    const draftStates: SandboxProfileAssociatedResourceRoutingDraftState[] = [];
    renderSection({
      hasGitHubBinding: false,
      hasSlackThreadBinding: true,
      onDraftStateChange: (state) => {
        draftStates.push(state);
      },
      supportedAssociatedResourceEvents: SupportedSlackAssociatedResourceEvents,
      version: createVersion({
        associatedResourceEventRoutingConfig: {
          enabled: true,
          resources: [
            {
              resourceKind: "slack.thread",
              eventTypes: [AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED],
              messageMode: SlackThreadMessageModes.APP_MENTIONS_ONLY,
            },
          ],
        },
      }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Configure Agent-started Slack threads" }));
    expect(screen.getByRole("combobox", { name: "Thread messages" }).textContent).toContain(
      "App mentions only",
    );
    fireEvent.change(screen.getByRole("textbox", { name: "includes" }), {
      target: { value: "@mistle" },
    });

    const latestDraftState = draftStates.at(-1);
    if (latestDraftState === undefined || latestDraftState.buildDraftChanges === undefined) {
      throw new Error("Expected associated resource routing draft state.");
    }

    expect(latestDraftState.buildDraftChanges()).toEqual({
      enabled: true,
      resources: [
        {
          resourceKind: "slack.thread",
          eventTypes: [AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED],
          messageMode: SlackThreadMessageModes.APP_MENTIONS_ONLY,
          payloadFilter: {
            [AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED]: {
              op: "contains_token",
              path: ["event", "text"],
              value: "@mistle",
            },
          },
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

  it("keeps associated resource details inspectable but read-only for published profile versions", () => {
    renderSection({ hasSlackThreadBinding: true, isDraft: false });

    const configurePullRequestButton = screen.getByRole("button", {
      name: "Configure Agent PR activity",
    });
    expect(configurePullRequestButton).toHaveProperty("disabled", false);

    fireEvent.click(configurePullRequestButton);

    expect(screen.queryByRole("checkbox", { name: "PR comments" })).toBeNull();
    expect(screen.getByText("PR comments")).toBeTruthy();

    const configureSlackThreadButton = screen.getByRole("button", {
      name: "Configure Agent-started Slack threads",
    });
    expect(configureSlackThreadButton).toHaveProperty("disabled", false);

    fireEvent.click(configureSlackThreadButton);

    expect(screen.queryByRole("checkbox", { name: "Enable thread messages" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Thread messages" })).toBeNull();
    expect(screen.queryByText("Thread messages")).toBeNull();
    expect(screen.queryByText("Message mode")).toBeNull();
    expect(screen.getByText("All messages")).toBeTruthy();
    expect(screen.queryByText("Associated resource routing is read-only.")).toBeNull();
  });

  it("shows disabled published pull request routing as unselected when expanded", () => {
    renderSection({
      isDraft: false,
      version: createVersion({
        associatedResourceEventRoutingConfig: {
          enabled: false,
          resources: [],
        },
      }),
    });

    expect(screen.queryByRole("button", { name: "Configure Agent PR activity" })).toBeNull();
    expect(screen.getAllByText("activities selected")).toHaveLength(2);
    expect(screen.queryByRole("checkbox", { name: "PR comments" })).toBeNull();
    expect(screen.queryByText("No activities selected.")).toBeNull();
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
          hasSlackThreadBinding={false}
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
          hasSlackThreadBinding={false}
          isDraft
          supportedAssociatedResourceEvents={SupportedAssociatedResourceEvents}
          version={version}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Configure Agent PR activity" }));

    expect(screen.getByDisplayValue("@mistle")).toBeDefined();
  });

  it("presents expanded filter details as read-only text when the section becomes disabled", () => {
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
          hasSlackThreadBinding={false}
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
    fireEvent.change(filterInput, { target: { value: "@mistle" } });

    rendered.rerender(
      <QueryClientProvider client={queryClient}>
        <SandboxProfileAssociatedResourceRoutingFieldGroup
          disabled
          hasGitHubBinding
          hasSlackThreadBinding={false}
          isDraft
          onDraftStateChange={(state) => {
            draftStates.push(state);
          }}
          supportedAssociatedResourceEvents={SupportedAssociatedResourceEvents}
          version={version}
        />
      </QueryClientProvider>,
    );

    const draftStateCount = draftStates.length;

    expect(screen.queryByRole("textbox", { name: "includes" })).toBeNull();
    expect(screen.getByText("includes")).toBeTruthy();
    expect(screen.getByText("@mistle")).toBeTruthy();

    expect(draftStates).toHaveLength(draftStateCount);
  });
});

function renderSection(input?: {
  disabled?: boolean;
  hasGitHubBinding?: boolean;
  hasSlackThreadBinding?: boolean;
  isDraft?: boolean;
  onDraftStateChange?: (state: SandboxProfileAssociatedResourceRoutingDraftState) => void;
  supportedAssociatedResourceEvents?: ComponentProps<
    typeof SandboxProfileAssociatedResourceRoutingFieldGroup
  >["supportedAssociatedResourceEvents"];
  version?: SandboxProfileVersion;
}) {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <SandboxProfileAssociatedResourceRoutingFieldGroup
        disabled={input?.disabled ?? false}
        hasGitHubBinding={input?.hasGitHubBinding ?? true}
        hasSlackThreadBinding={input?.hasSlackThreadBinding ?? false}
        isDraft={input?.isDraft ?? true}
        {...(input?.onDraftStateChange === undefined
          ? {}
          : { onDraftStateChange: input.onDraftStateChange })}
        supportedAssociatedResourceEvents={input?.supportedAssociatedResourceEvents}
        version={input?.version ?? createVersion()}
      />
    </QueryClientProvider>,
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

const SupportedSlackAssociatedResourceEvents = [
  {
    resourceKind: AssociatedProviderResourceKinds.SLACK_THREAD,
    eventType: AssociatedResourceEventTypes.SLACK_THREAD_MESSAGE_CREATED,
    displayName: "Thread messages",
    parameters: [
      {
        id: "invocationToken",
        label: "includes",
        kind: "string",
        payloadPath: ["event", "text"],
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
