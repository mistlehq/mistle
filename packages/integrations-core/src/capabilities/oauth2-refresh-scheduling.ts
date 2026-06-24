export type OAuth2ExpiresInValue = string | number;

const OAuth2RefreshBufferRatio = 0.1;

type OAuth2RefreshSchedulingLogger = {
  warn: (context: Record<string, unknown>, message: string) => void;
};

function parsePositiveInteger(input: OAuth2ExpiresInValue): number | undefined {
  const value = typeof input === "number" ? input : Number(input.trim());
  if (!Number.isInteger(value) || value < 1) {
    return undefined;
  }

  return value;
}

function isValidBuffer(buffer: number): boolean {
  return Number.isInteger(buffer) && buffer >= 0;
}

export function resolveOAuth2NextRefreshAtFromExpiresIn(input: {
  buffer: number;
  logger?: OAuth2RefreshSchedulingLogger | undefined;
  now: () => Date;
  expiresIn: OAuth2ExpiresInValue | undefined;
}): Date | undefined {
  if (input.expiresIn === undefined) {
    return undefined;
  }

  if (!isValidBuffer(input.buffer)) {
    input.logger?.warn(
      {
        buffer: input.buffer,
      },
      "OAuth 2.0 next refresh resolution skipped because buffer is invalid",
    );
    return undefined;
  }

  const expiresInSeconds = parsePositiveInteger(input.expiresIn);
  if (expiresInSeconds === undefined) {
    input.logger?.warn(
      {
        expiresIn: input.expiresIn,
      },
      "OAuth 2.0 next refresh resolution skipped because expires_in is invalid",
    );
    return undefined;
  }

  const expiresInMs = expiresInSeconds * 1_000;
  const effectiveBuffer = Math.min(
    input.buffer,
    Math.floor(expiresInMs * OAuth2RefreshBufferRatio),
  );
  const issuedAt = input.now();
  return new Date(issuedAt.getTime() + expiresInMs - effectiveBuffer);
}
