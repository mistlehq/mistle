import { z } from "zod";

import { requestControlPlane } from "../api/request-control-plane.js";
import {
  createScheduledAutomationsApiError,
  ScheduledAutomationsApiError,
  toScheduledAutomationsApiError,
} from "./scheduled-automations-api-errors.js";
import {
  DeleteScheduledAutomationResultSchema,
  type CreateScheduledAutomationInput,
  type DeleteScheduledAutomationResult,
  ScheduledAutomationSchema,
  type ScheduledAutomation,
  type UpdateScheduledAutomationInput,
} from "./scheduled-automations-types.js";

async function readJsonWithSchema<T>(input: {
  response: Response;
  schema: z.ZodType<T>;
  operation: string;
  invalidMessage: string;
}): Promise<T> {
  const json = await input.response.json().catch((): unknown => null);
  const parsed = input.schema.safeParse(json);

  if (!parsed.success) {
    throw new ScheduledAutomationsApiError({
      operation: input.operation,
      status: 500,
      body: json,
      message: input.invalidMessage,
    });
  }

  return parsed.data;
}

export async function getScheduledAutomation(input: {
  automationId: string;
  signal?: AbortSignal;
}): Promise<ScheduledAutomation> {
  try {
    const response = await requestControlPlane({
      operation: "getScheduledAutomation",
      method: "GET",
      pathname: `/v1/automations/schedules/${encodeURIComponent(input.automationId)}`,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not load scheduled trigger.",
      errorFactory: createScheduledAutomationsApiError,
    });

    return await readJsonWithSchema({
      response,
      schema: ScheduledAutomationSchema,
      operation: "getScheduledAutomation",
      invalidMessage: "Scheduled trigger response payload is invalid.",
    });
  } catch (error) {
    throw toScheduledAutomationsApiError({
      operation: "getScheduledAutomation",
      error,
      fallbackMessage: "Could not load scheduled trigger.",
    });
  }
}

export async function createScheduledAutomation(input: {
  payload: CreateScheduledAutomationInput;
  signal?: AbortSignal;
}): Promise<ScheduledAutomation> {
  try {
    const response = await requestControlPlane({
      operation: "createScheduledAutomation",
      method: "POST",
      pathname: "/v1/automations/schedules",
      body: input.payload,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not create scheduled trigger.",
      errorFactory: createScheduledAutomationsApiError,
    });

    return await readJsonWithSchema({
      response,
      schema: ScheduledAutomationSchema,
      operation: "createScheduledAutomation",
      invalidMessage: "Create scheduled trigger response payload is invalid.",
    });
  } catch (error) {
    throw toScheduledAutomationsApiError({
      operation: "createScheduledAutomation",
      error,
      fallbackMessage: "Could not create scheduled trigger.",
    });
  }
}

export async function updateScheduledAutomation(input: {
  payload: UpdateScheduledAutomationInput;
  signal?: AbortSignal;
}): Promise<ScheduledAutomation> {
  try {
    const response = await requestControlPlane({
      operation: "updateScheduledAutomation",
      method: "PATCH",
      pathname: `/v1/automations/schedules/${encodeURIComponent(input.payload.automationId)}`,
      body: input.payload.payload,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not update scheduled trigger.",
      errorFactory: createScheduledAutomationsApiError,
    });

    return await readJsonWithSchema({
      response,
      schema: ScheduledAutomationSchema,
      operation: "updateScheduledAutomation",
      invalidMessage: "Update scheduled trigger response payload is invalid.",
    });
  } catch (error) {
    throw toScheduledAutomationsApiError({
      operation: "updateScheduledAutomation",
      error,
      fallbackMessage: "Could not update scheduled trigger.",
    });
  }
}

export async function deleteScheduledAutomation(input: {
  automationId: string;
  signal?: AbortSignal;
}): Promise<DeleteScheduledAutomationResult> {
  try {
    const response = await requestControlPlane({
      operation: "deleteScheduledAutomation",
      method: "DELETE",
      pathname: `/v1/automations/schedules/${encodeURIComponent(input.automationId)}`,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not delete scheduled trigger.",
      errorFactory: createScheduledAutomationsApiError,
    });

    return await readJsonWithSchema({
      response,
      schema: DeleteScheduledAutomationResultSchema,
      operation: "deleteScheduledAutomation",
      invalidMessage: "Delete scheduled trigger response payload is invalid.",
    });
  } catch (error) {
    throw toScheduledAutomationsApiError({
      operation: "deleteScheduledAutomation",
      error,
      fallbackMessage: "Could not delete scheduled trigger.",
    });
  }
}
