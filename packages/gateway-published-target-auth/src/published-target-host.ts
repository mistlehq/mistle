const PublishedTargetKindValues = {
  PORT: "port",
  APP: "app",
} as const;

export type PublishedTargetKind =
  (typeof PublishedTargetKindValues)[keyof typeof PublishedTargetKindValues];

export type PublishedTarget =
  | {
      kind: "port";
      port: number;
    }
  | {
      kind: "app";
      appKey: string;
    };

export type ParsedPublishedTargetHost = {
  baseDomain: string;
  host: string;
  sandboxInstanceId: string;
  target: PublishedTarget;
};

export const PublishedTargetHostErrorCode = {
  BASE_DOMAIN_REQUIRED: "BASE_DOMAIN_REQUIRED",
  HOST_REQUIRED: "HOST_REQUIRED",
  HOST_FORMAT_INVALID: "HOST_FORMAT_INVALID",
  HOST_BASE_DOMAIN_MISMATCH: "HOST_BASE_DOMAIN_MISMATCH",
  SANDBOX_INSTANCE_ID_REQUIRED: "SANDBOX_INSTANCE_ID_REQUIRED",
  SANDBOX_INSTANCE_ID_UNSUPPORTED: "SANDBOX_INSTANCE_ID_UNSUPPORTED",
  TARGET_APP_KEY_INVALID: "TARGET_APP_KEY_INVALID",
  TARGET_LABEL_INVALID: "TARGET_LABEL_INVALID",
  TARGET_PORT_INVALID: "TARGET_PORT_INVALID",
  TARGET_REQUIRED: "TARGET_REQUIRED",
} as const;

export type PublishedTargetHostErrorCode =
  (typeof PublishedTargetHostErrorCode)[keyof typeof PublishedTargetHostErrorCode];

type PublishedTargetHostErrorInput = {
  code: PublishedTargetHostErrorCode;
  message: string;
  cause?: unknown;
};

export class PublishedTargetHostError extends Error {
  readonly code: PublishedTargetHostErrorCode;

  constructor(input: PublishedTargetHostErrorInput) {
    super(input.message, { cause: input.cause });
    this.name = "PublishedTargetHostError";
    this.code = input.code;
  }
}

function normalizeHostComponent(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  if (normalized === undefined || normalized.length === 0) {
    return undefined;
  }

  return normalized.endsWith(".") ? normalized.slice(0, -1) : normalized;
}

function normalizeBaseDomain(baseDomain: string): string {
  const normalizedBaseDomain = normalizeHostComponent(baseDomain);
  if (normalizedBaseDomain === undefined) {
    throw new PublishedTargetHostError({
      code: PublishedTargetHostErrorCode.BASE_DOMAIN_REQUIRED,
      message: "Published target baseDomain is required.",
    });
  }

  if (normalizedBaseDomain.startsWith(".") || normalizedBaseDomain.includes("..")) {
    throw new PublishedTargetHostError({
      code: PublishedTargetHostErrorCode.BASE_DOMAIN_REQUIRED,
      message: "Published target baseDomain must be a canonical hostname suffix.",
    });
  }

  return normalizedBaseDomain;
}

function normalizeHost(host: string): string {
  const trimmedHost = normalizeHostComponent(host);
  if (trimmedHost === undefined) {
    throw new PublishedTargetHostError({
      code: PublishedTargetHostErrorCode.HOST_REQUIRED,
      message: "Published target host is required.",
    });
  }

  const colonIndex = trimmedHost.lastIndexOf(":");
  if (colonIndex === -1) {
    return trimmedHost;
  }

  const maybePort = trimmedHost.slice(colonIndex + 1);
  if (!/^[0-9]+$/.test(maybePort)) {
    throw new PublishedTargetHostError({
      code: PublishedTargetHostErrorCode.HOST_FORMAT_INVALID,
      message: "Published target host must not contain an invalid port suffix.",
    });
  }

  return trimmedHost.slice(0, colonIndex);
}

function normalizeSandboxInstanceId(value: string): string {
  const normalizedSandboxInstanceId = value.trim();
  if (normalizedSandboxInstanceId.length === 0) {
    throw new PublishedTargetHostError({
      code: PublishedTargetHostErrorCode.SANDBOX_INSTANCE_ID_REQUIRED,
      message: "Published target sandboxInstanceId is required.",
    });
  }

  if (normalizedSandboxInstanceId.includes("-")) {
    throw new PublishedTargetHostError({
      code: PublishedTargetHostErrorCode.SANDBOX_INSTANCE_ID_UNSUPPORTED,
      message: "Published target sandboxInstanceId cannot contain '-'.",
    });
  }

  return normalizedSandboxInstanceId.toLowerCase();
}

function encodeSandboxInstanceIdLabel(sandboxInstanceId: string): string {
  return normalizeSandboxInstanceId(sandboxInstanceId).replaceAll("_", "-");
}

