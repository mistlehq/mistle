import { z } from "zod";

import { requestControlPlane } from "../api/request-control-plane.js";
import {
  createWebhookAutomationsApiError,
  toWebhookAutomationsApiError,
  WebhookAutomationsApiError,
} from "./webhook-automations-api-errors.js";
import {
  DeleteWebhookAutomationResultSchema,
  type CreateWebhookAutomationInput,
  type DeleteWebhookAutomationResult,
  type UpdateWebhookAutomationInput,
  WebhookAutomationSchema,
  type WebhookAutomation,
} from "./webhook-automations-types.js";

async function readJsonWithSchema<T>(input: {
  response: Response;
  schema: z.ZodType<T>;
  operation: string;
  invalidMessage: string;
}): Promise<T> {
  const json = await input.response.json().catch((): unknown => null);
  const parsed = input.schema.safeParse(json);

  if (!parsed.success) {
    throw new WebhookAutomationsApiError({
      operation: input.operation,
      status: 500,
      body: json,
      message: input.invalidMessage,
    });
  }

  return parsed.data;
}

export async function getWebhookAutomation(input: {
  automationId: string;
  signal?: AbortSignal;
}): Promise<WebhookAutomation> {
  try {
    const response = await requestControlPlane({
      operation: "getWebhookAutomation",
      method: "GET",
      pathname: `/v1/automations/webhooks/${encodeURIComponent(input.automationId)}`,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not load webhook automation.",
      errorFactory: createWebhookAutomationsApiError,
    });

    return await readJsonWithSchema({
      response,
      schema: WebhookAutomationSchema,
      operation: "getWebhookAutomation",
      invalidMessage: "Webhook automation response payload is invalid.",
    });
  } catch (error) {
    throw toWebhookAutomationsApiError({
      operation: "getWebhookAutomation",
      error,
      fallbackMessage: "Could not load webhook automation.",
    });
  }
}

export async function createWebhookAutomation(input: {
  payload: CreateWebhookAutomationInput;
  signal?: AbortSignal;
}): Promise<WebhookAutomation> {
  try {
    const response = await requestControlPlane({
      operation: "createWebhookAutomation",
      method: "POST",
      pathname: "/v1/automations/webhooks",
      body: input.payload,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not create webhook automation.",
      errorFactory: createWebhookAutomationsApiError,
    });

    return await readJsonWithSchema({
      response,
      schema: WebhookAutomationSchema,
      operation: "createWebhookAutomation",
      invalidMessage: "Create webhook automation response payload is invalid.",
    });
  } catch (error) {
    throw toWebhookAutomationsApiError({
      operation: "createWebhookAutomation",
      error,
      fallbackMessage: "Could not create webhook automation.",
    });
  }
}

export async function updateWebhookAutomation(input: {
  payload: UpdateWebhookAutomationInput;
  signal?: AbortSignal;
}): Promise<WebhookAutomation> {
  try {
    const response = await requestControlPlane({
      operation: "updateWebhookAutomation",
      method: "PATCH",
      pathname: `/v1/automations/webhooks/${encodeURIComponent(input.payload.automationId)}`,
      body: input.payload.payload,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not update webhook automation.",
      errorFactory: createWebhookAutomationsApiError,
    });

    return await readJsonWithSchema({
      response,
      schema: WebhookAutomationSchema,
      operation: "updateWebhookAutomation",
      invalidMessage: "Update webhook automation response payload is invalid.",
    });
  } catch (error) {
    throw toWebhookAutomationsApiError({
      operation: "updateWebhookAutomation",
      error,
      fallbackMessage: "Could not update webhook automation.",
    });
  }
}

export async function deleteWebhookAutomation(input: {
  automationId: string;
  signal?: AbortSignal;
}): Promise<DeleteWebhookAutomationResult> {
  try {
    const response = await requestControlPlane({
      operation: "deleteWebhookAutomation",
      method: "DELETE",
      pathname: `/v1/automations/webhooks/${encodeURIComponent(input.automationId)}`,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not delete webhook automation.",
      errorFactory: createWebhookAutomationsApiError,
    });

    return await readJsonWithSchema({
      response,
      schema: DeleteWebhookAutomationResultSchema,
      operation: "deleteWebhookAutomation",
      invalidMessage: "Delete webhook automation response payload is invalid.",
    });
  } catch (error) {
    throw toWebhookAutomationsApiError({
      operation: "deleteWebhookAutomation",
      error,
      fallbackMessage: "Could not delete webhook automation.",
    });
  }
}
