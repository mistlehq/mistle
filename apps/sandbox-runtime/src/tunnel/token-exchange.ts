import { systemScheduler } from "@mistle/time";

import { logSandboxRuntimeEvent } from "../runtime/logger.js";

const TUNNEL_TOKEN_EXCHANGE_ROUTE_SUFFIX = "/token-exchange";
const TUNNEL_RECONNECT_DELAY_MS = 1_000;

type TunnelTokenExchangeResponse = {
  bootstrapToken: string;
  tunnelExchangeToken: string;
};

export class TunnelTokenExchangeError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class TunnelTokens {
  #bootstrapToken: string;
  #tunnelExchangeToken: string;

  constructor(bootstrapToken: string, tunnelExchangeToken: string) {
    this.#bootstrapToken = normalizeTunnelTokenValue("bootstrap", bootstrapToken);
    this.#tunnelExchangeToken = normalizeTunnelTokenValue("exchange", tunnelExchangeToken);
  }

  currentBootstrapToken(): string {
    return this.#bootstrapToken;
  }

  currentTunnelExchangeToken(): string {
    return this.#tunnelExchangeToken;
  }

  replace(bootstrapToken: string, tunnelExchangeToken: string): void {
    this.#bootstrapToken = normalizeTunnelTokenValue("bootstrap", bootstrapToken);
    this.#tunnelExchangeToken = normalizeTunnelTokenValue("exchange", tunnelExchangeToken);
  }
}

function normalizeTunnelTokenValue(tokenKind: string, token: string): string {
  const normalizedToken = token.trim();
  if (normalizedToken.length === 0) {
    throw new Error(`sandbox tunnel ${tokenKind} token is required`);
  }

  return normalizedToken;
}

export function buildTunnelTokenExchangeUrl(gatewayWsUrl: string): string {
  const parsedGatewayUrl = parseGatewayUrl(gatewayWsUrl);
  parsedGatewayUrl.protocol = parsedGatewayUrl.protocol === "wss:" ? "https:" : "http:";
  parsedGatewayUrl.pathname =
    parsedGatewayUrl.pathname.replace(/\/+$/, "") + TUNNEL_TOKEN_EXCHANGE_ROUTE_SUFFIX;
  parsedGatewayUrl.search = "";
  parsedGatewayUrl.hash = "";

  return parsedGatewayUrl.toString();
}

