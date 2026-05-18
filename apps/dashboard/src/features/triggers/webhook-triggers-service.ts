import { z } from "zod";

import { requestControlPlane } from "../api/request-control-plane.js";
import {
  createWebhookTriggersApiError,
  toWebhookTriggersApiError,
  WebhookTriggersApiError,
} from "./webhook-triggers-api-errors.js";
import {
  DeleteWebhookTriggerResultSchema,
  type CreateWebhookTriggerInput,
  type DeleteWebhookTriggerResult,
  type UpdateWebhookTriggerInput,
  WebhookTriggerSchema,
  type WebhookTrigger,
} from "./webhook-triggers-types.js";

async function readJsonWithSchema<T>(input: {
  response: Response;
  schema: z.ZodType<T>;
  operation: string;
  invalidMessage: string;
}): Promise<T> {
  const json = await input.response.json().catch((): unknown => null);
  const parsed = input.schema.safeParse(json);

  if (!parsed.success) {
    throw new WebhookTriggersApiError({
      operation: input.operation,
      status: 500,
      body: json,
      message: input.invalidMessage,
    });
  }

  return parsed.data;
}

export async function getWebhookTrigger(input: {
  triggerId: string;
  signal?: AbortSignal;
}): Promise<WebhookTrigger> {
  try {
    const response = await requestControlPlane({
      operation: "getWebhookTrigger",
      method: "GET",
      pathname: `/v1/triggers/webhooks/${encodeURIComponent(input.triggerId)}`,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not load webhook trigger.",
      errorFactory: createWebhookTriggersApiError,
    });

    return await readJsonWithSchema({
      response,
      schema: WebhookTriggerSchema,
      operation: "getWebhookTrigger",
      invalidMessage: "Webhook trigger response payload is invalid.",
    });
  } catch (error) {
    throw toWebhookTriggersApiError({
      operation: "getWebhookTrigger",
      error,
      fallbackMessage: "Could not load webhook trigger.",
    });
  }
}

export async function createWebhookTrigger(input: {
  payload: CreateWebhookTriggerInput;
  signal?: AbortSignal;
}): Promise<WebhookTrigger> {
  try {
    const response = await requestControlPlane({
      operation: "createWebhookTrigger",
      method: "POST",
      pathname: "/v1/triggers/webhooks",
      body: input.payload,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not create webhook trigger.",
      errorFactory: createWebhookTriggersApiError,
    });

    return await readJsonWithSchema({
      response,
      schema: WebhookTriggerSchema,
      operation: "createWebhookTrigger",
      invalidMessage: "Create webhook trigger response payload is invalid.",
    });
  } catch (error) {
    throw toWebhookTriggersApiError({
      operation: "createWebhookTrigger",
      error,
      fallbackMessage: "Could not create webhook trigger.",
    });
  }
}

export async function updateWebhookTrigger(input: {
  payload: UpdateWebhookTriggerInput;
  signal?: AbortSignal;
}): Promise<WebhookTrigger> {
  try {
    const response = await requestControlPlane({
      operation: "updateWebhookTrigger",
      method: "PATCH",
      pathname: `/v1/triggers/webhooks/${encodeURIComponent(input.payload.triggerId)}`,
      body: input.payload.payload,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not update webhook trigger.",
      errorFactory: createWebhookTriggersApiError,
    });

    return await readJsonWithSchema({
      response,
      schema: WebhookTriggerSchema,
      operation: "updateWebhookTrigger",
      invalidMessage: "Update webhook trigger response payload is invalid.",
    });
  } catch (error) {
    throw toWebhookTriggersApiError({
      operation: "updateWebhookTrigger",
      error,
      fallbackMessage: "Could not update webhook trigger.",
    });
  }
}

export async function deleteWebhookTrigger(input: {
  triggerId: string;
  signal?: AbortSignal;
}): Promise<DeleteWebhookTriggerResult> {
  try {
    const response = await requestControlPlane({
      operation: "deleteWebhookTrigger",
      method: "DELETE",
      pathname: `/v1/triggers/webhooks/${encodeURIComponent(input.triggerId)}`,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not delete webhook trigger.",
      errorFactory: createWebhookTriggersApiError,
    });

    return await readJsonWithSchema({
      response,
      schema: DeleteWebhookTriggerResultSchema,
      operation: "deleteWebhookTrigger",
      invalidMessage: "Delete webhook trigger response payload is invalid.",
    });
  } catch (error) {
    throw toWebhookTriggersApiError({
      operation: "deleteWebhookTrigger",
      error,
      fallbackMessage: "Could not delete webhook trigger.",
    });
  }
}
