import { z } from "zod";

import { requestControlPlane } from "../api/request-control-plane.js";
import {
  AutomationsApiError,
  createAutomationsApiError,
  toAutomationsApiError,
} from "./automations-api-errors.js";
import { AutomationsListResultSchema, type AutomationsListResult } from "./automations-types.js";

async function readJsonWithSchema<T>(input: {
  response: Response;
  schema: z.ZodType<T>;
  operation: string;
  invalidMessage: string;
}): Promise<T> {
  const json = await input.response.json().catch((): unknown => null);
  const parsed = input.schema.safeParse(json);

  if (!parsed.success) {
    throw new AutomationsApiError({
      operation: input.operation,
      status: 500,
      body: json,
      message: input.invalidMessage,
    });
  }

  return parsed.data;
}

export async function listAutomations(input: {
  limit: number;
  after: string | null;
  before: string | null;
  sandboxProfileId?: string | undefined;
  signal?: AbortSignal;
}): Promise<AutomationsListResult> {
  try {
    const response = await requestControlPlane({
      operation: "listAutomations",
      method: "GET",
      pathname: "/v1/automations",
      query: {
        limit: input.limit,
        ...(input.after === null ? {} : { after: input.after }),
        ...(input.before === null ? {} : { before: input.before }),
        ...(input.sandboxProfileId === undefined
          ? {}
          : { sandboxProfileId: input.sandboxProfileId }),
      },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not load automations.",
      errorFactory: createAutomationsApiError,
    });

    return await readJsonWithSchema({
      response,
      schema: AutomationsListResultSchema,
      operation: "listAutomations",
      invalidMessage: "Automations list response payload is invalid.",
    });
  } catch (error) {
    throw toAutomationsApiError({
      operation: "listAutomations",
      error,
      fallbackMessage: "Could not load automations.",
    });
  }
}

export type WebhookAutomationSandboxProfileUsage = {
  id: string;
  name: string;
};

export async function listWebhookAutomationsForSandboxProfile(input: {
  sandboxProfileId: string;
  signal?: AbortSignal;
}): Promise<WebhookAutomationSandboxProfileUsage[]> {
  const matchingAutomations: WebhookAutomationSandboxProfileUsage[] = [];
  let after: string | null = null;

  do {
    const page = await listAutomations({
      limit: 100,
      after,
      before: null,
      sandboxProfileId: input.sandboxProfileId,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });

    for (const automation of page.items) {
      if (automation.kind === "webhook") {
        matchingAutomations.push({
          id: automation.id,
          name: automation.name,
        });
      }
    }

    after = page.nextPage?.after ?? null;
  } while (after !== null);

  return matchingAutomations;
}
