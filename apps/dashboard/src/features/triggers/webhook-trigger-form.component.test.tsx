// @vitest-environment jsdom

import { EditorView } from "@codemirror/view";
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { createTestQueryClient } from "../../test-support/query-client.js";
import type { IntegrationConnection } from "../integrations/integrations-service.js";
import { resolveTriggerInstructionResourceKinds } from "./agent-instructions-token-catalog.js";
import type { TriggerFormShellStatusMessage } from "./trigger-form-shell.js";
import type { WebhookTriggerEventPickerDisabledState } from "./webhook-trigger-event-picker-state.js";
import {
  WebhookTriggerEventParameterRuleOperators,
  type WebhookTriggerEventParameterRuleMap,
} from "./webhook-trigger-event-types.js";
import {
  WebhookTriggerForm,
  type WebhookTriggerFormFieldErrors,
  type WebhookTriggerFormOption,
  type WebhookTriggerFormValues,
} from "./webhook-trigger-form.js";
import {
  createWebhookTriggerEventConditionId,
  createWebhookTriggerEventId,
} from "./webhook-trigger-option-builders.js";
import { createTriggerParameterResourceQueryKey } from "./webhook-trigger-resource-query-keys.js";
import {
  createGithubIssueCommentCreatedEventOption,
  createGithubPullRequestOpenedEventOption,
  createInvocationTokenParameter,
  GitHubConnectionId,
  GitHubConnectionLabel,
  GitHubWebhookSourceId,
  RepoMaintainerSandboxProfileId,
} from "./webhook-trigger-test-fixtures.js";

const ConnectionOptions: readonly WebhookTriggerFormOption[] = [
  {
    value: GitHubConnectionId,
    label: GitHubConnectionLabel,
    description: "github-cloud",
  },
];

const Connections: readonly IntegrationConnection[] = [
  {
    id: GitHubConnectionId,
    targetKey: "github-cloud",
    displayName: GitHubConnectionLabel,
    status: "active",
    resources: [
      {
        kind: "user",
        selectionMode: "multi",
        count: 2,
        syncState: "ready",
        lastSyncedAt: "2026-06-28T00:00:00.000Z",
      },
      {
        kind: "bot",
        selectionMode: "multi",
        count: 1,
        syncState: "ready",
      },
    ],
    createdAt: "2026-06-28T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:00.000Z",
  },
];

const SandboxProfileOptions: readonly WebhookTriggerFormOption[] = [
  {
    value: RepoMaintainerSandboxProfileId,
    label: "Repo Maintainer",
  },
];

const WebhookEventOptions = [
  createGithubIssueCommentCreatedEventOption({
    parameters: [
      {
        id: "repository",
        label: "repository",
        kind: "resource-select",
        resourceKind: "repository",
        payloadPath: ["repository", "full_name"],
        prefix: "in",
      },
    ],
  }),
  createGithubPullRequestOpenedEventOption(),
];

const FormValues: WebhookTriggerFormValues = {
  name: "Repo triage",
  sandboxProfileId: RepoMaintainerSandboxProfileId,
  primaryRepositoryId: "mistlehq/platform",
  enabled: true,
  inputTemplate: "Please review the changes made.\n\nPayload:\n{{payload}}",
  instructions: "Reply tersely and mention the review checklist.",
  conversationKeyTemplate: "{{payload.repository.full_name}}:issue:{{payload.issue.number}}",
  eventIds: [
    createWebhookTriggerEventId({
      webhookSourceId: GitHubWebhookSourceId,
      eventType: "github.issue_comment.created",
    }),
  ],
  eventActorPolicies: {},
  eventParameterRules: {},
};

const TestQueryClient = createTestQueryClient();

const PrimaryRepositoryOptions: readonly WebhookTriggerFormOption[] = [
  {
    value: "__workspace_root__",
    label: "None",
    path: "workspace root",
  },
  {
    value: "mistlehq/platform",
    label: "mistlehq/platform",
    path: "/root/mistlehq/platform",
  },
];

afterEach(() => {
  TestQueryClient.clear();
  cleanup();
});

