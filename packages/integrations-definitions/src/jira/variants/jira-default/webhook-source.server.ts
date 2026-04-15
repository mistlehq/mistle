import { buildBasicAuthorizationHeader } from "@mistle/http";
import type { IntegrationWebhookSourceCapability } from "@mistle/integrations-core";
import { IntegrationWebhookSourceLifecycles } from "@mistle/integrations-core";
import { z } from "zod";

import {
  type JiraConnectionConfig,
  JiraPersonalApiTokenConnectionConfigSchema,
  normalizeJiraBaseUrl,
} from "./auth.js";
import { JiraManagedWebhookEvents } from "./supported-webhook-events.js";
import type { JiraTargetConfig } from "./target-config-schema.js";
import type { JiraTargetSecrets } from "./target-secret-schema.js";

const JiraAdminWebhookPath = "/rest/webhooks/1.0/webhook";

const JiraAdminWebhookResponseSchema = z
  .object({
    self: z.url(),
    enabled: z.boolean(),
    isSigned: z.boolean().optional(),
    lastUpdated: z.number().optional(),
  })
  .loose();

export function buildJiraWebhookCallbackUrl(input: {
  controlPlaneBaseUrl: string;
  targetKey: string;
  endpointKey: string;
}): string {
  return `${input.controlPlaneBaseUrl}/p/integration/webhooks/${input.targetKey}/${input.endpointKey}`;
}

export function resolveJiraAdminWebhookRegistrationOrThrow(input: {
  connectionConfig: Record<string, unknown>;
  connectionSecrets: Record<string, string>;
}): { siteUrl: string; email: string; apiKey: string } {
  const parsedConnectionConfig = JiraPersonalApiTokenConnectionConfigSchema.safeParse(
    input.connectionConfig,
  );

  if (!parsedConnectionConfig.success) {
    throw new Error(
      "Jira webhook source registration only supports personal API token connections.",
    );
  }

  const apiKey = input.connectionSecrets.apiKey;
  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error("Jira personal API token is missing for webhook source registration.");
  }

  return {
    siteUrl: normalizeJiraBaseUrl(parsedConnectionConfig.data.site_url),
    email: parsedConnectionConfig.data.email,
    apiKey,
  };
}

export function parseJiraAdminWebhookResponse(
  input: unknown,
): z.output<typeof JiraAdminWebhookResponseSchema> {
  return JiraAdminWebhookResponseSchema.parse(input);
}

export function resolveJiraAdminWebhookIdFromSelf(input: { self: string }): string {
  const pathnameSegments = new URL(input.self).pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  const webhookId = pathnameSegments[pathnameSegments.length - 1];

  if (webhookId === undefined) {
    throw new Error(`Jira admin webhook self URL '${input.self}' is invalid.`);
  }

  return webhookId;
}

async function createJiraAdminWebhook(input: {
  siteUrl: string;
  email: string;
  apiKey: string;
  requestBody: Record<string, unknown>;
}): Promise<z.output<typeof JiraAdminWebhookResponseSchema>> {
  const response = await fetch(`${input.siteUrl}${JiraAdminWebhookPath}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: buildBasicAuthorizationHeader({
        username: input.email,
        password: input.apiKey,
      }),
      "content-type": "application/json",
    },
    body: JSON.stringify(input.requestBody),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Jira admin webhook creation failed (${response.status}): ${responseText}`);
  }

  return parseJiraAdminWebhookResponse(await response.json());
}

async function deleteJiraAdminWebhook(input: {
  siteUrl: string;
  email: string;
  apiKey: string;
  webhookId: string;
}): Promise<void> {
  const response = await fetch(`${input.siteUrl}${JiraAdminWebhookPath}/${input.webhookId}`, {
    method: "DELETE",
    headers: {
      authorization: buildBasicAuthorizationHeader({
        username: input.email,
        password: input.apiKey,
      }),
    },
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Jira admin webhook deletion failed (${response.status}): ${responseText}`);
  }
}

export const JiraWebhookSourceCapability: IntegrationWebhookSourceCapability<
  JiraTargetConfig,
  JiraTargetSecrets,
  JiraConnectionConfig
> = {
  lifecycle: IntegrationWebhookSourceLifecycles.MANAGED,
  supportsConnection(input) {
    return JiraPersonalApiTokenConnectionConfigSchema.safeParse(input.connection.config).success;
  },
  async describeSource(input) {
    const endpointKey = input.source.endpointKey;
    if (endpointKey === undefined) {
      throw new Error(`Jira webhook source '${input.source.id}' is missing endpointKey.`);
    }

    return {
      displayName: input.source.displayName ?? "Webhook",
      callbackUrl: buildJiraWebhookCallbackUrl({
        controlPlaneBaseUrl: input.controlPlaneBaseUrl,
        targetKey: input.targetKey,
        endpointKey,
      }),
      providerMetadata: input.source.providerMetadata,
    };
  },
  async createRegistration(input) {
    const connection = input.connection;
    if (connection === undefined) {
      throw new Error("Jira managed webhook registration requires a connection.");
    }

    const connectionSecrets = input.connectionSecrets;
    if (connectionSecrets === undefined) {
      throw new Error("Jira managed webhook registration requires decrypted connection secrets.");
    }

    const webhookSecret = input.webhookSecret;
    if (webhookSecret === undefined || webhookSecret.length === 0) {
      throw new Error("Jira managed webhook registration requires a webhook secret.");
    }

    const endpointKey = input.source.endpointKey;
    if (endpointKey === undefined) {
      throw new Error(`Jira webhook source '${input.source.id}' is missing endpointKey.`);
    }

    const registration = resolveJiraAdminWebhookRegistrationOrThrow({
      connectionConfig: connection.config,
      connectionSecrets,
    });
    const callbackUrl = buildJiraWebhookCallbackUrl({
      controlPlaneBaseUrl: input.controlPlaneBaseUrl,
      targetKey: input.targetKey,
      endpointKey,
    });
    const createdWebhook = await createJiraAdminWebhook({
      ...registration,
      requestBody: {
        name: `Mistle webhook source ${input.source.id}`,
        description: `Managed by Mistle for webhook source ${input.source.id}`,
        url: callbackUrl,
        events: [...JiraManagedWebhookEvents],
        excludeBody: false,
        secret: webhookSecret,
      },
    });
    const remoteRegistrationId = resolveJiraAdminWebhookIdFromSelf({
      self: createdWebhook.self,
    });

    return {
      remoteRegistrationId,
      providerMetadata: {
        callbackUrl,
        registeredEvents: [...JiraManagedWebhookEvents],
        self: createdWebhook.self,
      },
    };
  },
  async deleteRegistration(input) {
    const connection = input.connection;
    if (connection === undefined) {
      throw new Error("Jira managed webhook deletion requires a connection.");
    }

    const connectionSecrets = input.connectionSecrets;
    if (connectionSecrets === undefined) {
      throw new Error("Jira managed webhook deletion requires decrypted connection secrets.");
    }

    const remoteRegistrationId = input.source.remoteRegistrationId;
    if (remoteRegistrationId === undefined) {
      throw new Error(`Jira webhook source '${input.source.id}' is missing remoteRegistrationId.`);
    }

    const registration = resolveJiraAdminWebhookRegistrationOrThrow({
      connectionConfig: connection.config,
      connectionSecrets,
    });

    await deleteJiraAdminWebhook({
      ...registration,
      webhookId: remoteRegistrationId,
    });
  },
};
