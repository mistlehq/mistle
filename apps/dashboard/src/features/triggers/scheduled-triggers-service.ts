import { z } from "zod";

import { requestControlPlane } from "../api/request-control-plane.js";
import {
  createScheduledTriggersApiError,
  ScheduledTriggersApiError,
  toScheduledTriggersApiError,
} from "./scheduled-triggers-api-errors.js";
import {
  DeleteScheduledTriggerResultSchema,
  type CreateScheduledTriggerInput,
  type DeleteScheduledTriggerResult,
  ScheduledTriggerSchema,
  type ScheduledTrigger,
  type UpdateScheduledTriggerInput,
} from "./scheduled-triggers-types.js";

async function readJsonWithSchema<T>(input: {
  response: Response;
  schema: z.ZodType<T>;
  operation: string;
  invalidMessage: string;
}): Promise<T> {
  const json = await input.response.json().catch((): unknown => null);
  const parsed = input.schema.safeParse(json);

  if (!parsed.success) {
    throw new ScheduledTriggersApiError({
      operation: input.operation,
      status: 500,
      body: json,
      message: input.invalidMessage,
    });
  }

  return parsed.data;
}

export async function getScheduledTrigger(input: {
  triggerId: string;
  signal?: AbortSignal;
}): Promise<ScheduledTrigger> {
  try {
    const response = await requestControlPlane({
      operation: "getScheduledTrigger",
      method: "GET",
      pathname: `/v1/automations/schedules/${encodeURIComponent(input.triggerId)}`,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not load scheduled trigger.",
      errorFactory: createScheduledTriggersApiError,
    });

    return await readJsonWithSchema({
      response,
      schema: ScheduledTriggerSchema,
      operation: "getScheduledTrigger",
      invalidMessage: "Scheduled trigger response payload is invalid.",
    });
  } catch (error) {
    throw toScheduledTriggersApiError({
      operation: "getScheduledTrigger",
      error,
      fallbackMessage: "Could not load scheduled trigger.",
    });
  }
}

export async function createScheduledTrigger(input: {
  payload: CreateScheduledTriggerInput;
  signal?: AbortSignal;
}): Promise<ScheduledTrigger> {
  try {
    const response = await requestControlPlane({
      operation: "createScheduledTrigger",
      method: "POST",
      pathname: "/v1/automations/schedules",
      body: input.payload,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not create scheduled trigger.",
      errorFactory: createScheduledTriggersApiError,
    });

    return await readJsonWithSchema({
      response,
      schema: ScheduledTriggerSchema,
      operation: "createScheduledTrigger",
      invalidMessage: "Create scheduled trigger response payload is invalid.",
    });
  } catch (error) {
    throw toScheduledTriggersApiError({
      operation: "createScheduledTrigger",
      error,
      fallbackMessage: "Could not create scheduled trigger.",
    });
  }
}

export async function updateScheduledTrigger(input: {
  payload: UpdateScheduledTriggerInput;
  signal?: AbortSignal;
}): Promise<ScheduledTrigger> {
  try {
    const response = await requestControlPlane({
      operation: "updateScheduledTrigger",
      method: "PATCH",
      pathname: `/v1/automations/schedules/${encodeURIComponent(input.payload.triggerId)}`,
      body: input.payload.payload,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not update scheduled trigger.",
      errorFactory: createScheduledTriggersApiError,
    });

    return await readJsonWithSchema({
      response,
      schema: ScheduledTriggerSchema,
      operation: "updateScheduledTrigger",
      invalidMessage: "Update scheduled trigger response payload is invalid.",
    });
  } catch (error) {
    throw toScheduledTriggersApiError({
      operation: "updateScheduledTrigger",
      error,
      fallbackMessage: "Could not update scheduled trigger.",
    });
  }
}

export async function deleteScheduledTrigger(input: {
  triggerId: string;
  signal?: AbortSignal;
}): Promise<DeleteScheduledTriggerResult> {
  try {
    const response = await requestControlPlane({
      operation: "deleteScheduledTrigger",
      method: "DELETE",
      pathname: `/v1/automations/schedules/${encodeURIComponent(input.triggerId)}`,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not delete scheduled trigger.",
      errorFactory: createScheduledTriggersApiError,
    });

    return await readJsonWithSchema({
      response,
      schema: DeleteScheduledTriggerResultSchema,
      operation: "deleteScheduledTrigger",
      invalidMessage: "Delete scheduled trigger response payload is invalid.",
    });
  } catch (error) {
    throw toScheduledTriggersApiError({
      operation: "deleteScheduledTrigger",
      error,
      fallbackMessage: "Could not delete scheduled trigger.",
    });
  }
}