export function parseGatewayUrl(gatewayWsUrl: string): URL {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(gatewayWsUrl);
  } catch (error) {
    throw new Error(
      `failed to parse sandbox tunnel gateway ws url: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (parsedUrl.protocol !== "ws:" && parsedUrl.protocol !== "wss:") {
    throw new Error("sandbox tunnel gateway ws url must use ws or wss scheme");
  }

  return parsedUrl;
}

export function normalizeBootstrapToken(bootstrapToken: string): string {
  const normalizedToken = bootstrapToken.trim();
  if (normalizedToken.length === 0) {
    throw new Error("sandbox tunnel bootstrap token is required");
  }

  return normalizedToken;
}

export function nextTunnelReconnectDelay(): number {
  return TUNNEL_RECONNECT_DELAY_MS;
}

export function parseTunnelTokenJwtWindow(token: string): {
  issuedAt: Date;
  expiresAt: Date;
} {
  const normalizedToken = normalizeTunnelTokenValue("exchange", token);
  const tokenSegments = normalizedToken.split(".");
  if (tokenSegments.length !== 3) {
    throw new Error("sandbox tunnel exchange token must be a JWT");
  }

  const payloadSegment = tokenSegments[1];
  if (payloadSegment === undefined) {
    throw new Error("sandbox tunnel exchange token must be a JWT");
  }

  let payloadBytes: Buffer;
  try {
    payloadBytes = Buffer.from(payloadSegment, "base64url");
  } catch (error) {
    throw new Error(
      `failed to decode sandbox tunnel exchange token payload: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(payloadBytes.toString("utf8"));
  } catch (error) {
    throw new Error(
      `failed to parse sandbox tunnel exchange token payload: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const issuedAtSeconds =
    typeof payload === "object" && payload !== null && "iat" in payload ? payload.iat : undefined;
  const expiresAtSeconds =
    typeof payload === "object" && payload !== null && "exp" in payload ? payload.exp : undefined;
  if (typeof issuedAtSeconds !== "number") {
    throw new Error("sandbox tunnel exchange token iat claim is required");
  }
  if (typeof expiresAtSeconds !== "number") {
    throw new Error("sandbox tunnel exchange token exp claim is required");
  }

  const issuedAt = new Date(issuedAtSeconds * 1_000);
  const expiresAt = new Date(expiresAtSeconds * 1_000);
  if (!(expiresAt > issuedAt)) {
    throw new Error("sandbox tunnel exchange token exp claim must be after iat");
  }

  return { issuedAt, expiresAt };
}

export function nextTunnelTokenExchangeDelay(now: Date, issuedAt: Date, expiresAt: Date): number {
  if (!(expiresAt > issuedAt)) {
    throw new Error("sandbox tunnel exchange token exp claim must be after iat");
  }

  const renewAt = new Date(
    issuedAt.getTime() + ((expiresAt.getTime() - issuedAt.getTime()) * 4) / 5,
  );
  if (!(renewAt > now)) {
    return 0;
  }

  return renewAt.getTime() - now.getTime();
}

function validateTunnelTokenExchangeResponse(response: TunnelTokenExchangeResponse): void {
  normalizeTunnelTokenValue("bootstrap", response.bootstrapToken);
  normalizeTunnelTokenValue("exchange", response.tunnelExchangeToken);
}

export async function exchangeTunnelTokens(
  gatewayWsUrl: string,
  tunnelExchangeToken: string,
): Promise<TunnelTokenExchangeResponse> {
  const response = await fetch(buildTunnelTokenExchangeUrl(gatewayWsUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${tunnelExchangeToken}`,
    },
  }).catch((error: unknown) => {
    throw new TunnelTokenExchangeError(
      `sandbox tunnel token exchange request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  });

  if (response.status !== 200) {
    throw new TunnelTokenExchangeError(
      `sandbox tunnel token exchange request failed with status ${String(response.status)}`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(
      `failed to decode sandbox tunnel token exchange response: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("failed to decode sandbox tunnel token exchange response: expected object");
  }

  const bootstrapToken = Object.getOwnPropertyDescriptor(payload, "bootstrapToken")?.value;
  const rotatedExchangeToken = Object.getOwnPropertyDescriptor(
    payload,
    "tunnelExchangeToken",
  )?.value;
  if (typeof bootstrapToken !== "string" || typeof rotatedExchangeToken !== "string") {
    throw new Error("sandbox tunnel token exchange response is invalid");
  }

  const normalizedResponse = {
    bootstrapToken,
    tunnelExchangeToken: rotatedExchangeToken,
  };
  validateTunnelTokenExchangeResponse(normalizedResponse);

  return normalizedResponse;
}

export async function exchangeTunnelTokensNow(
  gatewayWsUrl: string,
  tokens: TunnelTokens,
): Promise<void> {
  const currentExchangeToken = tokens.currentTunnelExchangeToken();
  const exchangeResponse = await exchangeTunnelTokens(gatewayWsUrl, currentExchangeToken);
  parseTunnelTokenJwtWindow(exchangeResponse.tunnelExchangeToken);
  tokens.replace(exchangeResponse.bootstrapToken, exchangeResponse.tunnelExchangeToken);
}

export async function runTunnelTokenExchangeLoop(input: {
  signal: AbortSignal;
  gatewayWsUrl: string;
  tokens: TunnelTokens;
  now?: () => Date;
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}): Promise<void> {
  const now = input.now ?? (() => new Date());
  const sleep =
    input.sleep ??
    ((delayMs: number, signal: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        const timeout = systemScheduler.schedule(() => {
          signal.removeEventListener("abort", abortListener);
          resolve();
        }, delayMs);
        const abortListener = (): void => {
          systemScheduler.cancel(timeout);
          reject(signal.reason ?? new Error("operation was aborted"));
        };

        if (signal.aborted) {
          abortListener();
          return;
        }

        signal.addEventListener("abort", abortListener, { once: true });
      }));

  while (!input.signal.aborted) {
    const { issuedAt, expiresAt } = parseTunnelTokenJwtWindow(
      input.tokens.currentTunnelExchangeToken(),
    );
    const exchangeDelay = nextTunnelTokenExchangeDelay(now(), issuedAt, expiresAt);
    await sleep(exchangeDelay, input.signal);

    try {
      await exchangeTunnelTokensNow(input.gatewayWsUrl, input.tokens);
    } catch (error) {
      logSandboxRuntimeEvent({
        level: "warn",
        event: "sandbox_tunnel_token_exchange_failed",
        fields: {
          retryDelayMs: nextTunnelReconnectDelay(),
          message:
            error instanceof Error
              ? error.message
              : typeof error === "string"
                ? error
                : "unknown token exchange error",
        },
      });
      await sleep(nextTunnelReconnectDelay(), input.signal);
    }
  }
}
