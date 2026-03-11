import type { GatewayForwardingIdentity } from "./types.js";

const AuthorizationHeaderName = "authorization";
const SourceNodeIdHeaderName = "x-mistle-forwarded-by-node-id";
const TargetNodeIdHeaderName = "x-mistle-target-node-id";
const BearerPrefix = "Bearer ";

function toBearerToken(authorizationHeaderValue: string | null): string | undefined {
  if (authorizationHeaderValue === null) {
    return undefined;
  }
  if (!authorizationHeaderValue.startsWith(BearerPrefix)) {
    return undefined;
  }

  const token = authorizationHeaderValue.slice(BearerPrefix.length).trim();
  if (token.length === 0) {
    return undefined;
  }

  return token;
}

function toRequiredHeaderValue(headerValue: string | null): string | undefined {
  const normalizedHeaderValue = headerValue?.trim();
  if (normalizedHeaderValue === undefined || normalizedHeaderValue.length === 0) {
    return undefined;
  }

  return normalizedHeaderValue;
}

export const InternalForwardingHeaderNames: {
  authorization: string;
  sourceNodeId: string;
  targetNodeId: string;
} = {
  authorization: AuthorizationHeaderName,
  sourceNodeId: SourceNodeIdHeaderName,
  targetNodeId: TargetNodeIdHeaderName,
};

export function createInternalForwardingHeaders(input: {
  serviceToken: string;
  identity: GatewayForwardingIdentity;
}): Headers {
  const headers = new Headers();

  headers.set(AuthorizationHeaderName, `${BearerPrefix}${input.serviceToken}`);
  headers.set(SourceNodeIdHeaderName, input.identity.sourceNodeId);
  headers.set(TargetNodeIdHeaderName, input.identity.targetNodeId);

  return headers;
}

export function verifyInternalForwardingHeaders(input: {
  headers: Headers;
  expectedServiceToken: string;
}): GatewayForwardingIdentity {
  const serviceToken = toBearerToken(input.headers.get(AuthorizationHeaderName));
  if (serviceToken === undefined || serviceToken !== input.expectedServiceToken) {
    throw new Error("Internal forwarding request is missing a valid service token.");
  }

  const sourceNodeId = toRequiredHeaderValue(input.headers.get(SourceNodeIdHeaderName));
  if (sourceNodeId === undefined) {
    throw new Error("Internal forwarding request is missing source gateway node id.");
  }

  const targetNodeId = toRequiredHeaderValue(input.headers.get(TargetNodeIdHeaderName));
  if (targetNodeId === undefined) {
    throw new Error("Internal forwarding request is missing target gateway node id.");
  }

  return {
    sourceNodeId,
    targetNodeId,
  };
}