describe("WebhookTriggerForm", () => {
  function buildFormValues(
    overrides: Partial<WebhookTriggerFormValues> = {},
  ): WebhookTriggerFormValues {
    return {
      ...FormValues,
      ...overrides,
    };
  }

  function renderForm(mode: "create" | "edit" = "create"): ReturnType<typeof render> {
    return renderFormWithOptions({
      mode,
      values:
        mode === "create"
          ? {
              ...FormValues,
              name: "",
              sandboxProfileId: "",
              primaryRepositoryId: "",
              inputTemplate: "",
              instructions: "",
              conversationKeyTemplate: "",
              eventIds: [],
              eventParameterRules: {},
            }
          : FormValues,
    });
  }

  type RenderFormOptions = {
    mode?: "create" | "edit";
    values?: WebhookTriggerFormValues;
    isDeleting?: boolean;
    isDuplicating?: boolean;
    isSaving?: boolean;
    triggerPickerDisabledState?: WebhookTriggerEventPickerDisabledState | null;
    sandboxProfileStatusMessage?: TriggerFormShellStatusMessage | undefined;
    webhookEventOptions?: typeof WebhookEventOptions;
    connections?: readonly IntegrationConnection[];
    fieldErrors?: WebhookTriggerFormFieldErrors;
    primaryRepositoryOptions?: readonly WebhookTriggerFormOption[];
    onDelete?: () => void;
    onDuplicate?: () => void;
    onSubmit?: () => void;
    onViewActivity?: () => void;
    onValueChange?: (
      key: keyof WebhookTriggerFormValues,
      value:
        | string
        | boolean
        | string[]
        | WebhookTriggerFormValues["eventActorPolicies"]
        | WebhookTriggerEventParameterRuleMap,
    ) => void;
  };

  function createFormElement(input: RenderFormOptions): React.JSX.Element {
    return (
      <QueryClientProvider client={TestQueryClient}>
        <WebhookTriggerForm
          connectionOptions={ConnectionOptions}
          connections={input.connections ?? Connections}
          fieldErrors={input.fieldErrors ?? {}}
          formError={null}
          validationSummaryError={null}
          isDeleting={input.isDeleting ?? false}
          isDuplicating={input.isDuplicating ?? false}
          isSaving={input.isSaving ?? false}
          mode={input.mode ?? "create"}
          onDelete={(input.mode ?? "create") === "edit" ? (input.onDelete ?? (() => {})) : null}
          onDuplicate={
            (input.mode ?? "create") === "edit" ? (input.onDuplicate ?? (() => {})) : null
          }
          onSubmit={input.onSubmit ?? (() => {})}
          onViewActivity={input.onViewActivity ?? null}
          onValueChange={input.onValueChange ?? (() => {})}
          {...(input.primaryRepositoryOptions === undefined
            ? {}
            : { primaryRepositoryOptions: input.primaryRepositoryOptions })}
          sandboxProfileOptions={SandboxProfileOptions}
          {...(input.sandboxProfileStatusMessage === undefined
            ? {}
            : { sandboxProfileStatusMessage: input.sandboxProfileStatusMessage })}
          triggerPickerDisabledState={input.triggerPickerDisabledState ?? null}
          webhookEventOptions={input.webhookEventOptions ?? WebhookEventOptions}
          values={input.values ?? FormValues}
        />
      </QueryClientProvider>
    );
  }

  function renderFormWithOptions(input: RenderFormOptions): ReturnType<typeof render> {
    return render(createFormElement(input));
  }

  function getEditorViewByName(name: string): EditorView {
    const textbox = screen.getByRole("textbox", { name });
    const editorView = EditorView.findFromDOM(textbox);
    if (editorView === null) {
      throw new Error(`Expected '${name}' to be a CodeMirror editor.`);
    }

    return editorView;
  }

  it("shows selected option labels in the select triggers instead of raw ids", () => {
    renderFormWithOptions({
      mode: "create",
      primaryRepositoryOptions: PrimaryRepositoryOptions,
      values: buildFormValues(),
    });

    expect(screen.getByText("Repo Maintainer")).toBeDefined();
    expect(screen.getByRole("combobox", { name: "Primary repository" })).toHaveProperty(
      "value",
      "mistlehq/platform",
    );
    expect(screen.getByText("/root/mistlehq/platform")).toBeDefined();
    expect(screen.queryByText(GitHubConnectionId)).toBeNull();
    expect(screen.queryByText(RepoMaintainerSandboxProfileId)).toBeNull();
  });

  it("shows selected trigger event labels instead of raw event types", () => {
    renderFormWithOptions({
      mode: "create",
      values: buildFormValues(),
    });

    expect(screen.getAllByText("Issue comment created").length).toBeGreaterThan(0);
    expect(screen.queryByText("github.issue_comment.created")).toBeNull();
  });

  it("shows connector-defined conversation grouping choices", () => {
    const { container } = renderFormWithOptions({
      mode: "create",
      values: buildFormValues(),
    });

    const groupingFieldCandidate = within(container)
      .getAllByText("Group events by")[0]
      ?.closest('[role="group"]');
    if (groupingFieldCandidate === null) {
      throw new Error("Expected conversation grouping field.");
    }
    if (!(groupingFieldCandidate instanceof HTMLElement)) {
      throw new Error("Expected conversation grouping field.");
    }

    expect(within(groupingFieldCandidate).getByRole("combobox")).toBeDefined();
  });

  it("shows actor policy controls for events with provider actor metadata", () => {
    const eventOption = createGithubIssueCommentCreatedEventOption({
      actor: {
        resourceReferences: [
          {
            resourceKind: "user",
            handlePayloadPath: ["sender", "login"],
          },
        ],
      },
      resourceDefinitions: [
        {
          kind: "user",
          selectionMode: "multi",
          bindingField: "users",
          displayNameSingular: "user",
          displayNamePlural: "users",
        },
      ],
      resourceRelationshipDefinitions: [
        {
          relationshipKind: "belongs_to",
          subjectResourceKind: "user",
          objectResourceKind: "team",
          displayName: "Team members",
          scopeDefinitions: [
            {
              scopeKind: "team",
            },
          ],
        },
      ],
    });
    const conditionId = createWebhookTriggerEventConditionId({
      eventOptionId: eventOption.id,
      index: 0,
    });

    renderFormWithOptions({
      mode: "create",
      values: buildFormValues({
        eventIds: [conditionId],
        eventParameterRules: {
          [conditionId]: {},
        },
      }),
      webhookEventOptions: [eventOption],
    });

    expect(screen.getByText("Allowed actors")).toBeDefined();
    expect(
      screen.getByText(
        "Group actor policies need resource sync readiness before they can be selected.",
      ),
    ).toBeDefined();
  });

  it("shows mixed actor allowlists as restricted policies", () => {
    const eventOption = createGithubIssueCommentCreatedEventOption({
      actor: {
        resourceReferences: [
          {
            resourceKind: "user",
            handlePayloadPath: ["sender", "login"],
          },
          {
            resourceKind: "bot",
            handlePayloadPath: ["sender", "login"],
          },
        ],
      },
      resourceDefinitions: [
        {
          kind: "user",
          selectionMode: "multi",
          bindingField: "users",
          displayNameSingular: "user",
          displayNamePlural: "users",
        },
        {
          kind: "bot",
          selectionMode: "multi",
          bindingField: "bots",
          displayNameSingular: "GitHub App bot",
          displayNamePlural: "GitHub App bots",
        },
        {
          kind: "org",
          selectionMode: "multi",
          bindingField: "organizations",
          displayNameSingular: "organization",
          displayNamePlural: "organizations",
        },
      ],
      resourceRelationshipDefinitions: [
        {
          relationshipKind: "belongs_to",
          subjectResourceKind: "user",
          objectResourceKind: "org",
          displayName: "Organization members",
          scopeDefinitions: [
            {
              scopeKind: "org",
            },
          ],
        },
      ],
    });
    const conditionId = createWebhookTriggerEventConditionId({
      eventOptionId: eventOption.id,
      index: 0,
    });
    const githubConnection = Connections[0];
    if (githubConnection === undefined) {
      throw new Error("Expected GitHub test connection.");
    }
    TestQueryClient.setQueryData(["trigger-actor-policy-resources", GitHubConnectionId, "bot"], {
      connectionId: GitHubConnectionId,
      familyId: "github",
      kind: "bot",
      syncState: "ready",
      items: [
        {
          id: "bot-dependabot",
          familyId: "github",
          kind: "bot",
          externalId: "3001",
          handle: "dependabot[bot]",
          displayName: "dependabot[bot]",
          status: "accessible",
          metadata: {},
        },
      ],
    });

    renderFormWithOptions({
      mode: "create",
      values: buildFormValues({
        eventIds: [conditionId],
        eventActorPolicies: {
          [conditionId]: {
            anyOf: [
              {
                kind: "resource",
                actor: {
                  resourceKind: "bot",
                  handle: "mistle-reviewer[bot]",
                },
              },
              {
                kind: "resource",
                actor: {
                  resourceKind: "bot",
                  handle: "hacktron-ai[bot]",
                },
              },
              {
                kind: "relationship",
                relationshipKind: "belongs_to",
                actorSet: {
                  resourceKind: "org",
                  handle: "mistlehq",
                },
                scope: {
                  resourceKind: "org",
                  handle: "mistlehq",
                },
              },
            ],
          },
        },
        eventParameterRules: {
          [conditionId]: {},
        },
      }),
      webhookEventOptions: [eventOption],
      connections: [
        {
          ...githubConnection,
          resources: [
            ...(githubConnection.resources ?? []),
            {
              kind: "org",
              selectionMode: "multi",
              count: 1,
              syncState: "ready",
            },
          ],
        },
      ],
    });

    expect(screen.queryByText("Restricted allowlist")).toBeNull();
    expect(screen.getByText("one of")).toBeDefined();
    expect(screen.getByText("Is in")).toBeDefined();
    expect(screen.getAllByLabelText("actor").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("group or set").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", {
        name: "Remove actor condition GitHub App bot: mistle-reviewer[bot], GitHub App bot: hacktron-ai[bot]",
      }),
    ).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Add actor condition" }));
    expect(
      screen
        .getByRole("menuitem", { name: /Actor is in group or set/ })
        .getAttribute("data-disabled"),
    ).not.toBeNull();
    expect(
      screen.getByRole("menuitem", { name: /Actor is one of/ }).getAttribute("data-disabled"),
    ).not.toBeNull();
  });

  it("writes relationship actor policies for multiple synced actor sets", () => {
    const eventOption = createGithubIssueCommentCreatedEventOption({
      actor: {
        resourceReferences: [
          {
            resourceKind: "user",
            handlePayloadPath: ["sender", "login"],
          },
        ],
      },
      resourceDefinitions: [
        {
          kind: "user",
          selectionMode: "multi",
          bindingField: "users",
          displayNameSingular: "user",
          displayNamePlural: "users",
        },
        {
          kind: "team",
          selectionMode: "multi",
          bindingField: "teams",
          displayNameSingular: "team",
          displayNamePlural: "teams",
        },
      ],
      resourceRelationshipDefinitions: [
        {
          relationshipKind: "belongs_to",
          subjectResourceKind: "user",
          objectResourceKind: "team",
          displayName: "Team members",
          scopeDefinitions: [
            {
              scopeKind: "team",
            },
          ],
        },
      ],
    });
    const conditionId = createWebhookTriggerEventConditionId({
      eventOptionId: eventOption.id,
      index: 0,
    });
    let changedKey: keyof WebhookTriggerFormValues | null = null;
    let changedValue: unknown;
    TestQueryClient.setQueryData(["trigger-actor-policy-resources", GitHubConnectionId, "team"], {
      connectionId: GitHubConnectionId,
      familyId: "github",
      kind: "team",
      syncState: "ready",
      items: [
        {
          id: "team-platform",
          familyId: "github",
          kind: "team",
          externalId: "100",
          handle: "mistle/platform",
          displayName: "Platform",
          status: "accessible",
          metadata: {},
        },
        {
          id: "team-security",
          familyId: "github",
          kind: "team",
          externalId: "101",
          handle: "mistle/security",
          displayName: "Security",
          status: "accessible",
          metadata: {},
        },
      ],
    });

    renderFormWithOptions({
      mode: "create",
      onValueChange: (key, value) => {
        changedKey = key;
        changedValue = value;
      },
      values: buildFormValues({
        eventIds: [conditionId],
        eventActorPolicies: {
          [conditionId]: {
            anyOf: [
              {
                kind: "resource",
                actor: {
                  resourceKind: "user",
                  resourceId: "user-alice",
                },
              },
            ],
          },
        },
        eventParameterRules: {
          [conditionId]: {},
        },
      }),
      webhookEventOptions: [eventOption],
      connections: [
        {
          id: GitHubConnectionId,
          targetKey: "github-cloud",
          displayName: GitHubConnectionLabel,
          status: "active",
          resources: [
            {
              kind: "user",
              selectionMode: "multi",
              count: 2,
              syncState: "ready",
            },
            {
              kind: "team",
              selectionMode: "multi",
              count: 1,
              syncState: "ready",
            },
          ],
          createdAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z",
        },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Add actor condition" }));
    const groupOption = screen.getByRole("menuitem", { name: "Actor is in group or set" });
    expect(groupOption.getAttribute("data-disabled")).toBeNull();
    fireEvent.click(groupOption);

    const groupInput = screen.getByLabelText("group or set");
    const chipToolbar = groupInput.closest('[data-slot="combobox-chips"]');
    if (chipToolbar === null) {
      throw new Error("Expected group picker chip toolbar.");
    }
    fireEvent.click(chipToolbar);
    fireEvent.click(screen.getByLabelText("Select all"));

    expect(changedKey).toBe("eventActorPolicies");
    expect(changedValue).toEqual({
      [conditionId]: {
        anyOf: [
          {
            kind: "resource",
            actor: {
              resourceKind: "user",
              resourceId: "user-alice",
            },
          },
          {
            kind: "relationship",
            relationshipKind: "belongs_to",
            actorSet: {
              resourceKind: "team",
              resourceId: "team-platform",
            },
            scope: {
              resourceKind: "team",
              resourceId: "team-platform",
            },
          },
          {
            kind: "relationship",
            relationshipKind: "belongs_to",
            actorSet: {
              resourceKind: "team",
              resourceId: "team-security",
            },
            scope: {
              resourceKind: "team",
              resourceId: "team-security",
            },
          },
        ],
      },
    });
  });

  it("keeps draft actor condition rows when adding another actor condition", () => {
    const eventOption = createGithubIssueCommentCreatedEventOption({
      actor: {
        resourceReferences: [
          {
            resourceKind: "user",
            handlePayloadPath: ["sender", "login"],
          },
        ],
      },
      resourceDefinitions: [
        {
          kind: "user",
          selectionMode: "multi",
          bindingField: "users",
          displayNameSingular: "user",
          displayNamePlural: "users",
        },
        {
          kind: "team",
          selectionMode: "multi",
          bindingField: "teams",
          displayNameSingular: "team",
          displayNamePlural: "teams",
        },
      ],
      resourceRelationshipDefinitions: [
        {
          relationshipKind: "belongs_to",
          subjectResourceKind: "user",
          objectResourceKind: "team",
          displayName: "Team members",
          scopeDefinitions: [
            {
              scopeKind: "team",
            },
          ],
        },
      ],
    });
    const conditionId = createWebhookTriggerEventConditionId({
      eventOptionId: eventOption.id,
      index: 0,
    });

    TestQueryClient.setQueryData(["trigger-actor-policy-resources", GitHubConnectionId, "user"], {
      connectionId: GitHubConnectionId,
      familyId: "github",
      kind: "user",
      syncState: "ready",
      items: [
        {
          id: "user-alice",
          familyId: "github",
          kind: "user",
          externalId: "1",
          handle: "alice",
          displayName: "alice",
          status: "accessible",
          metadata: {},
        },
      ],
    });
    TestQueryClient.setQueryData(["trigger-actor-policy-resources", GitHubConnectionId, "team"], {
      connectionId: GitHubConnectionId,
      familyId: "github",
      kind: "team",
      syncState: "ready",
      items: [
        {
          id: "team-platform",
          familyId: "github",
          kind: "team",
          externalId: "100",
          handle: "mistle/platform",
          displayName: "Platform",
          status: "accessible",
          metadata: {},
        },
      ],
    });

    renderFormWithOptions({
      mode: "create",
      values: buildFormValues({
        eventIds: [conditionId],
        eventActorPolicies: {},
        eventParameterRules: {
          [conditionId]: {},
        },
      }),
      webhookEventOptions: [eventOption],
      connections: [
        {
          id: GitHubConnectionId,
          targetKey: "github-cloud",
          displayName: GitHubConnectionLabel,
          status: "active",
          resources: [
            {
              kind: "user",
              selectionMode: "multi",
              count: 1,
              syncState: "ready",
            },
            {
              kind: "team",
              selectionMode: "multi",
              count: 1,
              syncState: "ready",
            },
          ],
          createdAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z",
        },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Add actor condition" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Actor is one of" }));
    expect(screen.getByText("one of")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Add actor condition" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Actor is in group or set" }));

    const actorRowLabel = screen.getByText("one of");
    const groupRowLabel = screen.getByText("Team members");
    expect(
      actorRowLabel.compareDocumentPosition(groupRowLabel) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText("Search actors")).toBeDefined();
    expect(screen.getByPlaceholderText("Search groups")).toBeDefined();
  });

  it("keeps an edited specific actor condition in its original policy position", () => {
    const eventOption = createGithubIssueCommentCreatedEventOption({
      actor: {
        resourceReferences: [
          {
            resourceKind: "user",
            handlePayloadPath: ["sender", "login"],
          },
        ],
      },
      resourceDefinitions: [
        {
          kind: "user",
          selectionMode: "multi",
          bindingField: "users",
          displayNameSingular: "user",
          displayNamePlural: "users",
        },
        {
          kind: "org",
          selectionMode: "multi",
          bindingField: "orgs",
          displayNameSingular: "organization",
          displayNamePlural: "organizations",
        },
      ],
      resourceRelationshipDefinitions: [
        {
          relationshipKind: "belongs_to",
          subjectResourceKind: "user",
          objectResourceKind: "org",
          displayName: "Organization members",
          scopeDefinitions: [
            {
              scopeKind: "org",
            },
          ],
        },
      ],
    });
    const conditionId = createWebhookTriggerEventConditionId({
      eventOptionId: eventOption.id,
      index: 0,
    });
    let changedKey: keyof WebhookTriggerFormValues | null = null;
    let changedValue: unknown;
    TestQueryClient.setQueryData(["trigger-actor-policy-resources", GitHubConnectionId, "user"], {
      connectionId: GitHubConnectionId,
      familyId: "github",
      kind: "user",
      syncState: "ready",
      items: [
        {
          id: "user-alice",
          familyId: "github",
          kind: "user",
          externalId: "200",
          handle: "alice",
          displayName: "alice",
          status: "accessible",
          metadata: {},
        },
        {
          id: "user-bob",
          familyId: "github",
          kind: "user",
          externalId: "201",
          handle: "bob",
          displayName: "bob",
          status: "accessible",
          metadata: {},
        },
      ],
    });

    renderFormWithOptions({
      mode: "create",
      onValueChange: (key, value) => {
        changedKey = key;
        changedValue = value;
      },
      values: buildFormValues({
        eventIds: [conditionId],
        eventActorPolicies: {
          [conditionId]: {
            anyOf: [
              {
                kind: "resource",
                actor: {
                  resourceKind: "user",
                  resourceId: "user-alice",
                },
              },
              {
                kind: "relationship",
                relationshipKind: "belongs_to",
                actorSet: {
                  resourceKind: "org",
                  resourceId: "org-mistlehq",
                },
                scope: {
                  resourceKind: "org",
                  resourceId: "org-mistlehq",
                },
              },
            ],
          },
        },
        eventParameterRules: {
          [conditionId]: {},
        },
      }),
      webhookEventOptions: [eventOption],
      connections: [
        {
          id: GitHubConnectionId,
          targetKey: "github-cloud",
          displayName: GitHubConnectionLabel,
          status: "active",
          resources: [
            {
              kind: "user",
              selectionMode: "multi",
              count: 2,
              syncState: "ready",
            },
            {
              kind: "org",
              selectionMode: "multi",
              count: 1,
              syncState: "ready",
            },
          ],
          createdAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z",
        },
      ],
    });

    const aliceChip = screen.getByText(/alice/);
    const chipToolbar = aliceChip.closest('[data-slot="combobox-chips"]');
    if (chipToolbar === null) {
      throw new Error("Expected actor picker chip toolbar.");
    }
    fireEvent.click(chipToolbar);
    fireEvent.click(screen.getByText(/bob/));

    expect(changedKey).toBe("eventActorPolicies");
    expect(changedValue).toEqual({
      [conditionId]: {
        anyOf: [
          {
            kind: "resource",
            actor: {
              resourceKind: "user",
              resourceId: "user-alice",
            },
          },
          {
            kind: "resource",
            actor: {
              resourceKind: "user",
              resourceId: "user-bob",
            },
          },
          {
            kind: "relationship",
            relationshipKind: "belongs_to",
            actorSet: {
              resourceKind: "org",
              resourceId: "org-mistlehq",
            },
            scope: {
              resourceKind: "org",
              resourceId: "org-mistlehq",
            },
          },
        ],
      },
    });
  });

  it("writes excluded specific actor policies", () => {
    const eventOption = createGithubIssueCommentCreatedEventOption({
      actor: {
        resourceReferences: [
          {
            resourceKind: "user",
            handlePayloadPath: ["sender", "login"],
          },
        ],
      },
      resourceDefinitions: [
        {
          kind: "user",
          selectionMode: "multi",
          bindingField: "users",
          displayNameSingular: "user",
          displayNamePlural: "users",
        },
      ],
    });
    const conditionId = createWebhookTriggerEventConditionId({
      eventOptionId: eventOption.id,
      index: 0,
    });
    let changedKey: keyof WebhookTriggerFormValues | null = null;
    let changedValue: unknown;

    TestQueryClient.setQueryData(["trigger-actor-policy-resources", GitHubConnectionId, "user"], {
      connectionId: GitHubConnectionId,
      familyId: "github",
      kind: "user",
      syncState: "ready",
      items: [
        {
          id: "user-bob",
          familyId: "github",
          kind: "user",
          externalId: "201",
          handle: "bob",
          displayName: "bob",
          status: "accessible",
          metadata: {},
        },
      ],
    });

    renderFormWithOptions({
      mode: "create",
      onValueChange: (key, value) => {
        changedKey = key;
        changedValue = value;
      },
      values: buildFormValues({
        eventIds: [conditionId],
        eventActorPolicies: {},
        eventParameterRules: {
          [conditionId]: {},
        },
      }),
      webhookEventOptions: [eventOption],
      connections: [
        {
          id: GitHubConnectionId,
          targetKey: "github-cloud",
          displayName: GitHubConnectionLabel,
          status: "active",
          resources: [
            {
              kind: "user",
              selectionMode: "multi",
              count: 1,
              syncState: "ready",
            },
          ],
          createdAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z",
        },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Add actor condition" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Actor is not one of" }));

    const actorInput = screen.getByPlaceholderText("Search actors");
    const chipToolbar = actorInput.closest('[data-slot="combobox-chips"]');
    if (chipToolbar === null) {
      throw new Error("Expected actor picker chip toolbar.");
    }
    fireEvent.click(chipToolbar);
    fireEvent.click(screen.getByText(/bob/));

    expect(changedKey).toBe("eventActorPolicies");
    expect(changedValue).toEqual({
      [conditionId]: {
        noneOf: [
          {
            kind: "resource",
            actor: {
              resourceKind: "user",
              resourceId: "user-bob",
            },
          },
        ],
      },
    });
  });

  it("keeps a specific actor condition row after clearing its selected actors", () => {
    const eventOption = createGithubIssueCommentCreatedEventOption({
      actor: {
        resourceReferences: [
          {
            resourceKind: "user",
            handlePayloadPath: ["sender", "login"],
          },
        ],
      },
      resourceDefinitions: [
        {
          kind: "user",
          selectionMode: "multi",
          bindingField: "users",
          displayNameSingular: "user",
          displayNamePlural: "users",
        },
        {
          kind: "org",
          selectionMode: "multi",
          bindingField: "orgs",
          displayNameSingular: "organization",
          displayNamePlural: "organizations",
        },
      ],
      resourceRelationshipDefinitions: [
        {
          relationshipKind: "belongs_to",
          subjectResourceKind: "user",
          objectResourceKind: "org",
          displayName: "Organization members",
          scopeDefinitions: [
            {
              scopeKind: "org",
            },
          ],
        },
      ],
    });
    const conditionId = createWebhookTriggerEventConditionId({
      eventOptionId: eventOption.id,
      index: 0,
    });
    const initialValues = buildFormValues({
      eventIds: [conditionId],
      eventActorPolicies: {
        [conditionId]: {
          anyOf: [
            {
              kind: "resource",
              actor: {
                resourceKind: "user",
                resourceId: "user-alice",
              },
            },
            {
              kind: "relationship",
              relationshipKind: "belongs_to",
              actorSet: {
                resourceKind: "org",
                resourceId: "org-mistlehq",
              },
              scope: {
                resourceKind: "org",
                resourceId: "org-mistlehq",
              },
            },
          ],
        },
      },
      eventParameterRules: {
        [conditionId]: {},
      },
    });
    let latestValues = initialValues;
    TestQueryClient.setQueryData(["trigger-actor-policy-resources", GitHubConnectionId, "user"], {
      connectionId: GitHubConnectionId,
      familyId: "github",
      kind: "user",
      syncState: "ready",
      items: [
        {
          id: "user-alice",
          familyId: "github",
          kind: "user",
          externalId: "200",
          handle: "alice",
          displayName: "alice",
          status: "accessible",
          metadata: {},
        },
      ],
    });

    function isActorPolicyMap(
      value: Parameters<NonNullable<RenderFormOptions["onValueChange"]>>[1],
    ): value is NonNullable<WebhookTriggerFormValues["eventActorPolicies"]> {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
      }

      return Object.values(value).every(
        (policy) => typeof policy === "object" && policy !== null && "anyOf" in policy,
      );
    }

    function ControlledForm(): React.JSX.Element {
      const [values, setValues] = useState(initialValues);
      latestValues = values;

      return createFormElement({
        mode: "create",
        onValueChange: (key, value) => {
          if (key !== "eventActorPolicies" || !isActorPolicyMap(value)) {
            return;
          }

          setValues((currentValues) => ({
            ...currentValues,
            eventActorPolicies: value,
          }));
        },
        values,
        webhookEventOptions: [eventOption],
        connections: [
          {
            id: GitHubConnectionId,
            targetKey: "github-cloud",
            displayName: GitHubConnectionLabel,
            status: "active",
            resources: [
              {
                kind: "user",
                selectionMode: "multi",
                count: 1,
                syncState: "ready",
              },
              {
                kind: "org",
                selectionMode: "multi",
                count: 1,
                syncState: "ready",
              },
            ],
            createdAt: "2026-06-28T00:00:00.000Z",
            updatedAt: "2026-06-28T00:00:00.000Z",
          },
        ],
      });
    }

    render(<ControlledForm />);

    const aliceChip = screen.getByText(/alice/).closest('[data-slot="combobox-chip"]');
    if (!(aliceChip instanceof HTMLElement)) {
      throw new Error("Expected selected alice chip.");
    }
    fireEvent.click(within(aliceChip).getByRole("button"));

    expect(latestValues.eventActorPolicies).toEqual({
      [conditionId]: {
        anyOf: [
          {
            kind: "relationship",
            relationshipKind: "belongs_to",
            actorSet: {
              resourceKind: "org",
              resourceId: "org-mistlehq",
            },
            scope: {
              resourceKind: "org",
              resourceId: "org-mistlehq",
            },
          },
        ],
      },
    });
    const oneOfLabel = screen.getByText("one of");
    const isInLabel = screen.getByText("Is in");
    expect(oneOfLabel.compareDocumentPosition(isInLabel)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByPlaceholderText("Search actors")).toBeDefined();
  });

  it("keeps a new relationship actor condition as one editable row after selecting the first group", () => {
    const eventOption = createGithubIssueCommentCreatedEventOption({
      actor: {
        resourceReferences: [
          {
            resourceKind: "user",
            handlePayloadPath: ["sender", "login"],
          },
        ],
      },
      resourceDefinitions: [
        {
          kind: "user",
          selectionMode: "multi",
          bindingField: "users",
          displayNameSingular: "user",
          displayNamePlural: "users",
        },
        {
          kind: "team",
          selectionMode: "multi",
          bindingField: "teams",
          displayNameSingular: "team",
          displayNamePlural: "teams",
        },
      ],
      resourceRelationshipDefinitions: [
        {
          relationshipKind: "belongs_to",
          subjectResourceKind: "user",
          objectResourceKind: "team",
          displayName: "Team members",
          scopeDefinitions: [
            {
              scopeKind: "team",
            },
          ],
        },
      ],
    });
    const conditionId = createWebhookTriggerEventConditionId({
      eventOptionId: eventOption.id,
      index: 0,
    });
    const initialValues = buildFormValues({
      eventIds: [conditionId],
      eventActorPolicies: {},
      eventParameterRules: {
        [conditionId]: {},
      },
    });

    function isActorPolicyMap(
      value: Parameters<NonNullable<RenderFormOptions["onValueChange"]>>[1],
    ): value is NonNullable<WebhookTriggerFormValues["eventActorPolicies"]> {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
      }

      return Object.values(value).every(
        (policy) => typeof policy === "object" && policy !== null && "anyOf" in policy,
      );
    }

    TestQueryClient.setQueryData(["trigger-actor-policy-resources", GitHubConnectionId, "team"], {
      connectionId: GitHubConnectionId,
      familyId: "github",
      kind: "team",
      syncState: "ready",
      items: [
        {
          id: "team-platform",
          familyId: "github",
          kind: "team",
          externalId: "100",
          handle: "mistle/platform",
          displayName: "Platform",
          status: "accessible",
          metadata: {},
        },
        {
          id: "team-security",
          familyId: "github",
          kind: "team",
          externalId: "101",
          handle: "mistle/security",
          displayName: "Security",
          status: "accessible",
          metadata: {},
        },
      ],
    });

    function ControlledForm(): React.JSX.Element {
      const [values, setValues] = useState(initialValues);

      return createFormElement({
        mode: "create",
        onValueChange: (key, value) => {
          if (key !== "eventActorPolicies" || !isActorPolicyMap(value)) {
            return;
          }

          setValues((currentValues) => ({
            ...currentValues,
            eventActorPolicies: value,
          }));
        },
        values,
        webhookEventOptions: [eventOption],
        connections: [
          {
            id: GitHubConnectionId,
            targetKey: "github-cloud",
            displayName: GitHubConnectionLabel,
            status: "active",
            resources: [
              {
                kind: "user",
                selectionMode: "multi",
                count: 1,
                syncState: "ready",
              },
              {
                kind: "team",
                selectionMode: "multi",
                count: 2,
                syncState: "ready",
              },
            ],
            createdAt: "2026-06-28T00:00:00.000Z",
            updatedAt: "2026-06-28T00:00:00.000Z",
          },
        ],
      });
    }

    render(<ControlledForm />);

    fireEvent.click(screen.getByRole("button", { name: "Add actor condition" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Actor is in group or set" }));

    const groupInput = screen.getByLabelText("group or set");
    const chipToolbar = groupInput.closest('[data-slot="combobox-chips"]');
    if (chipToolbar === null) {
      throw new Error("Expected group picker chip toolbar.");
    }
    fireEvent.click(chipToolbar);

    const platformOption = screen.getByText("Platform").closest('[role="option"]');
    if (platformOption === null) {
      throw new Error("Expected Platform option.");
    }
    fireEvent.click(platformOption);

    expect(screen.getAllByText("Is in")).toHaveLength(1);
    expect(screen.getByText("Security")).toBeDefined();

    const platformChip = screen
      .getAllByText("Platform")
      .map((element) => element.closest('[data-slot="combobox-chip"]'))
      .find((element) => element instanceof HTMLElement);
    if (!(platformChip instanceof HTMLElement)) {
      throw new Error("Expected selected Platform chip.");
    }
    fireEvent.click(within(platformChip).getByRole("button"));

    expect(screen.getAllByText("Is in")).toHaveLength(1);
    expect(screen.getByPlaceholderText("Search groups")).toBeDefined();
  });

  it("keeps the group picker open while replacing an existing relationship policy", () => {
    const eventOption = createGithubIssueCommentCreatedEventOption({
      actor: {
        resourceReferences: [
          {
            resourceKind: "user",
            handlePayloadPath: ["sender", "login"],
          },
        ],
      },
      resourceDefinitions: [
        {
          kind: "user",
          selectionMode: "multi",
          bindingField: "users",
          displayNameSingular: "user",
          displayNamePlural: "users",
        },
        {
          kind: "organization",
          selectionMode: "multi",
          bindingField: "organizations",
          displayNameSingular: "organization",
          displayNamePlural: "organizations",
        },
        {
          kind: "team",
          selectionMode: "multi",
          bindingField: "teams",
          displayNameSingular: "team",
          displayNamePlural: "teams",
        },
      ],
      resourceRelationshipDefinitions: [
        {
          relationshipKind: "belongs_to",
          subjectResourceKind: "user",
          objectResourceKind: "organization",
          displayName: "Organization members",
          scopeDefinitions: [
            {
              scopeKind: "organization",
            },
          ],
        },
        {
          relationshipKind: "belongs_to",
          subjectResourceKind: "user",
          objectResourceKind: "team",
          displayName: "Team members",
          scopeDefinitions: [
            {
              scopeKind: "team",
            },
          ],
        },
      ],
    });
    const conditionId = createWebhookTriggerEventConditionId({
      eventOptionId: eventOption.id,
      index: 0,
    });
    const initialValues = buildFormValues({
      eventIds: [conditionId],
      eventActorPolicies: {
        [conditionId]: {
          anyOf: [
            {
              kind: "relationship",
              relationshipKind: "belongs_to",
              actorSet: {
                resourceKind: "team",
                resourceId: "team-platform",
              },
              scope: {
                resourceKind: "team",
                resourceId: "team-platform",
              },
            },
          ],
        },
      },
      eventParameterRules: {
        [conditionId]: {},
      },
    });
    let latestValues = initialValues;

    function isActorPolicyMap(
      value: Parameters<NonNullable<RenderFormOptions["onValueChange"]>>[1],
    ): value is NonNullable<WebhookTriggerFormValues["eventActorPolicies"]> {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
      }

      return Object.values(value).every(
        (policy) => typeof policy === "object" && policy !== null && "anyOf" in policy,
      );
    }

    TestQueryClient.setQueryData(
      ["trigger-actor-policy-resources", GitHubConnectionId, "organization"],
      {
        connectionId: GitHubConnectionId,
        familyId: "github",
        kind: "organization",
        syncState: "ready",
        items: [
          {
            id: "organization-mistle",
            familyId: "github",
            kind: "organization",
            externalId: "200",
            handle: "mistlehq",
            displayName: "Mistle",
            status: "accessible",
            metadata: {},
          },
        ],
      },
    );
    TestQueryClient.setQueryData(["trigger-actor-policy-resources", GitHubConnectionId, "team"], {
      connectionId: GitHubConnectionId,
      familyId: "github",
      kind: "team",
      syncState: "ready",
      items: [
        {
          id: "team-platform",
          familyId: "github",
          kind: "team",
          externalId: "100",
          handle: "mistle/platform",
          displayName: "Platform",
          status: "accessible",
          metadata: {},
        },
      ],
    });

    function ControlledForm(): React.JSX.Element {
      const [values, setValues] = useState(initialValues);
      latestValues = values;

      return createFormElement({
        mode: "create",
        onValueChange: (key, value) => {
          if (key !== "eventActorPolicies") {
            return;
          }
          if (!isActorPolicyMap(value)) {
            throw new Error("Expected actor policy map update.");
          }

          setValues((currentValues) => ({
            ...currentValues,
            eventActorPolicies: value,
          }));
        },
        values,
        webhookEventOptions: [eventOption],
        connections: [
          {
            id: GitHubConnectionId,
            targetKey: "github-cloud",
            displayName: GitHubConnectionLabel,
            status: "active",
            resources: [
              {
                kind: "user",
                selectionMode: "multi",
                count: 2,
                syncState: "ready",
              },
              {
                kind: "organization",
                selectionMode: "multi",
                count: 1,
                syncState: "ready",
              },
              {
                kind: "team",
                selectionMode: "multi",
                count: 1,
                syncState: "ready",
              },
            ],
            createdAt: "2026-06-28T00:00:00.000Z",
            updatedAt: "2026-06-28T00:00:00.000Z",
          },
        ],
      });
    }

    render(<ControlledForm />);

    expect(screen.getByText("Is in")).toBeDefined();
    expect(screen.getByText("Platform")).toBeDefined();
    expect(latestValues.eventActorPolicies).toEqual(initialValues.eventActorPolicies);
  });

  it("keeps existing actor policies when opening the specific actor picker", () => {
    const eventOption = createGithubIssueCommentCreatedEventOption({
      actor: {
        resourceReferences: [
          {
            resourceKind: "user",
            handlePayloadPath: ["sender", "login"],
          },
        ],
      },
      resourceDefinitions: [
        {
          kind: "user",
          selectionMode: "multi",
          bindingField: "users",
          displayNameSingular: "user",
          displayNamePlural: "users",
        },
      ],
    });
    const conditionId = createWebhookTriggerEventConditionId({
      eventOptionId: eventOption.id,
      index: 0,
    });
    let changedKey: keyof WebhookTriggerFormValues | null = null;
    let changedValue: unknown;

    renderFormWithOptions({
      mode: "create",
      onValueChange: (key, value) => {
        changedKey = key;
        changedValue = value;
      },
      values: buildFormValues({
        eventIds: [conditionId],
        eventParameterRules: {
          [conditionId]: {},
        },
      }),
      webhookEventOptions: [eventOption],
    });

    fireEvent.click(screen.getByRole("button", { name: "Add actor condition" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Actor is one of" }));

    expect(screen.getAllByLabelText("actor").length).toBeGreaterThan(0);
    expect(changedKey).toBeNull();
    expect(changedValue).toBeUndefined();
  });

  it("hides conversation grouping when no triggers are selected", () => {
    const { container } = renderFormWithOptions({
      mode: "create",
      values: buildFormValues({
        eventIds: [],
        conversationKeyTemplate: "",
      }),
    });

    expect(within(container).queryByText("Group events by")).toBeNull();
  });

  it("shows the message template and agent instructions editors", () => {
    const { container } = renderForm("create");
    const currentForm = within(container);

    expect(currentForm.getByRole("textbox", { name: "User message" })).toBeDefined();
    expect(
      currentForm.getByRole("textbox", { name: "Agent Instructions for Trigger" }),
    ).toBeDefined();
    const editors = container.querySelectorAll('[data-slot="agent-instructions-editor"]');
    const messageTemplateEditor = editors[0];

    if (!(messageTemplateEditor instanceof HTMLElement)) {
      throw new Error("Expected the message template editor to be rendered.");
    }

    expect(messageTemplateEditor.getAttribute("data-editor-state")).toBe("empty");
    expect(currentForm.queryByRole("heading", { name: "User message" })).toBeNull();
  });

  it("renders events before the agent instructions editor and message template editor", () => {
    const { container } = renderFormWithOptions({
      mode: "create",
    });

    const currentForm = within(container);
    const [eventsHeading] = currentForm.getAllByRole("heading", { name: "When this happens" });
    const triggerInstructionsField = currentForm.getByRole("textbox", {
      name: "Agent Instructions for Trigger",
    });
    const inputTemplateField = currentForm.getByRole("textbox", { name: "User message" });

    if (eventsHeading === undefined) {
      throw new Error("Expected events heading to be rendered.");
    }

    expect(
      Boolean(
        eventsHeading.compareDocumentPosition(triggerInstructionsField) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(
      Boolean(
        triggerInstructionsField.compareDocumentPosition(inputTemplateField) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    expect(container.textContent?.indexOf("When this happens")).toBeLessThan(
      container.textContent?.indexOf("Agent Instructions for Trigger") ?? Number.POSITIVE_INFINITY,
    );
    expect(container.textContent?.indexOf("Agent Instructions for Trigger")).toBeLessThan(
      container.textContent?.indexOf("User message") ?? Number.POSITIVE_INFINITY,
    );
  });

  it.each(["Agent Instructions for Trigger", "User message"])(
    "opens resource reference completions in the %s editor",
    async (editorName) => {
      const resourceBackedEventOption = createGithubIssueCommentCreatedEventOption({
        parameters: [
          {
            id: "sender",
            label: "sender",
            kind: "resource-select",
            resourceKind: "user",
            payloadPath: ["sender", "login"],
          },
        ],
      });
      for (const resourceKind of resolveTriggerInstructionResourceKinds({
        selectedEventOptions: [resourceBackedEventOption],
      })) {
        TestQueryClient.setQueryData(
          createTriggerParameterResourceQueryKey({
            connectionId: GitHubConnectionId,
            resourceKind,
          }),
          {
            connectionId: GitHubConnectionId,
            familyId: "github",
            kind: resourceKind,
            syncState: "syncing",
            items:
              resourceKind === "user"
                ? [
                    {
                      id: "rsc_github_jonathan",
                      familyId: "github",
                      kind: "user",
                      externalId: "991203",
                      handle: "jon-low",
                      displayName: "Jonathan Low",
                      status: "accessible",
                      metadata: {},
                    },
                  ]
                : [],
          },
        );
      }
      renderFormWithOptions({
        mode: "edit",
        values: buildFormValues({
          eventIds: [resourceBackedEventOption.id],
        }),
        webhookEventOptions: [resourceBackedEventOption],
      });

      const editorView = getEditorViewByName(editorName);
      editorView.focus();
      editorView.dispatch({
        changes: {
          from: 0,
          to: editorView.state.doc.length,
          insert: "Ask @",
        },
        selection: {
          anchor: "Ask @".length,
        },
      });

      let option: HTMLElement | null = null;
      await waitFor(() => {
        option = screen.getByText("Jonathan Low").closest('[role="option"]');
        expect(option).toBeTruthy();
      });

      if (option === null) {
        throw new Error("Expected Jonathan Low resource completion option.");
      }

      fireEvent.mouseDown(option);
      fireEvent.click(option);
      expect(editorView.state.doc.toString()).toBe(
        "Ask @Jonathan Low (GitHub Engineering user ID: 991203)",
      );
    },
  );

  it("renders the trigger name field without an inline edit-name control on create", () => {
    const { container } = renderFormWithOptions({
      mode: "create",
      values: buildFormValues({
        name: "",
      }),
    });
    const form = within(container);
    const triggerNameInput = form.getAllByRole("textbox")[0];

    if (triggerNameInput === undefined) {
      throw new Error("Expected trigger name input to be rendered.");
    }

    expect(triggerNameInput).toBeDefined();
    expect(form.queryByDisplayValue("Your trigger")).toBeNull();
    expect(form.queryByRole("button", { name: "Edit trigger name" })).toBeNull();
  });

  it("renders edit-page save access in the header and keeps activity and delete under more actions", () => {
    let deleteCount = 0;
    let duplicateCount = 0;
    let submitCount = 0;
    let viewActivityCount = 0;

    renderFormWithOptions({
      mode: "edit",
      onDelete: () => {
        deleteCount += 1;
      },
      onDuplicate: () => {
        duplicateCount += 1;
      },
      onSubmit: () => {
        submitCount += 1;
      },
      onViewActivity: () => {
        viewActivityCount += 1;
      },
      values: buildFormValues(),
    });

    const saveButtons = screen.getAllByRole("button", { name: "Save" });

    expect(saveButtons).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Delete trigger" })).toBeNull();

    const [headerSaveButton, footerSaveButton] = saveButtons;
    if (headerSaveButton === undefined || footerSaveButton === undefined) {
      throw new Error("Expected header and footer save buttons.");
    }

    fireEvent.click(headerSaveButton);
    fireEvent.click(footerSaveButton);
    expect(submitCount).toBe(2);

    fireEvent.click(screen.getByRole("button", { name: "More trigger actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "View Activity" }));
    fireEvent.click(screen.getByRole("button", { name: "More trigger actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate trigger" }));
    fireEvent.click(screen.getByRole("button", { name: "More trigger actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete trigger" }));

    expect(viewActivityCount).toBe(1);
    expect(duplicateCount).toBe(1);
    expect(deleteCount).toBe(1);
  });

  it("disables the already-open delete action while the edit page is saving", () => {
    let deleteCount = 0;
    const enabledInput: RenderFormOptions = {
      mode: "edit",
      onDelete: () => {
        deleteCount += 1;
      },
      values: buildFormValues(),
    };
    const { rerender } = renderFormWithOptions(enabledInput);

    fireEvent.click(screen.getByRole("button", { name: "More trigger actions" }));
    rerender(createFormElement({ ...enabledInput, isSaving: true }));

    const deleteMenuItem = screen.getByRole("menuitem", { name: "Delete trigger" });
    expect(deleteMenuItem.getAttribute("data-disabled")).not.toBeNull();

    fireEvent.click(deleteMenuItem);
    expect(deleteCount).toBe(0);
  });

  it("disables the already-open duplicate and delete actions while duplicate is pending", () => {
    let duplicateCount = 0;
    let deleteCount = 0;
    const enabledInput: RenderFormOptions = {
      mode: "edit",
      onDelete: () => {
        deleteCount += 1;
      },
      onDuplicate: () => {
        duplicateCount += 1;
      },
      values: buildFormValues(),
    };
    const { rerender } = renderFormWithOptions(enabledInput);

    fireEvent.click(screen.getByRole("button", { name: "More trigger actions" }));
    rerender(createFormElement({ ...enabledInput, isDuplicating: true }));

    const duplicateMenuItem = screen.getByRole("menuitem", { name: "Duplicate trigger" });
    const deleteMenuItem = screen.getByRole("menuitem", { name: "Delete trigger" });
    expect(duplicateMenuItem.getAttribute("data-disabled")).not.toBeNull();
    expect(deleteMenuItem.getAttribute("data-disabled")).not.toBeNull();

    fireEvent.click(duplicateMenuItem);
    fireEvent.click(deleteMenuItem);
    expect(duplicateCount).toBe(0);
    expect(deleteCount).toBe(0);
  });

  it("disables edit controls while duplicate is pending", () => {
    renderFormWithOptions({
      isDuplicating: true,
      mode: "edit",
      values: buildFormValues(),
    });

    expect(
      screen.getAllByRole("button", { name: "Save" }).every((button) => {
        return button.getAttribute("disabled") === "";
      }),
    ).toBe(true);
    expect(screen.getByRole("button", { name: "Add condition" }).getAttribute("disabled")).toBe("");
    expect(
      screen
        .getByRole("button", { name: "Remove Issue comment created event" })
        .getAttribute("disabled"),
    ).toBe("");
    const instructionsEditor = screen.getByRole("textbox", {
      name: "Agent Instructions for Trigger",
    });
    const instructionsEditorShell = instructionsEditor.closest('[aria-disabled="true"]');
    expect(instructionsEditorShell).not.toBeNull();
  });

  it("shows the selected-profile trigger binding message when triggers are unavailable", () => {
    renderFormWithOptions({
      mode: "create",
      triggerPickerDisabledState: {
        reason:
          "The sandbox profile Repo Maintainer has no event-capable integrations connected. Add an integration like GitHub or Slack to enable event triggers.",
        variant: "default",
      },
      webhookEventOptions: [],
      values: buildFormValues({
        eventIds: [],
        conversationKeyTemplate: "",
      }),
    });

    expect(
      screen.getAllByText(
        "The sandbox profile Repo Maintainer has no event-capable integrations connected. Add an integration like GitHub or Slack to enable event triggers.",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("shows sandbox profile status messages above the form fields", () => {
    renderFormWithOptions({
      mode: "create",
      sandboxProfileStatusMessage: {
        message:
          "The sandbox profile Repo Maintainer has no active version. Publish the profile before creating triggers.",
        variant: "alert",
      },
      triggerPickerDisabledState: {
        reason: "Select a sandbox profile with an active version to choose events.",
        variant: "default",
      },
      webhookEventOptions: [],
      values: buildFormValues({
        eventIds: [],
        conversationKeyTemplate: "",
      }),
    });

    const profileMessage = screen.getByText(
      "The sandbox profile Repo Maintainer has no active version. Publish the profile before creating triggers.",
    );
    const sandboxProfileLabel = screen.getByText("Sandbox profile");
    const eventsMessage = screen.getByText(
      "Select a sandbox profile with an active version to choose events.",
    );

    expect(profileMessage.compareDocumentPosition(sandboxProfileLabel)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(profileMessage.compareDocumentPosition(eventsMessage)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("marks invalid controls with aria-invalid when field errors are present", () => {
    const { container } = render(
      <QueryClientProvider client={TestQueryClient}>
        <WebhookTriggerForm
          connectionOptions={ConnectionOptions}
          connections={Connections}
          fieldErrors={{
            name: "Trigger name is required.",
            sandboxProfileId: "Select a sandbox profile.",
            conversationKeyTemplate: "Select a supported conversation grouping.",
            inputTemplate: "User message is required.",
          }}
          formError={null}
          validationSummaryError={null}
          isDeleting={false}
          isDuplicating={false}
          isSaving={false}
          mode="create"
          onDelete={null}
          onDuplicate={null}
          onSubmit={() => {}}
          onValueChange={() => {}}
          sandboxProfileOptions={SandboxProfileOptions}
          triggerPickerDisabledState={null}
          webhookEventOptions={WebhookEventOptions}
          values={FormValues}
        />
      </QueryClientProvider>,
    );

    const currentForm = within(container);
    const triggerNameInput = currentForm.getByDisplayValue("Repo triage");
    const inputTemplateEditor = currentForm.getByRole("textbox", { name: "User message" });

    expect(triggerNameInput.getAttribute("aria-invalid")).toBe("true");
    expect(inputTemplateEditor.getAttribute("aria-invalid")).toBe("true");

    const invalidSelectTriggers = [
      ...container.querySelectorAll('[data-slot="select-trigger"]'),
    ].filter((selectTrigger) => selectTrigger.getAttribute("aria-invalid") === "true");
    expect(invalidSelectTriggers).toHaveLength(2);
  });

  it("marks invalid invocation token filters and shows the error under the field", () => {
    const invocationTokenEventOption = createGithubIssueCommentCreatedEventOption({
      parameters: [createInvocationTokenParameter(["comment", "body"])],
    });

    renderFormWithOptions({
      fieldErrors: {
        eventParameterRules: {
          triggerId: invocationTokenEventOption.id,
          parameterId: "invocationToken",
          message: "Invocation token filters cannot contain whitespace.",
        },
      },
      values: buildFormValues({
        eventParameterRules: {
          [invocationTokenEventOption.id]: {
            invocationToken: {
              operator: WebhookTriggerEventParameterRuleOperators.CONTAINS_TOKEN,
              value: "JIRA ticket created:",
            },
          },
        },
      }),
      webhookEventOptions: [invocationTokenEventOption],
    });

    const invocationTokenInput = screen.getByRole("textbox", { name: "invocation token" });
    expect(invocationTokenInput.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Invocation token filters cannot contain whitespace.")).toBeDefined();
  });

  it("marks only the invalid invocation token field when duplicate conditions share a parameter id", () => {
    const invocationTokenEventOption = createGithubIssueCommentCreatedEventOption({
      parameters: [createInvocationTokenParameter(["comment", "body"])],
    });
    const firstConditionId = createWebhookTriggerEventConditionId({
      eventOptionId: invocationTokenEventOption.id,
      index: 0,
    });
    const secondConditionId = createWebhookTriggerEventConditionId({
      eventOptionId: invocationTokenEventOption.id,
      index: 1,
    });

    renderFormWithOptions({
      fieldErrors: {
        eventParameterRules: {
          triggerId: secondConditionId,
          parameterId: "invocationToken",
          message: "Invocation token filters cannot contain whitespace.",
        },
      },
      values: buildFormValues({
        eventIds: [firstConditionId, secondConditionId],
        eventParameterRules: {
          [firstConditionId]: {
            invocationToken: {
              operator: WebhookTriggerEventParameterRuleOperators.CONTAINS_TOKEN,
              value: "jira-ticket-created",
            },
          },
          [secondConditionId]: {
            invocationToken: {
              operator: WebhookTriggerEventParameterRuleOperators.CONTAINS_TOKEN,
              value: "JIRA ticket created:",
            },
          },
        },
      }),
      webhookEventOptions: [invocationTokenEventOption],
    });

    const invocationTokenInputs = screen.getAllByRole("textbox", { name: "invocation token" });
    const [firstInput, secondInput] = invocationTokenInputs;
    if (firstInput === undefined || secondInput === undefined) {
      throw new Error("Expected duplicate invocation token fields.");
    }

    expect(invocationTokenInputs).toHaveLength(2);
    expect(firstInput.getAttribute("aria-invalid")).toBeNull();
    expect(secondInput.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Invocation token filters cannot contain whitespace.")).toBeDefined();
  });

  it("shows the required-fields summary and inline copy for generic input template errors", () => {
    render(
      <QueryClientProvider client={TestQueryClient}>
        <WebhookTriggerForm
          connectionOptions={ConnectionOptions}
          connections={Connections}
          fieldErrors={{
            name: "Trigger name is required.",
            sandboxProfileId: "Select a sandbox profile.",
            eventIds: "Please add an event",
            inputTemplate: "User message is required.",
          }}
          formError={null}
          validationSummaryError="Please address the fields highlighted in red."
          isDeleting={false}
          isDuplicating={false}
          isSaving={false}
          mode="create"
          onDelete={null}
          onDuplicate={null}
          onSubmit={() => {}}
          onValueChange={() => {}}
          sandboxProfileOptions={SandboxProfileOptions}
          triggerPickerDisabledState={null}
          webhookEventOptions={WebhookEventOptions}
          values={{
            ...FormValues,
            name: "",
            sandboxProfileId: "",
            primaryRepositoryId: "",
            eventIds: [],
            inputTemplate: "",
            instructions: "",
            conversationKeyTemplate: "",
          }}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText("Please address the fields highlighted in red.")).toBeDefined();
    expect(screen.getByText("Trigger name is required.")).toBeDefined();
    expect(screen.getByText("Select a sandbox profile.")).toBeDefined();
    expect(screen.getAllByText("User message is required.").length).toBeGreaterThan(0);
    expect(screen.getByText("Please add an event")).toBeDefined();
    expect(screen.getAllByRole("status").length).toBeGreaterThanOrEqual(3);
  });

  it("shows save failures at the top of the form", () => {
    const { container } = render(
      <QueryClientProvider client={TestQueryClient}>
        <WebhookTriggerForm
          connectionOptions={ConnectionOptions}
          connections={Connections}
          fieldErrors={{}}
          formError="The selected events do not support this trigger setup."
          validationSummaryError={null}
          isDeleting={false}
          isDuplicating={false}
          isSaving={false}
          mode="create"
          onDelete={null}
          onDuplicate={null}
          onSubmit={() => {}}
          onValueChange={() => {}}
          sandboxProfileOptions={SandboxProfileOptions}
          triggerPickerDisabledState={null}
          webhookEventOptions={WebhookEventOptions}
          values={FormValues}
        />
      </QueryClientProvider>,
    );

    const currentForm = within(container);

    expect(currentForm.getByText("Trigger could not be saved")).toBeDefined();
    expect(
      currentForm.getByText("The selected events do not support this trigger setup."),
    ).toBeDefined();
  });

  it("shows duplicate failures with the duplicate action title", () => {
    render(
      <QueryClientProvider client={TestQueryClient}>
        <WebhookTriggerForm
          connectionOptions={ConnectionOptions}
          connections={Connections}
          fieldErrors={{}}
          formError="Could not duplicate trigger."
          formErrorTitle="Trigger could not be duplicated"
          validationSummaryError={null}
          isDeleting={false}
          isDuplicating={false}
          isSaving={false}
          mode="edit"
          onDelete={() => {}}
          onDuplicate={() => {}}
          onSubmit={() => {}}
          onValueChange={() => {}}
          sandboxProfileOptions={SandboxProfileOptions}
          triggerPickerDisabledState={null}
          webhookEventOptions={WebhookEventOptions}
          values={FormValues}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText("Trigger could not be duplicated")).toBeDefined();
    expect(screen.getByText("Could not duplicate trigger.")).toBeDefined();
  });

  it("shows the no-trigger helper copy under the message template editor", () => {
    renderFormWithOptions({
      mode: "create",
      values: buildFormValues({
        eventIds: [],
        conversationKeyTemplate: "",
      }),
    });

    expect(screen.getAllByText("Select an event to insert event fields.").length).toBeGreaterThan(
      0,
    );
  });
});
