import {
  parsePublishedTargetHost,
  PublishedTargetAccessTokenError,
  PublishedTargetHostError,
  PublishedTargetShareTokenError,
  verifyPublishedTargetAccessToken,
  verifyPublishedTargetShareToken,
  type ParsedPublishedTargetHost,
  type PublishedTargetAccessTokenConfig,
  type PublishedTargetShareTokenConfig,
  type VerifiedPublishedTargetAccessToken,
  type VerifiedPublishedTargetShareToken,
} from "@mistle/published-target-auth";

type ParsedPublishedPortHost = Omit<ParsedPublishedTargetHost, "target"> & {
  target: {
    kind: "port";
    port: number;
  };
};

export class PublishedTargetBootstrapError extends Error {
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PublishedTargetBootstrapError";
  }
}

function parseHostOrThrow(input: {
  baseDomain: string;
  host: string | undefined;
}): ParsedPublishedTargetHost {
  if (input.host === undefined || input.host.trim().length === 0) {
    throw new PublishedTargetBootstrapError("Published target host header is required.");
  }

  try {
    return parsePublishedTargetHost({
      baseDomain: input.baseDomain,
      host: input.host,
    });
  } catch (error) {
    if (error instanceof PublishedTargetHostError) {
      throw new PublishedTargetBootstrapError(error.message, { cause: error });
    }

    throw error;
  }
}

function readTokenFromRequestUrl(requestUrl: string): string {
  const token = new URL(requestUrl).searchParams.get("token");
  if (token === null || token.trim().length === 0) {
    throw new PublishedTargetBootstrapError("Published target bootstrap token is required.");
  }

  return token;
}

function toParsedPublishedPortHost(parsedHost: ParsedPublishedTargetHost): ParsedPublishedPortHost {
  if (parsedHost.target.kind !== "port") {
    throw new PublishedTargetBootstrapError("Published target host must target a port.");
  }

  return {
    ...parsedHost,
    target: parsedHost.target,
  };
}

function assertAccessTokenMatchesHost(input: {
  parsedHost: ParsedPublishedTargetHost;
  verifiedToken: VerifiedPublishedTargetAccessToken;
}): void {
  if (input.verifiedToken.host !== input.parsedHost.host) {
    throw new PublishedTargetBootstrapError(
      "Published target access token host claim does not match the request host.",
    );
  }
  if (input.verifiedToken.sandboxInstanceId !== input.parsedHost.sandboxInstanceId) {
    throw new PublishedTargetBootstrapError(
      "Published target access token sandboxInstanceId claim does not match the request host.",
    );
  }
  if (
    input.verifiedToken.targetKind !== input.parsedHost.target.kind ||
    input.verifiedToken.targetId !== String(input.parsedHost.target.port)
  ) {
    throw new PublishedTargetBootstrapError(
      "Published target access token target claim does not match the request host.",
    );
  }
}

function assertShareTokenMatchesHost(input: {
  parsedHost: ParsedPublishedTargetHost;
  verifiedToken: VerifiedPublishedTargetShareToken;
}): void {
  if (input.verifiedToken.host !== input.parsedHost.host) {
    throw new PublishedTargetBootstrapError(
      "Published target share token host claim does not match the request host.",
    );
  }
  if (input.verifiedToken.sandboxInstanceId !== input.parsedHost.sandboxInstanceId) {
    throw new PublishedTargetBootstrapError(
      "Published target share token sandboxInstanceId claim does not match the request host.",
    );
  }
  if (
    input.verifiedToken.targetKind !== input.parsedHost.target.kind ||
    input.verifiedToken.targetId !== String(input.parsedHost.target.port)
  ) {
    throw new PublishedTargetBootstrapError(
      "Published target share token target claim does not match the request host.",
    );
  }
}

export async function verifyOwnedPublishedTargetBootstrapRequest(input: {
  accessTokenConfig: PublishedTargetAccessTokenConfig;
  baseDomain: string;
  host: string | undefined;
  requestUrl: string;
}): Promise<{
  parsedHost: ParsedPublishedPortHost;
  verifiedToken: VerifiedPublishedTargetAccessToken;
}> {
  const parsedHost = toParsedPublishedPortHost(parseHostOrThrow(input));
  const token = readTokenFromRequestUrl(input.requestUrl);

  let verifiedToken: VerifiedPublishedTargetAccessToken;
  try {
    verifiedToken = await verifyPublishedTargetAccessToken({
      config: input.accessTokenConfig,
      token,
    });
  } catch (error) {
    if (error instanceof PublishedTargetAccessTokenError) {
      throw new PublishedTargetBootstrapError(error.message, { cause: error });
    }

    throw error;
  }

  assertAccessTokenMatchesHost({
    parsedHost,
    verifiedToken,
  });

  return {
    parsedHost,
    verifiedToken,
  };
}

export async function verifySharedPublishedTargetBootstrapRequest(input: {
  baseDomain: string;
  host: string | undefined;
  requestUrl: string;
  shareTokenConfig: PublishedTargetShareTokenConfig;
}): Promise<{
  parsedHost: ParsedPublishedPortHost;
  verifiedToken: VerifiedPublishedTargetShareToken;
}> {
  const parsedHost = toParsedPublishedPortHost(parseHostOrThrow(input));
  const token = readTokenFromRequestUrl(input.requestUrl);

  let verifiedToken: VerifiedPublishedTargetShareToken;
  try {
    verifiedToken = await verifyPublishedTargetShareToken({
      config: input.shareTokenConfig,
      token,
    });
  } catch (error) {
    if (error instanceof PublishedTargetShareTokenError) {
      throw new PublishedTargetBootstrapError(error.message, { cause: error });
    }

    throw error;
  }

  assertShareTokenMatchesHost({
    parsedHost,
    verifiedToken,
  });

  return {
    parsedHost,
    verifiedToken,
  };
}
