export type PublishedTargetKind = "port";

export type PublishedTarget = {
  kind: "port";
  port: number;
};

export type ParsedPublishedTargetHost = {
  baseDomain: string;
  host: string;
  sandboxInstanceId: string;
  target: PublishedTarget;
};

export const PublishedTargetHostErrorCode = {
  BASE_DOMAIN_REQUIRED: "BASE_DOMAIN_REQUIRED",
  HOST_FORMAT_INVALID: "HOST_FORMAT_INVALID",
  HOST_REQUIRED: "HOST_REQUIRED",
  SANDBOX_INSTANCE_ID_REQUIRED: "SANDBOX_INSTANCE_ID_REQUIRED",
  SANDBOX_INSTANCE_ID_UNSUPPORTED: "SANDBOX_INSTANCE_ID_UNSUPPORTED",
  TARGET_PORT_INVALID: "TARGET_PORT_INVALID",
  TARGET_REQUIRED: "TARGET_REQUIRED",
} as const;

export type PublishedTargetHostErrorCode =
  (typeof PublishedTargetHostErrorCode)[keyof typeof PublishedTargetHostErrorCode];

type PublishedTargetHostErrorInput = {
  cause?: unknown;
  code: PublishedTargetHostErrorCode;
  message: string;
};

export class PublishedTargetHostError extends Error {
  readonly code: PublishedTargetHostErrorCode;

  constructor(input: PublishedTargetHostErrorInput) {
    super(input.message, { cause: input.cause });
    this.name = "PublishedTargetHostError";
    this.code = input.code;
  }
}

function requireBaseDomain(baseDomain: string): void {
  if (baseDomain.length === 0) {
    throw new PublishedTargetHostError({
      code: PublishedTargetHostErrorCode.BASE_DOMAIN_REQUIRED,
      message: "Published target baseDomain is required.",
    });
  }
}

function requirePort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new PublishedTargetHostError({
      code: PublishedTargetHostErrorCode.TARGET_PORT_INVALID,
      message: "Published target port must be an integer between 1 and 65535.",
    });
  }

  return port;
}

export function derivePublishedTargetHost(input: {
  baseDomain: string;
  sandboxInstanceId: string;
  target: PublishedTarget;
}): string {
  requireBaseDomain(input.baseDomain);
  if (input.target === undefined) {
    throw new PublishedTargetHostError({
      code: PublishedTargetHostErrorCode.TARGET_REQUIRED,
      message: "Published target is required.",
    });
  }

  if (input.sandboxInstanceId.length === 0) {
    throw new PublishedTargetHostError({
      code: PublishedTargetHostErrorCode.SANDBOX_INSTANCE_ID_REQUIRED,
      message: "Published target sandboxInstanceId is required.",
    });
  }

  if (input.sandboxInstanceId.includes("-")) {
    throw new PublishedTargetHostError({
      code: PublishedTargetHostErrorCode.SANDBOX_INSTANCE_ID_UNSUPPORTED,
      message: "Published target sandboxInstanceId cannot contain '-'.",
    });
  }

  // Published hosts use DNS-safe labels, so sandbox instance IDs encode `_` as `-`.
  // We reject raw `-` here to keep the mapping reversible when parsing the host back.
  return `p-${String(requirePort(input.target.port))}--${input.sandboxInstanceId.replaceAll("_", "-")}.${input.baseDomain}`;
}

export function parsePublishedTargetHost(input: {
  baseDomain: string;
  host: string;
}): ParsedPublishedTargetHost {
  requireBaseDomain(input.baseDomain);
  if (input.host.length === 0) {
    throw new PublishedTargetHostError({
      code: PublishedTargetHostErrorCode.HOST_REQUIRED,
      message: "Published target host is required.",
    });
  }

  const match = new RegExp(
    `^(?<publishedHost>p-(?<port>\\d+)--(?<sandboxInstanceIdLabel>[^.]+)\\.${input.baseDomain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?::\\d+)?$`,
  ).exec(input.host);
  if (match === null || match.groups === undefined) {
    throw new PublishedTargetHostError({
      code: PublishedTargetHostErrorCode.HOST_FORMAT_INVALID,
      message: "Published target host must match p-<port>--<sandbox>.<baseDomain>[:port].",
    });
  }

  const encodedPort = match.groups.port;
  const sandboxInstanceIdLabel = match.groups.sandboxInstanceIdLabel;
  const publishedHost = match.groups.publishedHost;
  if (
    encodedPort === undefined ||
    sandboxInstanceIdLabel === undefined ||
    publishedHost === undefined
  ) {
    throw new PublishedTargetHostError({
      code: PublishedTargetHostErrorCode.HOST_FORMAT_INVALID,
      message: "Published target host must match p-<port>--<sandbox>.<baseDomain>[:port].",
    });
  }

  const parsedPort = requirePort(Number.parseInt(encodedPort, 10));

  return {
    baseDomain: input.baseDomain,
    host: publishedHost,
    // This reverses the label encoding applied by `derivePublishedTargetHost()`.
    sandboxInstanceId: sandboxInstanceIdLabel.replaceAll("-", "_"),
    target: {
      kind: "port",
      port: parsedPort,
    },
  };
}
