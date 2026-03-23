import { parseListenAddress } from "../parse-listen-address.js";

type ResolveBaselineProxyEnvironmentInput = {
  listenAddr: string;
  tokenizerProxyEgressBaseUrl: string;
};

function resolveLoopbackProxyUrl(listenAddr: string): string {
  const { port } = parseListenAddress(listenAddr);
  return `http://127.0.0.1:${port}`;
}

function resolveNoProxyEntries(tokenizerProxyEgressBaseUrl: string): ReadonlyArray<string> {
  const parsedTokenizerProxyUrl = new URL(tokenizerProxyEgressBaseUrl.trim());
  const entries = new Set<string>(["127.0.0.1", "localhost", "::1"]);

  if (parsedTokenizerProxyUrl.host.length > 0) {
    entries.add(parsedTokenizerProxyUrl.host);
  }
  if (parsedTokenizerProxyUrl.hostname.length > 0) {
    entries.add(parsedTokenizerProxyUrl.hostname);
  }

  return [...entries].sort();
}

export function resolveBaselineProxyEnvironment(
  input: ResolveBaselineProxyEnvironmentInput,
): Record<string, string> {
  const proxyUrl = resolveLoopbackProxyUrl(input.listenAddr);
  const noProxyValue = resolveNoProxyEntries(input.tokenizerProxyEgressBaseUrl).join(",");

  return {
    ALL_PROXY: proxyUrl,
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    NO_PROXY: noProxyValue,
    WS_PROXY: proxyUrl,
    WSS_PROXY: proxyUrl,
    all_proxy: proxyUrl,
    http_proxy: proxyUrl,
    https_proxy: proxyUrl,
    no_proxy: noProxyValue,
    ws_proxy: proxyUrl,
    wss_proxy: proxyUrl,
  };
}

export function applyEnvironmentEntries(entries: Record<string, string>): () => void {
  const originalValues = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(entries)) {
    originalValues.set(key, process.env[key]);
    process.env[key] = value;
  }

  return () => {
    for (const [key, originalValue] of originalValues.entries()) {
      if (originalValue === undefined) {
        delete process.env[key];
        continue;
      }

      process.env[key] = originalValue;
    }
  };
}
