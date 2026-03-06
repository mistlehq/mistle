import {
  CompilerErrorCodes,
  IntegrationCompilerError,
  type CompilerErrorCode,
} from "../errors/index.js";
import type { EgressUrlRef } from "../types/index.js";

export function createEgressRouteBaseUrl(input: {
  egressBaseUrl: string;
  routeId: string;
}): string {
  const parsedEgressBaseUrl = new URL(input.egressBaseUrl);
  const normalizedBasePath =
    parsedEgressBaseUrl.pathname.endsWith("/") && parsedEgressBaseUrl.pathname !== "/"
      ? parsedEgressBaseUrl.pathname.slice(0, -1)
      : parsedEgressBaseUrl.pathname === "/"
        ? ""
        : parsedEgressBaseUrl.pathname;

  parsedEgressBaseUrl.pathname = `${normalizedBasePath}/routes/${encodeURIComponent(input.routeId)}`;
  parsedEgressBaseUrl.search = "";
  parsedEgressBaseUrl.hash = "";

  return parsedEgressBaseUrl.toString();
}

export function resolveEgressUrlRef(input: {
  value: EgressUrlRef;
  routeIds: ReadonlySet<string>;
  egressBaseUrl: string;
  invalidRefCode: CompilerErrorCode;
  refOwner: string;
}): string {
  if (!input.routeIds.has(input.value.routeId)) {
    throw new IntegrationCompilerError(
      input.invalidRefCode,
      `${input.refOwner} referenced unknown egress route '${input.value.routeId}'.`,
    );
  }

  return createEgressRouteBaseUrl({
    egressBaseUrl: input.egressBaseUrl,
    routeId: input.value.routeId,
  });
}

export const EgressUrlRefErrorCodes = {
  RUNTIME_CLIENT_SETUP_INVALID_REF: CompilerErrorCodes.RUNTIME_CLIENT_SETUP_INVALID_REF,
  MCP_INVALID_REF: CompilerErrorCodes.MCP_INVALID_REF,
} as const;
