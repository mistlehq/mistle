import { describe, expect, it } from "vitest";

import type { IntegrationCardViewModel } from "../integrations/directory-model.js";
import {
  IntegrationConnectionMethodIds,
  type IntegrationConnectionMethod,
} from "../integrations/integration-connection-editor.js";
import type { IntegrationConnection } from "../integrations/integrations-service.js";
import {
  buildAvailableIntegrationViewCards,
  buildConnectedIntegrationViewCards,
  buildIntegrationConnectionDetailItems,
  buildIntegrationConnectionResourceItemsByKey,
  buildIntegrationConnectionResourceRequests,
  buildOpenCreateIntegrationConnectionInput,
  buildOpenUpdateIntegrationConnectionInput,
  createIntegrationConnectionResourceKey,
  getIntegrationConnectionResourceSummaries,
  shouldPollIntegrationDetailResources,
  toConnectionMethods,
} from "./integrations-page-view-model.js";

describe("integrations page view model", () => {
  it("passes through connection methods for the editor", () => {
    expect(
      toConnectionMethods([
        {
          id: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
          label: "GitHub App installation",
          kind: "form",
          secretFields: [
            {
              name: "appPrivateKeyPem",
              label: "App private key PEM",
              inputType: "textarea",
            },
            {
              name: "webhookSecret",
              label: "Webhook secret",
              inputType: "password",
            },
          ],
        },
        {
          id: IntegrationConnectionMethodIds.API_KEY,
          label: "API key",
          kind: "form",
          secretFields: [
            {
              name: "apiKey",
              label: "API key",
              inputType: "password",
            },
          ],
        },
      ]),
    ).toEqual([
      {
        id: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
        label: "GitHub App installation",
        kind: "form",
        secretFields: [
          {
            name: "appPrivateKeyPem",
            label: "App private key PEM",
            inputType: "textarea",
          },
          {
            name: "webhookSecret",
            label: "Webhook secret",
            inputType: "password",
          },
        ],
      },
      {
        id: IntegrationConnectionMethodIds.API_KEY,
        label: "API key",
        kind: "form",
        secretFields: [
          {
            name: "apiKey",
            label: "API key",
            inputType: "password",
          },
        ],
      },
    ]);
    expect(toConnectionMethods(undefined)).toEqual([]);
  });

  it("builds connected integration cards with view actions", () => {
    let openedTargetKey: string | null = null;

    const [card] = buildConnectedIntegrationViewCards({
      connectedCards: [createCard({ description: "GitHub", connectionCount: 2 })],
      onOpenTarget: (targetKey) => {
        openedTargetKey = targetKey;
      },
    });

    expect(card?.actionLabel).toBe("View");
    expect(card?.description).toBe("2 connections");
    card?.onAction();
    expect(openedTargetKey).toBe("github");
  });

  it("builds connected integration cards for targets with non-active connections", () => {
    const [card] = buildConnectedIntegrationViewCards({
      connectedCards: [
        createCard({
          description: "GitHub",
          connectionStatuses: ["error"],
        }),
      ],
      onOpenTarget: () => {},
    });

    expect(card?.description).toBe("1 connection");
    expect(card?.actionLabel).toBe("View");
  });

  it("builds available integration cards with add actions and disabled invalid entries", () => {
    let openedTargetKey: string | null = null;

    const [card] = buildAvailableIntegrationViewCards({
      cards: [createCard({ description: "Bring GitHub into Mistle.", connectionMethods: [] })],
      onOpenCreatePage: (targetKey) => {
        openedTargetKey = targetKey;
      },
    });

    expect(card?.actionLabel).toBe("Add");
    expect(card?.actionDisabled).toBe(true);
    card?.onAction();
    expect(openedTargetKey).toBe("github");
  });

  it("builds create inputs from integration cards", () => {
    const input = buildOpenCreateIntegrationConnectionInput(
      createCard({
        description: "Bring GitHub into Mistle.",
        connectionMethods: [
          {
            id: IntegrationConnectionMethodIds.API_KEY,
            label: "API key",
            kind: "form",
            secretFields: [
              {
                name: "apiKey",
                label: "API key",
                inputType: "password",
              },
            ],
          },
        ],
      }),
    );

    expect(input).toEqual({
      mode: "create",
      methods: [
        {
          id: IntegrationConnectionMethodIds.API_KEY,
          label: "API key",
          kind: "form",
          secretFields: [
            {
              name: "apiKey",
              label: "API key",
              inputType: "password",
            },
          ],
        },
      ],
      targetConfig: {},
      targetDisplayName: "GitHub",
      targetFamilyId: "github",
      targetKey: "github",
      targetVariantId: "github-cloud",
    });
  });

  it("builds update inputs from integration cards and connections", () => {
    const card = createCard({
      description: "Bring Jira into Mistle.",
      displayName: "Jira",
      targetKey: "jira-default",
      familyId: "jira",
      variantId: "jira-default",
      connectionMethods: [
        {
          id: "jira-personal-api-token",
          label: "Personal API token",
          kind: "form",
          secretFields: [
            {
              name: "apiKey",
              label: "Personal API token",
              inputType: "password",
            },
          ],
        },
      ],
      connections: [
        createConnection({
          id: "icn_jira",
          status: "active",
          targetKey: "jira-default",
          displayName: "Jira Production",
          connectionMethodId: "jira-personal-api-token",
          connectionMethodLabel: "Personal API token",
          config: {
            connection_method: "jira-personal-api-token",
            site_url: "https://mistle.atlassian.net",
            email: "dev@mistle.so",
          },
        }),
      ],
    });
    const connection = card.connections[0];

    if (connection === undefined) {
      throw new Error("Expected connection test fixture.");
    }

    expect(
      buildOpenUpdateIntegrationConnectionInput({
        card,
        connection,
      }),
    ).toEqual({
      mode: "update",
      connectionConfig: {
        connection_method: "jira-personal-api-token",
        site_url: "https://mistle.atlassian.net",
        email: "dev@mistle.so",
      },
      connectionDisplayName: "Jira Production",
      connectionId: "icn_jira",
      currentMethod: {
        id: "jira-personal-api-token",
        label: "Personal API token",
        kind: "form",
        secretFields: [
          {
            name: "apiKey",
            label: "Personal API token",
            inputType: "password",
          },
        ],
      },
      targetConfig: {},
      targetDisplayName: "Jira",
      targetFamilyId: "jira",
      targetKey: "jira-default",
      targetVariantId: "jira-default",
    });
  });

  it("builds detail items with auth labels and refreshing resource state", () => {
    const [item] = buildIntegrationConnectionDetailItems({
      connections: [
        {
          id: "icn_123",
          targetKey: "github",
          displayName: "Engineering GitHub",
          status: "active",
          config: {
            connection_method: "github-app-installation",
            app_id: "123",
            app_slug: "mistle-github-app",
          },
          connectionMethodId: "github-app-installation",
          connectionMethodLabel: "GitHub App installation",
          externalSubjectId: "mistle-labs",
          resources: [
            {
              kind: "repositories",
              selectionMode: "multi",
              count: 42,
              syncState: "ready",
              lastSyncedAt: "2026-03-11T04:25:00.000Z",
              lastErrorMessage: "Resource sync failed.",
            },
          ],
          createdAt: "2026-03-03T00:00:00.000Z",
          updatedAt: "2026-03-11T04:30:00.000Z",
        } satisfies IntegrationConnection,
      ],
      controlPlaneApiOrigin: "https://control-plane.example.com",
      refreshingResourceKeys: new Set([
        createIntegrationConnectionResourceKey({
          connectionId: "icn_123",
          kind: "repositories",
        }),
      ]),
    });

    expect(item?.authMethodLabel).toBe("GitHub App installation");
    expect(item?.authMethodId).toBe("github-app-installation");
    expect(item?.contextItems).toEqual([
      {
        label: "App ID",
        value: "123",
      },
      {
        label: "App slug",
        value: "mistle-github-app",
      },
      {
        label: "Installation",
        value: "mistle-labs",
      },
    ]);
    expect(item?.setup).toBeUndefined();
    expect(item?.installActionLabel).toBe("Manage installation");
    expect(item?.resources[0]?.isRefreshing).toBe(true);
    expect(item?.resources[0]?.lastErrorMessage).toBe("Resource sync failed.");
  });

  it("builds detail items for Slack bot token connections", () => {
    const [item] = buildIntegrationConnectionDetailItems({
      connections: [
        {
          id: "icn_slack_123",
          targetKey: "slack-default",
          displayName: "Slack Engineering",
          status: "active",
          config: {
            connection_method: "slack-bot-token",
          },
          connectionMethodId: "slack-bot-token",
          connectionMethodLabel: "Bot token",
          createdAt: "2026-03-03T00:00:00.000Z",
          updatedAt: "2026-03-11T04:30:00.000Z",
        } satisfies IntegrationConnection,
      ],
      targetConfig: {},
      targetConnectionMethods: [
        {
          id: "slack-bot-token",
          label: "Bot token",
          kind: "form",
          secretFields: [
            {
              name: "botToken",
              label: "Bot token",
              inputType: "password",
            },
            {
              name: "signingSecret",
              label: "Signing secret",
              inputType: "password",
            },
          ],
        },
      ],
      targetFamilyId: "slack",
      targetVariantId: "slack-default",
      refreshingResourceKeys: new Set<string>(),
    });

    expect(item?.authMethodId).toBe("slack-bot-token");
    expect(item?.authMethodLabel).toBe("Bot token");
    expect(item?.authSecretLabels).toEqual(["Bot token", "Signing secret"]);
  });

  it("builds detail items for AWS assume-role connections", () => {
    const [item] = buildIntegrationConnectionDetailItems({
      connections: [
        {
          id: "icn_aws_123",
          targetKey: "aws-cli-default",
          displayName: "AWS engineering",
          status: "active",
          config: {
            connection_method: "aws-assume-role",
            accessKeyId: "AKIAEXAMPLE",
            roleArn: "arn:aws:iam::123456789012:role/mistle-dev",
          },
          connectionMethodId: "aws-assume-role",
          connectionMethodLabel: "Access key + AssumeRole",
          createdAt: "2026-03-03T00:00:00.000Z",
          updatedAt: "2026-03-11T04:30:00.000Z",
        } satisfies IntegrationConnection,
      ],
      refreshingResourceKeys: new Set<string>(),
    });

    expect(item?.authMethodId).toBe("aws-assume-role");
    expect(item?.authMethodLabel).toBe("Access key + AssumeRole");
  });

  it("marks pre-install GitHub App connections as setup incomplete", () => {
    const [item] = buildIntegrationConnectionDetailItems({
      connections: [
        {
          id: "icn_preinstall",
          targetKey: "github",
          displayName: "Pre-install GitHub",
          status: "active",
          config: {
            connection_method: "github-app-installation",
            app_id: "123",
            app_slug: "mistle-github-app",
          },
          connectionMethodId: "github-app-installation",
          connectionMethodLabel: "GitHub App installation",
          createdAt: "2026-03-03T00:00:00.000Z",
          updatedAt: "2026-03-11T04:30:00.000Z",
        } satisfies IntegrationConnection,
      ],
      controlPlaneApiOrigin: "https://control-plane.example.com",
      refreshingResourceKeys: new Set<string>(),
    });

    expect(item?.installActionLabel).toBe("Install GitHub App");
    expect(item?.setup?.description).toBe(
      "Set these URLs in your GitHub App settings, then install the app.",
    );
    expect(item?.setup?.postInstallationSetupUrl).toBe(
      "https://control-plane.example.com/p/integration/callbacks/github-app-installation",
    );
    expect(item?.contextItems).toEqual([
      {
        label: "App ID",
        value: "123",
      },
      {
        label: "App slug",
        value: "mistle-github-app",
      },
      {
        label: "Installation",
        value: "Pending",
      },
    ]);
  });

  it("builds detail items from server-resolved Jira auth metadata", () => {
    const [item] = buildIntegrationConnectionDetailItems({
      connections: [
        {
          id: "icn_jira_123",
          targetKey: "jira-default",
          displayName: "Jira Engineering",
          status: "active",
          config: {
            connection_method: "jira-service-account-api-token",
          },
          connectionMethodId: "jira-service-account-api-token",
          connectionMethodLabel: "Service account API token",
          createdAt: "2026-03-03T00:00:00.000Z",
          updatedAt: "2026-03-11T04:30:00.000Z",
        } satisfies IntegrationConnection,
      ],
      targetConfig: {},
      targetConnectionMethods: [
        {
          id: "jira-service-account-api-token",
          label: "Service account API token",
          kind: "form",
          secretFields: [
            {
              name: "apiKey",
              label: "Service account API token",
              inputType: "password",
            },
          ],
        },
      ],
      targetFamilyId: "jira",
      targetVariantId: "jira-default",
      refreshingResourceKeys: new Set<string>(),
    });

    expect(item?.authMethodId).toBe("jira-service-account-api-token");
    expect(item?.authMethodLabel).toBe("Service account API token");
  });

  it("includes visible Jira auth config fields in detail items", () => {
    const [item] = buildIntegrationConnectionDetailItems({
      connections: [
        {
          id: "icn_jira_123",
          targetKey: "jira-default",
          displayName: "Jira Engineering",
          status: "active",
          config: {
            connection_method: "jira-personal-api-token",
            site_url: "https://mistle.atlassian.net",
            email: "dev@mistle.so",
          },
          connectionMethodId: "jira-personal-api-token",
          connectionMethodLabel: "Personal API token",
          createdAt: "2026-03-03T00:00:00.000Z",
          updatedAt: "2026-03-11T04:30:00.000Z",
        } satisfies IntegrationConnection,
      ],
      targetConfig: {},
      targetConnectionMethods: [
        {
          id: "jira-personal-api-token",
          label: "Personal API token",
          kind: "form",
          secretFields: [
            {
              name: "apiKey",
              label: "Personal API token",
              inputType: "password",
            },
          ],
        },
      ],
      targetFamilyId: "jira",
      targetVariantId: "jira-default",
      refreshingResourceKeys: new Set<string>(),
    });

    expect(item?.authFields).toEqual([
      {
        label: "Method",
        value: "Personal API token",
      },
      {
        label: "Site URL",
        value: "https://mistle.atlassian.net",
      },
      {
        label: "Email",
        value: "dev@mistle.so",
      },
    ]);
    expect(item?.authSecretLabels).toEqual(["Personal API token"]);
  });

  it("includes GitHub App installation mutation state in detail items", () => {
    const [item] = buildIntegrationConnectionDetailItems({
      connections: [
        {
          id: "icn_preinstall",
          targetKey: "github",
          displayName: "Pre-install GitHub",
          status: "active",
          config: {
            connection_method: "github-app-installation",
            app_id: "123",
            app_slug: "mistle-github-app",
          },
          connectionMethodId: "github-app-installation",
          connectionMethodLabel: "GitHub App installation",
          createdAt: "2026-03-03T00:00:00.000Z",
          updatedAt: "2026-03-11T04:30:00.000Z",
        } satisfies IntegrationConnection,
      ],
      controlPlaneApiOrigin: "https://control-plane.example.com",
      githubAppInstallationStateByConnectionId: new Map([
        [
          "icn_preinstall",
          {
            errorMessage: "Could not start GitHub App installation.",
            isPending: true,
          },
        ],
      ]),
      refreshingResourceKeys: new Set<string>(),
    });

    expect(item?.setup?.isPending).toBe(true);
    expect(item?.setup?.errorMessage).toBe("Could not start GitHub App installation.");
  });

  it("marks syncing resources as refreshing even without a local pending refresh", () => {
    const [item] = buildIntegrationConnectionDetailItems({
      connections: [
        {
          id: "icn_123",
          targetKey: "github",
          displayName: "Engineering GitHub",
          status: "active",
          resources: [
            {
              kind: "repositories",
              selectionMode: "multi",
              count: 42,
              syncState: "syncing",
            },
          ],
          createdAt: "2026-03-03T00:00:00.000Z",
          updatedAt: "2026-03-11T04:30:00.000Z",
        } satisfies IntegrationConnection,
      ],
      refreshingResourceKeys: new Set<string>(),
    });

    expect(item?.resources[0]?.isRefreshing).toBe(true);
  });

  it("disables deletion when a connection is still referenced by webhook automations", () => {
    const [item] = buildIntegrationConnectionDetailItems({
      connections: [
        {
          id: "icn_automation_guarded",
          targetKey: "github",
          displayName: "Engineering GitHub",
          status: "active",
          bindingCount: 0,
          automationCount: 1,
          createdAt: "2026-03-03T00:00:00.000Z",
          updatedAt: "2026-03-11T04:30:00.000Z",
        } satisfies IntegrationConnection,
      ],
      refreshingResourceKeys: new Set<string>(),
    });

    expect(item?.bindingCount).toBe(0);
    expect(item?.canDelete).toBe(false);
  });

  it("returns an empty resource summary list when a connection has no resources payload", () => {
    expect(
      getIntegrationConnectionResourceSummaries({
        resources: undefined,
      }),
    ).toEqual([]);

    expect(getIntegrationConnectionResourceSummaries(null)).toEqual([]);
  });

  it("builds resource requests and keyed resource-item lookups for detail connections", () => {
    const requests = buildIntegrationConnectionResourceRequests([
      createConnection({
        id: "icn_primary",
        status: "active",
        resources: [
          {
            kind: "repositories",
            selectionMode: "multi",
            count: 42,
            syncState: "ready",
          },
        ],
      }),
      createConnection({
        id: "icn_secondary",
        status: "active",
        resources: [
          {
            kind: "organizations",
            selectionMode: "single",
            count: 1,
            syncState: "never-synced",
          },
        ],
      }),
    ]);

    expect(requests).toEqual([
      {
        connectionId: "icn_primary",
        kind: "repositories",
        syncState: "ready",
      },
      {
        connectionId: "icn_secondary",
        kind: "organizations",
        syncState: "never-synced",
      },
    ]);

    const itemsByKey = buildIntegrationConnectionResourceItemsByKey([
      {
        connectionId: "icn_primary",
        state: {
          isLoading: false,
          items: [],
          kind: "repositories",
          errorMessage: null,
        },
      },
    ]);

    expect(
      itemsByKey.get(
        createIntegrationConnectionResourceKey({
          connectionId: "icn_primary",
          kind: "repositories",
        }),
      ),
    ).toEqual({
      isLoading: false,
      items: [],
      kind: "repositories",
      errorMessage: null,
    });
  });

  it("polls while the selected detail connection has syncing resources", () => {
    expect(
      shouldPollIntegrationDetailResources({
        cards: [
          createCard({
            description: "GitHub",
            connections: [
              createConnection({
                id: "icn_syncing",
                status: "active",
                resources: [
                  {
                    kind: "repositories",
                    selectionMode: "multi",
                    count: 42,
                    syncState: "syncing",
                  },
                ],
              }),
            ],
          }),
        ],
        activeDetailConnectionId: "icn_syncing",
        detailTargetKey: "github",
      }),
    ).toBe(true);
  });

  it("stops polling when not on a detail route or no selected resource is syncing", () => {
    expect(
      shouldPollIntegrationDetailResources({
        cards: [createCard({ description: "GitHub" })],
        activeDetailConnectionId: null,
        detailTargetKey: null,
      }),
    ).toBe(false);

    expect(
      shouldPollIntegrationDetailResources({
        cards: [
          createCard({
            description: "GitHub",
            connections: [
              createConnection({
                id: "icn_ready",
                status: "active",
                resources: [
                  {
                    kind: "repositories",
                    selectionMode: "multi",
                    count: 42,
                    syncState: "ready",
                  },
                ],
              }),
            ],
          }),
        ],
        activeDetailConnectionId: "icn_ready",
        detailTargetKey: "github",
      }),
    ).toBe(false);
  });

  it("omits auth metadata when the backend has not resolved a connection method", () => {
    const [item] = buildIntegrationConnectionDetailItems({
      connections: [
        {
          id: "icn_123",
          targetKey: "github",
          displayName: "GitHub 123",
          status: "active",
          config: {
            connection_method: "bearer-token",
          },
          createdAt: "2026-03-03T00:00:00.000Z",
          updatedAt: "2026-03-11T04:30:00.000Z",
        } satisfies IntegrationConnection,
      ],
      refreshingResourceKeys: new Set<string>(),
    });

    expect(item?.authMethodId).toBeNull();
    expect(item?.authMethodLabel).toBeUndefined();
  });
});

