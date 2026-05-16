import { z } from "zod";

import { requestControlPlane } from "../api/request-control-plane.js";
import {
  TriggersApiError,
  createTriggersApiError,
  toTriggersApiError,
} from "./triggers-api-errors.js";
import {
  TriggerListItemSchema,
  type ListTriggersQuery,
  type TriggerListItem,
  TriggersListResultSchema,
  type TriggersListResult,
} from "./triggers-types.js";

async function readJsonWithSchema<T>(input: {
  response: Response;
  schema: z.ZodType<T>;
  operation: string;
  invalidMessage: string;
}): Promise<T> {
  const json = await input.response.json().catch((): unknown => null);
  const parsed = input.schema.safeParse(json);

  if (!parsed.success) {
    throw new TriggersApiError({
      operation: input.operation,
      status: 500,
      body: json,
      message: input.invalidMessage,
    });
  }

  return parsed.data;
}

type ListTriggersInput = Omit<ListTriggersQuery, "after" | "before"> & {
  limit: number;
  after: string | null;
  before: string | null;
  signal?: AbortSignal;
};

export async function listTriggers(input: ListTriggersInput): Promise<TriggersListResult> {
  try {
    const response = await requestControlPlane({
      operation: "listTriggers",
      method: "GET",
      pathname: "/v1/automations",
      query: {
        limit: input.limit,
        ...(input.after === null ? {} : { after: input.after }),
        ...(input.before === null ? {} : { before: input.before }),
        ...(input.sandboxProfileId === undefined
          ? {}
          : { sandboxProfileId: input.sandboxProfileId }),
        ...(input.kind === undefined ? {} : { kind: input.kind }),
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        ...(input.search === undefined ? {} : { search: input.search }),
      },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not load triggers.",
      errorFactory: createTriggersApiError,
    });

    return await readJsonWithSchema({
      response,
      schema: TriggersListResultSchema,
      operation: "listTriggers",
      invalidMessage: "Triggers list response payload is invalid.",
    });
  } catch (error) {
    throw toTriggersApiError({
      operation: "listTriggers",
      error,
      fallbackMessage: "Could not load triggers.",
    });
  }
}

export async function getTrigger(input: {
  triggerId: string;
  signal?: AbortSignal;
}): Promise<TriggerListItem> {
  try {
    const response = await requestControlPlane({
      operation: "getTrigger",
      method: "GET",
      pathname: `/v1/automations/${encodeURIComponent(input.triggerId)}`,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not load trigger.",
      errorFactory: createTriggersApiError,
    });

    return await readJsonWithSchema({
      response,
      schema: TriggerListItemSchema,
      operation: "getTrigger",
      invalidMessage: "Trigger response payload is invalid.",
    });
  } catch (error) {
    throw toTriggersApiError({
      operation: "getTrigger",
      error,
      fallbackMessage: "Could not load trigger.",
    });
  }
}

export type WebhookTriggerSandboxProfileUsage = {
  id: string;
  name: string;
};

export async function listWebhookTriggersForSandboxProfile(input: {
  sandboxProfileId: string;
  signal?: AbortSignal;
}): Promise<WebhookTriggerSandboxProfileUsage[]> {
  const matchingTriggers: WebhookTriggerSandboxProfileUsage[] = [];
  let after: string | null = null;

  do {
    const page = await listTriggers({
      limit: 100,
      after,
      before: null,
      kind: "webhook",
      sandboxProfileId: input.sandboxProfileId,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });

    for (const trigger of page.items) {
      matchingTriggers.push({
        id: trigger.id,
        name: trigger.name,
      });
    }

    after = page.nextPage?.after ?? null;
  } while (after !== null);

  return matchingTriggers;
}
