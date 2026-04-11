const Base32Alphabet = "abcdefghijklmnopqrstuvwxyz234567";
const Base32Characters = new Map(
  Base32Alphabet.split("").map((character, index) => [character, index]),
);
const Utf8Encoder = new TextEncoder();
const Utf8Decoder = new TextDecoder();

export type PortAccessHostConfig = {
  baseDomain: string;
};

export type ParsedPortAccessHost = {
  sandboxInstanceId: string;
  port: number;
  host: string;
};

export const PortAccessHostErrorCode = {
  BASE_DOMAIN_REQUIRED: "BASE_DOMAIN_REQUIRED",
  HOST_REQUIRED: "HOST_REQUIRED",
  SANDBOX_INSTANCE_ID_REQUIRED: "SANDBOX_INSTANCE_ID_REQUIRED",
  PORT_INVALID: "PORT_INVALID",
  HOST_FORMAT_INVALID: "HOST_FORMAT_INVALID",
  HOST_SANDBOX_ID_INVALID: "HOST_SANDBOX_ID_INVALID",
} as const;

export type PortAccessHostErrorCode =
  (typeof PortAccessHostErrorCode)[keyof typeof PortAccessHostErrorCode];

type PortAccessHostErrorInput = {
  code: PortAccessHostErrorCode;
  message: string;
  cause?: unknown;
};

export class PortAccessHostError extends Error {
  readonly code: PortAccessHostErrorCode;

  constructor(input: PortAccessHostErrorInput) {
    super(input.message, { cause: input.cause });
    this.name = "PortAccessHostError";
    this.code = input.code;
  }
}

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return undefined;
  }

  return trimmed;
}

function normalizeBaseDomain(baseDomain: string): string {
  const normalizedBaseDomain = trimToUndefined(baseDomain);
  if (normalizedBaseDomain === undefined) {
    throw new PortAccessHostError({
      code: PortAccessHostErrorCode.BASE_DOMAIN_REQUIRED,
      message: "Port Access baseDomain is required.",
    });
  }

  return normalizedBaseDomain.toLowerCase();
}

function encodeBase32(bytes: Uint8Array): string {
  let buffer = 0;
  let bitsInBuffer = 0;
  let encoded = "";

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitsInBuffer += 8;

    while (bitsInBuffer >= 5) {
      bitsInBuffer -= 5;
      encoded += Base32Alphabet[(buffer >> bitsInBuffer) & 31];
    }
  }

  if (bitsInBuffer > 0) {
    encoded += Base32Alphabet[(buffer << (5 - bitsInBuffer)) & 31];
  }

  return encoded;
}

function decodeBase32(value: string): Uint8Array {
  let buffer = 0;
  let bitsInBuffer = 0;
  const decoded: number[] = [];

  for (const character of value) {
    const decodedCharacter = Base32Characters.get(character);
    if (decodedCharacter === undefined) {
      throw new PortAccessHostError({
        code: PortAccessHostErrorCode.HOST_SANDBOX_ID_INVALID,
        message: "Port Access host sandbox token is invalid.",
      });
    }

    buffer = (buffer << 5) | decodedCharacter;
    bitsInBuffer += 5;

    while (bitsInBuffer >= 8) {
      bitsInBuffer -= 8;
      decoded.push((buffer >> bitsInBuffer) & 255);
    }
  }

  if (bitsInBuffer > 0 && ((buffer << (8 - bitsInBuffer)) & 255) !== 0) {
    throw new PortAccessHostError({
      code: PortAccessHostErrorCode.HOST_SANDBOX_ID_INVALID,
      message: "Port Access host sandbox token is invalid.",
    });
  }

  return Uint8Array.from(decoded);
}

function toHostSafeSandboxId(sandboxInstanceId: string): string {
  const normalizedSandboxInstanceId = trimToUndefined(sandboxInstanceId);
  if (normalizedSandboxInstanceId === undefined) {
    throw new PortAccessHostError({
      code: PortAccessHostErrorCode.SANDBOX_INSTANCE_ID_REQUIRED,
      message: "Port Access sandboxInstanceId is required.",
    });
  }

  return encodeBase32(Utf8Encoder.encode(normalizedSandboxInstanceId));
}

function parsePortNumber(port: number): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new PortAccessHostError({
      code: PortAccessHostErrorCode.PORT_INVALID,
      message: "Port Access port must be an integer between 1 and 65535.",
    });
  }

  return port;
}

export function derivePortAccessHost(input: {
  config: PortAccessHostConfig;
  sandboxInstanceId: string;
  port: number;
}): string {
  const baseDomain = normalizeBaseDomain(input.config.baseDomain);
  const port = parsePortNumber(input.port);
  const encodedSandboxId = toHostSafeSandboxId(input.sandboxInstanceId);

  return `p-${port}--${encodedSandboxId}.${baseDomain}`;
}

export function parsePortAccessHost(input: {
  config: PortAccessHostConfig;
  host: string;
}): ParsedPortAccessHost {
  const baseDomain = normalizeBaseDomain(input.config.baseDomain);
  const normalizedHost = trimToUndefined(input.host);
  if (normalizedHost === undefined) {
    throw new PortAccessHostError({
      code: PortAccessHostErrorCode.HOST_REQUIRED,
      message: "Port Access host is required.",
    });
  }

  const hostPattern = new RegExp(
    `^p-(?<port>[0-9]+)--(?<encodedSandboxId>[a-z2-7]+)\\.${baseDomain.replaceAll(".", "\\.")}(?::(?<edgePort>[0-9]+))?$`,
  );
  const match = hostPattern.exec(normalizedHost.toLowerCase());
  if (match?.groups?.port === undefined || match.groups.encodedSandboxId === undefined) {
    throw new PortAccessHostError({
      code: PortAccessHostErrorCode.HOST_FORMAT_INVALID,
      message: "Port Access host format is invalid.",
    });
  }

  const port = parsePortNumber(Number.parseInt(match.groups.port, 10));

  let sandboxInstanceId: string;
  try {
    sandboxInstanceId = Utf8Decoder.decode(decodeBase32(match.groups.encodedSandboxId));
  } catch (error) {
    if (error instanceof PortAccessHostError) {
      throw error;
    }

    throw new PortAccessHostError({
      code: PortAccessHostErrorCode.HOST_SANDBOX_ID_INVALID,
      message: "Port Access host sandbox token is invalid.",
      cause: error,
    });
  }

  if (sandboxInstanceId.length === 0) {
    throw new PortAccessHostError({
      code: PortAccessHostErrorCode.HOST_SANDBOX_ID_INVALID,
      message: "Port Access host sandbox token is invalid.",
    });
  }

  return {
    sandboxInstanceId,
    port,
    host: `p-${port}--${match.groups.encodedSandboxId}.${baseDomain}`,
  };
}
