import type { IntegrationWebhookSourceCapability } from "@mistle/integrations-core";
import {
  IntegrationWebhookSourceLifecycles,
  IntegrationWebhookTriggerCapabilitiesProviderMetadataKey,
} from "@mistle/integrations-core";
import { z } from "zod";

import { buildIntegrationWebhookCallbackUrl } from "../../../shared/webhook-callback-url.server.js";
import { LinearConnectionConfigSchema, type LinearConnectionConfig } from "./auth.js";
import {
  LinearManagedWebhookResourceTypes,
  LinearWebhookPermissionRequirements,
} from "./supported-webhook-events.js";
import type { LinearTargetConfig } from "./target-config-schema.js";

const LinearGraphqlEndpoint = "https://api.linear.app/graphql";

const LinearWebhookCreateMutation = `
mutation MistleWebhookCreate($input: WebhookCreateInput!) {
  webhookCreate(input: $input) {
    success
    webhook {
      id
      enabled
    }
  }
}
`;

const LinearWebhookDeleteMutation = `
mutation MistleWebhookDelete($id: String!) {
  webhookDelete(id: $id) {
    success
  }
}
`;

const LinearWebhookListQuery = `
query MistleWebhooks($first: Int!, $after: String) {
  webhooks(first: $first, after: $after) {
    nodes {
      id
      enabled
      allPublicTeams
      label
      resourceTypes
      team {
        id
        key
        name
        visibility
      }
      teamIds
      url
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
`;

const LinearGraphqlErrorSchema = z
  .object({
    message: z.string().min(1),
  })
  .loose();

const LinearWebhookCreateResponseSchema = z
  .object({
    data: z
      .object({
        webhookCreate: z
          .object({
            success: z.boolean(),
            webhook: z
              .object({
                id: z.string().min(1),
                enabled: z.boolean(),
              })
              .loose()
              .nullable(),
          })
          .loose(),
      })
      .loose()
      .optional(),
    errors: z.array(LinearGraphqlErrorSchema).optional(),
  })
  .loose();

const LinearWebhookDeleteResponseSchema = z
  .object({
    data: z
      .object({
        webhookDelete: z
          .object({
            success: z.boolean(),
          })
          .loose(),
      })
      .loose()
      .optional(),
    errors: z.array(LinearGraphqlErrorSchema).optional(),
  })
  .loose();

const LinearWebhookTriggerCapabilitiesRefreshBodySchema = z.object({}).strict();

const LinearWebhookNodeSchema = z
  .object({
    id: z.string().min(1),
    enabled: z.boolean(),
    allPublicTeams: z.boolean().nullable().optional(),
    label: z.string().min(1).nullable().optional(),
    resourceTypes: z.array(z.string().min(1)),
    team: z
      .object({
        id: z.string().min(1),
        key: z.string().min(1),
        name: z.string().min(1),
        visibility: z.string().min(1),
      })
      .loose()
      .nullable()
      .optional(),
    teamIds: z.string().min(1).nullable().optional(),
    url: z.string().min(1),
  })
  .loose();

const LinearWebhookListResponseSchema = z
  .object({
    data: z
      .object({
        webhooks: z
          .object({
            nodes: z.array(LinearWebhookNodeSchema),
            pageInfo: z
              .object({
                hasNextPage: z.boolean(),
                endCursor: z.string().min(1).nullable().optional(),
              })
              .loose(),
          })
          .loose(),
      })
      .loose()
      .optional(),
    errors: z.array(LinearGraphqlErrorSchema).optional(),
  })
  .loose();

type LinearWebhookNode = z.output<typeof LinearWebhookNodeSchema>;

function resolveLinearApiKey(input: {
  connectionSecrets: Record<string, string> | undefined;
}): string {
  const apiKey = input.connectionSecrets?.apiKey;
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error("Linear API key is missing for webhook source registration.");
  }

  return apiKey;
}

function formatLinearGraphqlErrors(
  errors: readonly z.output<typeof LinearGraphqlErrorSchema>[],
): string {
  return errors.map((error) => error.message).join("; ");
}