function decodeSandboxInstanceIdLabel(encodedSandboxInstanceId: string): string {
  if (encodedSandboxInstanceId.length === 0) {
    throw new PublishedTargetHostError({
      code: PublishedTargetHostErrorCode.SANDBOX_INSTANCE_ID_REQUIRED,
      message: "Published target sandboxInstanceId label is required.",
    });
  }

  return encodedSandboxInstanceId.replaceAll("-", "_");
}

function normalizePort(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new PublishedTargetHostError({
      code: PublishedTargetHostErrorCode.TARGET_PORT_INVALID,
      message: "Published target port must be an integer between 1 and 65535.",
    });
  }

  return port;
}

function normalizeAppKey(appKey: string): string {
  const normalizedAppKey = appKey.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(normalizedAppKey)) {
    throw new PublishedTargetHostError({
      code: PublishedTargetHostErrorCode.TARGET_APP_KEY_INVALID,
      message: "Published target appKey must be a DNS-safe label.",
    });
  }

  return normalizedAppKey;
}

function deriveTargetLabel(target: PublishedTarget): string {
  if (target.kind === PublishedTargetKindValues.PORT) {
    return `p-${String(normalizePort(target.port))}`;
  }

  return `a-${normalizeAppKey(target.appKey)}`;
}

function parseTargetLabel(targetLabel: string): PublishedTarget {
  if (targetLabel.startsWith("p-")) {
    const encodedPort = targetLabel.slice(2);
    if (!/^[0-9]+$/.test(encodedPort)) {
      throw new PublishedTargetHostError({
        code: PublishedTargetHostErrorCode.TARGET_PORT_INVALID,
        message: "Published target host contains an invalid port label.",
      });
    }

    return {
      kind: "port",
      port: normalizePort(Number.parseInt(encodedPort, 10)),
    };
  }

  if (targetLabel.startsWith("a-")) {
    return {
      kind: "app",
      appKey: normalizeAppKey(targetLabel.slice(2)),
    };
  }

  throw new PublishedTargetHostError({
    code: PublishedTargetHostErrorCode.TARGET_LABEL_INVALID,
    message: "Published target host label must start with 'p-' or 'a-'.",
  });
}

export function derivePublishedTargetHost(input: {
  baseDomain: string;
  sandboxInstanceId: string;
  target: PublishedTarget;
}): string {
  const normalizedBaseDomain = normalizeBaseDomain(input.baseDomain);
  const normalizedTarget = input.target;
  if (normalizedTarget === undefined) {
    throw new PublishedTargetHostError({
      code: PublishedTargetHostErrorCode.TARGET_REQUIRED,
      message: "Published target is required.",
    });
  }

  const targetLabel = deriveTargetLabel(normalizedTarget);
  const sandboxInstanceIdLabel = encodeSandboxInstanceIdLabel(input.sandboxInstanceId);

  return `${targetLabel}--${sandboxInstanceIdLabel}.${normalizedBaseDomain}`;
}

export function parsePublishedTargetHost(input: {
  baseDomain: string;
  host: string;
}): ParsedPublishedTargetHost {
  const normalizedBaseDomain = normalizeBaseDomain(input.baseDomain);
  const normalizedHost = normalizeHost(input.host);
  const suffix = `.${normalizedBaseDomain}`;

  if (!normalizedHost.endsWith(suffix)) {
    throw new PublishedTargetHostError({
      code: PublishedTargetHostErrorCode.HOST_BASE_DOMAIN_MISMATCH,
      message: "Published target host does not match the configured baseDomain.",
    });
  }

  const encodedLabel = normalizedHost.slice(0, normalizedHost.length - suffix.length);
  if (encodedLabel.length === 0 || encodedLabel.includes(".")) {
    throw new PublishedTargetHostError({
      code: PublishedTargetHostErrorCode.HOST_FORMAT_INVALID,
      message:
        "Published target host must contain exactly one published label before the baseDomain.",
    });
  }

  const separatorIndex = encodedLabel.lastIndexOf("--");
  if (separatorIndex <= 0 || separatorIndex === encodedLabel.length - 2) {
    throw new PublishedTargetHostError({
      code: PublishedTargetHostErrorCode.HOST_FORMAT_INVALID,
      message: "Published target host must contain a target label and sandbox instance label.",
    });
  }

  const targetLabel = encodedLabel.slice(0, separatorIndex);
  const sandboxInstanceIdLabel = encodedLabel.slice(separatorIndex + 2);

  return {
    baseDomain: normalizedBaseDomain,
    host: normalizedHost,
    sandboxInstanceId: decodeSandboxInstanceIdLabel(sandboxInstanceIdLabel),
    target: parseTargetLabel(targetLabel),
  };
}
