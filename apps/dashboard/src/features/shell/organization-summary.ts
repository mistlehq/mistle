import { z } from "zod";

import { authClient } from "../../lib/auth/client.js";
import {
  parseOrganizationSummary,
  type OrganizationSummary,
} from "../organizations/organization-summary-payload.js";

export const ORGANIZATION_SUMMARY_QUERY_KEY_PREFIX: readonly ["shell", "organization-summary"] = [
  "shell",
  "organization-summary",
];

export function organizationSummaryQueryKey(
  organizationId: string | null,
): readonly ["shell", "organization-summary", string | null] {
  return [...ORGANIZATION_SUMMARY_QUERY_KEY_PREFIX, organizationId];
}

const OrganizationSummaryErrorSchema = z
  .object({
    status: z.number().optional(),
    message: z.string().optional(),
    error: z
      .object({
        message: z.string().optional(),
      })
      .optional(),
  })
  .catchall(z.unknown());

type OrganizationSummaryErrorPayload = z.infer<typeof OrganizationSummaryErrorSchema>;

function readErrorMessage(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  const parsedError = OrganizationSummaryErrorSchema.safeParse(value);
  if (!parsedError.success) {
    return null;
  }

  const direct = parsedError.data.message;
  if (direct !== undefined) {
    return direct;
  }

  return parsedError.data.error?.message ?? null;
}

export class OrganizationSummaryError extends Error {
  readonly operation: string;
  readonly status: number;
  readonly body: unknown;

  constructor(input: { operation: string; status: number; body: unknown; message: string }) {
    super(input.message);
    this.operation = input.operation;
    this.status = input.status;
    this.body = input.body;
  }
}

function toOrganizationSummaryError(operation: string, error: unknown): OrganizationSummaryError {
  const parsedError = OrganizationSummaryErrorSchema.safeParse(error);
  if (parsedError.success) {
    const errorPayload: OrganizationSummaryErrorPayload = parsedError.data;
    return new OrganizationSummaryError({
      operation,
      status: errorPayload.status ?? 500,
      body: error,
      message: readErrorMessage(errorPayload) ?? `${operation} failed.`,
    });
  }

  if (error instanceof Error) {
    return new OrganizationSummaryError({
      operation,
      status: 500,
      body: null,
      message: error.message,
    });
  }

  return new OrganizationSummaryError({
    operation,
    status: 500,
    body: null,
    message: `${operation} failed.`,
  });
}

export async function fetchOrganizationSummary(input: {
  organizationId: string;
}): Promise<OrganizationSummary> {
  try {
    const response = await authClient.$fetch("/organization/get-full-organization", {
      method: "GET",
      throw: true,
      query: {
        organizationId: input.organizationId,
      },
    });

    return parseOrganizationSummary(response);
  } catch (error) {
    throw toOrganizationSummaryError("fetchOrganizationSummary", error);
  }
}
