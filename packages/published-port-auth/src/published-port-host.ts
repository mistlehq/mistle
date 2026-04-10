const Base32Alphabet = "abcdefghijklmnopqrstuvwxyz234567";
const Base32BitsPerChar = 5;

export type PublishHostConfig = {
  baseDomain: string;
};

export type ParsedPublishedPortHost = {
  host: string;
  encodedSandboxId: string;
  sandboxInstanceId: string;
  port: number;
};

export const PublishedPortHostErrorCode = {
  BASE_DOMAIN_REQUIRED: "BASE_DOMAIN_REQUIRED",
  HOST_REQUIRED: "HOST_REQUIRED",
  HOST_FORMAT_INVALID: "HOST_FORMAT_INVALID",
  PORT_INVALID: "PORT_INVALID",
  SANDBOX_INSTANCE_ID_REQUIRED: "SANDBOX_INSTANCE_ID_REQUIRED",
  SANDBOX_INSTANCE_ID_ENCODING_INVALID: "SANDBOX_INSTANCE_ID_ENCODING_INVALID",
} as const;

export type PublishedPortHostErrorCode =
  (typeof PublishedPortHostErrorCode)[keyof typeof PublishedPortHostErrorCode];

export class PublishedPortHostError extends Error {
  readonly code: PublishedPortHostErrorCode;

  public constructor(input: {
    code: PublishedPortHostErrorCode;
    message: string;
    cause?: unknown;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "PublishedPortHostError";
    this.code = input.code;
  }
}

function requireNonEmptyString(input: {
  code: PublishedPortHostErrorCode;
  field: string;
  value: string;
}): string {
  const normalized = input.value.trim();
  if (normalized.length === 0) {
    throw new PublishedPortHostError({
      code: input.code,
      message: `${input.field} is required.`,
    });
  }

  return normalized;
}

function assertPort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new PublishedPortHostError({
      code: PublishedPortHostErrorCode.PORT_INVALID,
      message: "Published port must be an integer between 1 and 65535.",
    });
  }
}

function encodeBase32(input: Uint8Array): string {
  let encoded = "";
  let buffer = 0;
  let bits = 0;

  for (const byte of input) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= Base32BitsPerChar) {
      bits -= Base32BitsPerChar;
      encoded += Base32Alphabet[(buffer >> bits) & 0x1f];
    }
  }

  if (bits > 0) {
    encoded += Base32Alphabet[(buffer << (Base32BitsPerChar - bits)) & 0x1f];
  }

  return encoded;
}

function decodeBase32(input: string): Uint8Array {
  let buffer = 0;
  let bits = 0;
  const bytes: number[] = [];

  for (const character of input) {
    const alphabetIndex = Base32Alphabet.indexOf(character);
    if (alphabetIndex === -1) {
      throw new PublishedPortHostError({
        code: PublishedPortHostErrorCode.SANDBOX_INSTANCE_ID_ENCODING_INVALID,
        message: "Published host sandbox id encoding is invalid.",
      });
    }

    buffer = (buffer << Base32BitsPerChar) | alphabetIndex;
    bits += Base32BitsPerChar;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) {
    throw new PublishedPortHostError({
      code: PublishedPortHostErrorCode.SANDBOX_INSTANCE_ID_ENCODING_INVALID,
      message: "Published host sandbox id encoding is invalid.",
    });
  }

  return Uint8Array.from(bytes);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function encodeSandboxInstanceId(sandboxInstanceId: string): string {
  return encodeBase32(new TextEncoder().encode(sandboxInstanceId));
}

function decodeSandboxInstanceId(encodedSandboxId: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(decodeBase32(encodedSandboxId));
  } catch (error) {
    if (error instanceof PublishedPortHostError) {
      throw error;
    }

    throw new PublishedPortHostError({
      code: PublishedPortHostErrorCode.SANDBOX_INSTANCE_ID_ENCODING_INVALID,
      message: "Published host sandbox id encoding is invalid.",
      cause: error,
    });
  }
}

export function derivePublishedPortHost(input: {
  config: PublishHostConfig;
  sandboxInstanceId: string;
  port: number;
}): string {
  const baseDomain = requireNonEmptyString({
    code: PublishedPortHostErrorCode.BASE_DOMAIN_REQUIRED,
    field: "Published host baseDomain",
    value: input.config.baseDomain,
  });
  const sandboxInstanceId = requireNonEmptyString({
    code: PublishedPortHostErrorCode.SANDBOX_INSTANCE_ID_REQUIRED,
    field: "Published host sandboxInstanceId",
    value: input.sandboxInstanceId,
  });
  assertPort(input.port);

  const encodedSandboxId = encodeSandboxInstanceId(sandboxInstanceId);
  return `p-${String(input.port)}--${encodedSandboxId}.${baseDomain}`;
}

export function parsePublishedPortHost(input: {
  config: PublishHostConfig;
  host: string;
}): ParsedPublishedPortHost {
  const baseDomain = requireNonEmptyString({
    code: PublishedPortHostErrorCode.BASE_DOMAIN_REQUIRED,
    field: "Published host baseDomain",
    value: input.config.baseDomain,
  });
  const host = requireNonEmptyString({
    code: PublishedPortHostErrorCode.HOST_REQUIRED,
    field: "Published host",
    value: input.host,
  });

  const hostPattern = new RegExp(
    `^p-(?<port>[1-9]\\d*)--(?<encodedSandboxId>[a-z2-7]+)\\.${escapeRegex(baseDomain)}(?::\\d+)?$`,
    "u",
  );
  const match = hostPattern.exec(host);
  if (match?.groups === undefined) {
    throw new PublishedPortHostError({
      code: PublishedPortHostErrorCode.HOST_FORMAT_INVALID,
      message: "Published host format is invalid.",
    });
  }

  const port = Number.parseInt(match.groups.port ?? "", 10);
  assertPort(port);

  const encodedSandboxId = match.groups.encodedSandboxId ?? "";
  const sandboxInstanceId = decodeSandboxInstanceId(encodedSandboxId);

  return {
    host: host.replace(/:\d+$/u, ""),
    encodedSandboxId,
    sandboxInstanceId,
    port,
  };
}