async function executeLinearGraphql(input: {
  apiKey: string;
  query: string;
  variables: Record<string, unknown>;
}): Promise<unknown> {
  const response = await fetch(LinearGraphqlEndpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: input.apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      query: input.query,
      variables: input.variables,
    }),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Linear GraphQL request failed (${response.status}): ${responseText}`);
  }

  let responseJson: unknown;
  try {
    responseJson = JSON.parse(responseText);
  } catch {
    throw new Error("Linear GraphQL response must be valid JSON.");
  }

  return responseJson;
}

export function parseLinearWebhookCreateResponse(input: unknown): {
  remoteRegistrationId: string;
  enabled: boolean;
} {
  const response = LinearWebhookCreateResponseSchema.parse(input);
  if (response.errors !== undefined && response.errors.length > 0) {
    throw new Error(
      `Linear webhook creation failed: ${formatLinearGraphqlErrors(response.errors)}`,
    );
  }

  const webhookCreate = response.data?.webhookCreate;
  if (webhookCreate === undefined || webhookCreate.success !== true) {
    throw new Error("Linear webhook creation failed.");
  }

  const webhook = webhookCreate.webhook;
  if (webhook === null) {
    throw new Error("Linear webhook creation response is missing webhook.");
  }

  return {
    remoteRegistrationId: webhook.id,
    enabled: webhook.enabled,
  };
}

export function parseLinearWebhookDeleteResponse(input: unknown): void {
  const response = LinearWebhookDeleteResponseSchema.parse(input);
  if (response.errors !== undefined && response.errors.length > 0) {
    throw new Error(
      `Linear webhook deletion failed: ${formatLinearGraphqlErrors(response.errors)}`,
    );
  }

  if (response.data?.webhookDelete.success !== true) {
    throw new Error("Linear webhook deletion failed.");
  }
}

export function parseLinearWebhookListResponse(input: unknown): {
  nodes: readonly LinearWebhookNode[];
  hasNextPage: boolean;
  endCursor?: string | undefined;
} {
  const response = LinearWebhookListResponseSchema.parse(input);
  if (response.errors !== undefined && response.errors.length > 0) {
    throw new Error(`Linear webhook list failed: ${formatLinearGraphqlErrors(response.errors)}`);
  }

  const webhooks = response.data?.webhooks;
  if (webhooks === undefined) {
    throw new Error("Linear webhook list response is missing webhooks.");
  }

  return {
    nodes: webhooks.nodes,
    hasNextPage: webhooks.pageInfo.hasNextPage,
    ...(webhooks.pageInfo.endCursor === null || webhooks.pageInfo.endCursor === undefined
      ? {}
      : { endCursor: webhooks.pageInfo.endCursor }),
  };
}

async function createLinearWebhook(input: {
  apiKey: string;
  callbackUrl: string;
  webhookName: string;
  webhookSecret: string;
}): Promise<{ remoteRegistrationId: string; enabled: boolean }> {
  const response = await executeLinearGraphql({
    apiKey: input.apiKey,
    query: LinearWebhookCreateMutation,
    variables: {
      input: {
        allPublicTeams: true,
        label: input.webhookName,
        resourceTypes: [...LinearManagedWebhookResourceTypes],
        secret: input.webhookSecret,
        url: input.callbackUrl,
      },
    },
  });

  return parseLinearWebhookCreateResponse(response);
}

async function deleteLinearWebhook(input: { apiKey: string; webhookId: string }): Promise<void> {
  const response = await executeLinearGraphql({
    apiKey: input.apiKey,
    query: LinearWebhookDeleteMutation,
    variables: {
      id: input.webhookId,
    },
  });

  parseLinearWebhookDeleteResponse(response);
}

async function findLinearWebhook(input: {
  apiKey: string;
  webhookId: string;
}): Promise<LinearWebhookNode> {
  let after: string | undefined;

  for (let page = 0; page < 50; page += 1) {
    const variables: Record<string, unknown> = { first: 50 };
    if (after !== undefined) {
      variables.after = after;
    }

    const response = await executeLinearGraphql({
      apiKey: input.apiKey,
      query: LinearWebhookListQuery,
      variables,
    });
    const parsedResponse = parseLinearWebhookListResponse(response);
    const matchedWebhook = parsedResponse.nodes.find((webhook) => webhook.id === input.webhookId);
    if (matchedWebhook !== undefined) {
      return matchedWebhook;
    }

    if (!parsedResponse.hasNextPage) {
      break;
    }

    if (parsedResponse.endCursor === undefined) {
      throw new Error("Linear webhook list response is missing next page cursor.");
    }
    after = parsedResponse.endCursor;
  }

  throw new Error(`Linear webhook '${input.webhookId}' was not found.`);
}

function normalizeLinearSupportedResourceTypes(input: {
  resourceTypes: readonly string[];
}): readonly string[] {
  const supportedResourceTypes = new Set<string>(LinearManagedWebhookResourceTypes);
  const normalizedResourceTypes: string[] = [];

  for (const resourceType of input.resourceTypes) {
    if (
      !supportedResourceTypes.has(resourceType) ||
      normalizedResourceTypes.includes(resourceType)
    ) {
      continue;
    }

    normalizedResourceTypes.push(resourceType);
  }

  if (normalizedResourceTypes.length === 0) {
    throw new Error("Linear webhook does not subscribe to any supported resource types.");
  }

  return normalizedResourceTypes;
}

function buildLinearWebhookProviderMetadata(input: {
  allPublicTeams: boolean;
  callbackUrl: string;
  resourceTypes: readonly string[];
  webhookEnabled: boolean;
  webhookName?: string | undefined;
  webhookTeam?: LinearWebhookNode["team"] | undefined;
  webhookTeamIds?: string | undefined;
}): Record<string, unknown> {
  return {
    allPublicTeams: input.allPublicTeams,
    callbackUrl: input.callbackUrl,
    registeredResourceTypes: [...input.resourceTypes],
    ...(input.webhookName === undefined ? {} : { webhookName: input.webhookName }),
    webhookEnabled: input.webhookEnabled,
    ...(input.webhookTeam === null || input.webhookTeam === undefined
      ? {}
      : {
          webhookTeam: {
            id: input.webhookTeam.id,
            key: input.webhookTeam.key,
            name: input.webhookTeam.name,
            visibility: input.webhookTeam.visibility,
          },
        }),
    ...(input.webhookTeamIds === undefined ? {} : { webhookTeamIds: input.webhookTeamIds }),
    [IntegrationWebhookTriggerCapabilitiesProviderMetadataKey]: {
      events: [...input.resourceTypes],
      permissions: [LinearWebhookPermissionRequirements.WORKSPACE_ADMIN],
    },
  };
}

function buildLinearWebhookProviderMetadataFromRemote(input: {
  callbackUrl: string;
  webhook: LinearWebhookNode;
}): Record<string, unknown> {
  if (!input.webhook.enabled) {
    throw new Error(`Linear webhook '${input.webhook.id}' is disabled.`);
  }

  if (input.webhook.url !== input.callbackUrl) {
    throw new Error(
      `Linear webhook '${input.webhook.id}' callback URL does not match this source.`,
    );
  }

  return buildLinearWebhookProviderMetadata({
    allPublicTeams: input.webhook.allPublicTeams === true,
    callbackUrl: input.callbackUrl,
    resourceTypes: normalizeLinearSupportedResourceTypes({
      resourceTypes: input.webhook.resourceTypes,
    }),
    webhookEnabled: input.webhook.enabled,
    ...(input.webhook.label === null || input.webhook.label === undefined
      ? {}
      : { webhookName: input.webhook.label }),
    ...(input.webhook.team === undefined ? {} : { webhookTeam: input.webhook.team }),
    ...(input.webhook.teamIds === null || input.webhook.teamIds === undefined
      ? {}
      : { webhookTeamIds: input.webhook.teamIds }),
  });
}

export const LinearWebhookSourceCapability: IntegrationWebhookSourceCapability<
  LinearTargetConfig,
  Record<string, never>,
  LinearConnectionConfig
> = {
  lifecycle: IntegrationWebhookSourceLifecycles.MANAGED,
  supportsConnection(input) {
    return LinearConnectionConfigSchema.safeParse(input.connection.config).success;
  },
  async describeSource(input) {
    const endpointKey = input.source.endpointKey;
    if (endpointKey === undefined) {
      throw new Error(`Linear webhook source '${input.source.id}' is missing endpointKey.`);
    }

    return {
      displayName: input.source.displayName ?? "Linear webhook",
      callbackUrl: buildIntegrationWebhookCallbackUrl({
        controlPlaneBaseUrl: input.controlPlaneBaseUrl,
        targetKey: input.targetKey,
        endpointKey,
      }),
      providerMetadata: input.source.providerMetadata,
    };
  },
  async createRegistration(input) {
    if (input.connection === undefined) {
      throw new Error("Linear managed webhook registration requires a connection.");
    }

    const webhookSecret = input.webhookSecret;
    if (webhookSecret === undefined || webhookSecret.length === 0) {
      throw new Error("Linear managed webhook registration requires a webhook secret.");
    }

    const endpointKey = input.source.endpointKey;
    if (endpointKey === undefined) {
      throw new Error(`Linear webhook source '${input.source.id}' is missing endpointKey.`);
    }

    const apiKey = resolveLinearApiKey({
      connectionSecrets: input.connectionSecrets,
    });
    const callbackUrl = buildIntegrationWebhookCallbackUrl({
      controlPlaneBaseUrl: input.controlPlaneBaseUrl,
      targetKey: input.targetKey,
      endpointKey,
    });
    const webhookName = `Mistle webhook source ${input.source.id}`;
    const createdWebhook = await createLinearWebhook({
      apiKey,
      callbackUrl,
      webhookName,
      webhookSecret,
    });

    return {
      remoteRegistrationId: createdWebhook.remoteRegistrationId,
      providerMetadata: buildLinearWebhookProviderMetadata({
        allPublicTeams: true,
        callbackUrl,
        resourceTypes: LinearManagedWebhookResourceTypes,
        webhookEnabled: createdWebhook.enabled,
        webhookName,
      }),
    };
  },
  async refreshTriggerCapabilities(input) {
    LinearWebhookTriggerCapabilitiesRefreshBodySchema.parse(input.body);
    LinearConnectionConfigSchema.parse(input.connection.config);

    if (input.source.remoteRegistrationId === undefined) {
      throw new Error(
        `Linear webhook source '${input.source.id}' is missing remoteRegistrationId.`,
      );
    }

    const endpointKey = input.source.endpointKey;
    if (endpointKey === undefined) {
      throw new Error(`Linear webhook source '${input.source.id}' is missing endpointKey.`);
    }

    const callbackUrl = buildIntegrationWebhookCallbackUrl({
      controlPlaneBaseUrl: input.controlPlaneBaseUrl,
      targetKey: input.targetKey,
      endpointKey,
    });
    const webhook = await findLinearWebhook({
      apiKey: resolveLinearApiKey({
        connectionSecrets: input.connectionSecrets,
      }),
      webhookId: input.source.remoteRegistrationId,
    });

    return {
      providerMetadata: buildLinearWebhookProviderMetadataFromRemote({
        callbackUrl,
        webhook,
      }),
    };
  },
  async deleteRegistration(input) {
    if (input.connection === undefined) {
      throw new Error("Linear managed webhook deletion requires a connection.");
    }

    const remoteRegistrationId = input.source.remoteRegistrationId;
    if (remoteRegistrationId === undefined) {
      throw new Error(
        `Linear webhook source '${input.source.id}' is missing remoteRegistrationId.`,
      );
    }

    await deleteLinearWebhook({
      apiKey: resolveLinearApiKey({
        connectionSecrets: input.connectionSecrets,
      }),
      webhookId: remoteRegistrationId,
    });
  },
};