function createCard(input: {
  description: string;
  connectionCount?: number;
  connections?: readonly IntegrationConnection[];
  connectionStatuses?: readonly IntegrationConnection["status"][];
  connectionMethods?: readonly IntegrationConnectionMethod[];
  displayName?: string;
  familyId?: string;
  targetKey?: string;
  variantId?: string;
}): IntegrationCardViewModel {
  const targetKey = input.targetKey ?? "github";
  const familyId = input.familyId ?? targetKey;
  const variantId = input.variantId ?? "github-cloud";
  const displayName = input.displayName ?? "GitHub";

  if (input.connections !== undefined) {
    return {
      target: {
        targetKey,
        familyId,
        variantId,
        enabled: true,
        config: {},
        displayName,
        description: input.description,
        ...(input.connectionMethods === undefined
          ? {}
          : { connectionMethods: [...input.connectionMethods] }),
        targetHealth: {
          configStatus: "valid",
        },
      },
      displayName,
      description: input.description,
      status: "Connected",
      configStatus: "valid",
      connections: [...input.connections],
    };
  }

  const connectionStatuses =
    input.connectionStatuses ??
    Array.from<IntegrationConnection["status"]>({ length: input.connectionCount ?? 1 }).fill(
      "active",
    );
  const connections: IntegrationConnection[] = connectionStatuses.map((status, index) => ({
    id: `icn_${index}`,
    targetKey,
    displayName: `${displayName} ${index}`,
    status,
    createdAt: "2026-03-03T00:00:00.000Z",
    updatedAt: "2026-03-11T04:30:00.000Z",
  }));

  return {
    target: {
      targetKey,
      familyId,
      variantId,
      enabled: true,
      config: {},
      displayName,
      description: input.description,
      ...(input.connectionMethods === undefined
        ? {}
        : { connectionMethods: [...input.connectionMethods] }),
      targetHealth: {
        configStatus: "valid",
      },
    },
    displayName,
    description: input.description,
    status: "Connected",
    configStatus: "valid",
    connections,
  };
}

function createConnection(
  input: Partial<IntegrationConnection> & Pick<IntegrationConnection, "id" | "status">,
): IntegrationConnection {
  return {
    id: input.id,
    targetKey: "github",
    displayName: input.displayName ?? `GitHub ${input.id}`,
    status: input.status,
    bindingCount: input.bindingCount ?? 0,
    automationCount: input.automationCount ?? 0,
    createdAt: "2026-03-03T00:00:00.000Z",
    updatedAt: "2026-03-11T04:30:00.000Z",
    ...(input.resources === undefined ? {} : { resources: input.resources }),
    ...(input.config === undefined ? {} : { config: input.config }),
    ...(input.connectionMethodId === undefined
      ? {}
      : { connectionMethodId: input.connectionMethodId }),
    ...(input.connectionMethodLabel === undefined
      ? {}
      : { connectionMethodLabel: input.connectionMethodLabel }),
    ...(input.externalSubjectId === undefined
      ? {}
      : { externalSubjectId: input.externalSubjectId }),
  };
}
