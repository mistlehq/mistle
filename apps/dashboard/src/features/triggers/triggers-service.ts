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
      pathname: "/v1/triggers",
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
      pathname: `/v1/triggers/${encodeURIComponent(input.triggerId)}`,
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

export type TriggerSandboxProfileUsage = {
  id: string;
  kind: TriggerListItem["kind"];
  name: string;
  sandboxProfileVersion: number;
};

export async function listTriggersForSandboxProfile(input: {
  sandboxProfileId: string;
  signal?: AbortSignal;
}): Promise<TriggerSandboxProfileUsage[]> {
  return await listReusableTriggerUsagesForSandboxProfile(input);
}

export async function listCopyableTriggersForSandboxProfile(input: {
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  signal?: AbortSignal;
}): Promise<TriggerSandboxProfileUsage[]> {
  const triggerUsages = await listReusableTriggerUsagesForSandboxProfile({
    sandboxProfileId: input.sandboxProfileId,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });

  return triggerUsages.filter(
    (triggerUsage) => triggerUsage.sandboxProfileVersion === input.sandboxProfileVersion,
  );
}

async function listReusableTriggerUsagesForSandboxProfile(input: {
  sandboxProfileId: string;
  signal?: AbortSignal;
}): Promise<TriggerSandboxProfileUsage[]> {
  const [webhookTriggers, recurringScheduleTriggers] = await Promise.all([
    listTriggerUsagesForSandboxProfile({
      kind: "webhook",
      sandboxProfileId: input.sandboxProfileId,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }),
    listTriggerUsagesForSandboxProfile({
      kind: "schedule",
      sandboxProfileId: input.sandboxProfileId,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    }),
  ]);

  return [...webhookTriggers, ...recurringScheduleTriggers];
}

async function listTriggerUsagesForSandboxProfile(input: {
  kind: "webhook" | "schedule";
  sandboxProfileId: string;
  signal?: AbortSignal;
}): Promise<TriggerSandboxProfileUsage[]> {
  const matchingTriggers: TriggerSandboxProfileUsage[] = [];
  let after: string | null = null;

  do {
    const page = await listTriggers({
      limit: 100,
      after,
      before: null,
      kind: input.kind,
      sandboxProfileId: input.sandboxProfileId,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });

    for (const trigger of page.items) {
      matchingTriggers.push({
        id: trigger.id,
        kind: trigger.kind,
        name: trigger.name,
        sandboxProfileVersion: trigger.target.sandboxProfileVersion,
      });
    }

    after = page.nextPage?.after ?? null;
  } while (after !== null);

  return matchingTriggers;
}
