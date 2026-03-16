type ResolveBaselineProxyEnvironmentInput = {
  listenAddr: string;
  tokenizerProxyEgressBaseUrl: string;
};

function parseListenAddress(listenAddr: string): { host?: string; port: number } {
  if (listenAddr.startsWith(":")) {
    const port = Number.parseInt(listenAddr.slice(1), 10);
    if (!Number.isInteger(port) || port < 0 || port > 65_535) {
      throw new Error(`invalid listen addr ${listenAddr}`);
    }

    return { port };
  }

  const separatorIndex = listenAddr.lastIndexOf(":");
  if (separatorIndex < 1 || separatorIndex === listenAddr.length - 1) {
    throw new Error(`invalid listen addr ${listenAddr}`);
  }

  const host = listenAddr.slice(0, separatorIndex);
  const port = Number.parseInt(listenAddr.slice(separatorIndex + 1), 10);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`invalid listen addr ${listenAddr}`);
  }

  return {
    host,
    port,
  };
}

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
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    NO_PROXY: noProxyValue,
    http_proxy: proxyUrl,
    https_proxy: proxyUrl,
    no_proxy: noProxyValue,
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
