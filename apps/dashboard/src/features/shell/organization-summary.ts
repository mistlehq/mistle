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

type UnknownRecord = Record<string, unknown>;

function toRecord(value: unknown): UnknownRecord | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record: UnknownRecord = {};
  for (const [key, entryValue] of Object.entries(value)) {
    record[key] = entryValue;
  }

  return record;
}

function readString(record: UnknownRecord, key: string): string | null {
  const value = record[key];
  if (typeof value !== "string") {
    return null;
  }

  return value;
}

function readNumber(record: UnknownRecord, key: string): number | null {
  const value = record[key];
  if (typeof value !== "number") {
    return null;
  }

  return value;
}

function readErrorMessage(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  const record = toRecord(value);
  if (record === null) {
    return null;
  }

  const direct = readString(record, "message");
  if (direct !== null) {
    return direct;
  }

  const nestedError = toRecord(record["error"]);
  if (nestedError === null) {
    return null;
  }

  return readString(nestedError, "message");
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
  const record = toRecord(error);
  if (record !== null) {
    return new OrganizationSummaryError({
      operation,
      status: readNumber(record, "status") ?? 500,
      body: error,
      message: readErrorMessage(record) ?? `${operation} failed.`,
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
