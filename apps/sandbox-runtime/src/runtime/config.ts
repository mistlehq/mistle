const HttpSchemes = new Set(["http:", "https:"]);

export const ListenAddrEnv = "SANDBOX_RUNTIME_LISTEN_ADDR";
export const TokenizerProxyEgressBaseUrlEnv = "SANDBOX_RUNTIME_TOKENIZER_PROXY_EGRESS_BASE_URL";
export const ProxyCaCertFdEnv = "SANDBOX_RUNTIME_PROXY_CA_CERT_FD";
export const ProxyCaKeyFdEnv = "SANDBOX_RUNTIME_PROXY_CA_KEY_FD";

export type RuntimeConfig = {
  listenAddr: string;
  tokenizerProxyEgressBaseUrl: string;
  proxyCaCertFd: number;
  proxyCaKeyFd: number;
  proxyCaConfigured: boolean;
};

type LookupEnv = (key: string) => string | undefined;

function requireEnvValue(lookupEnv: LookupEnv, envName: string): string {
  const rawValue = lookupEnv(envName);
  if (rawValue === undefined || rawValue.length === 0) {
    throw new Error(`${envName} is required`);
  }

  return rawValue;
}

function normalizeUrl(rawValue: string): string {
  const trimmedValue = rawValue.trim();
  if (trimmedValue.length === 0) {
    throw new Error("value is required");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedValue);
  } catch (error) {
    throw new Error(
      `value must be a valid URL: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!HttpSchemes.has(parsedUrl.protocol)) {
    throw new Error("value must use http or https scheme");
  }

  if (parsedUrl.host.length === 0) {
    throw new Error("value host is required");
  }

  return parsedUrl.toString();
}

function parseFdEnv(envName: string, rawValue: string): number {
  const trimmedValue = rawValue.trim();
  if (trimmedValue.length === 0) {
    throw new Error(`${envName} must not be empty when set`);
  }

  const parsedValue = Number.parseInt(trimmedValue, 10);
  if (!Number.isInteger(parsedValue)) {
    throw new Error(`${envName} must be a valid file descriptor number`);
  }

  if (parsedValue < 0) {
    throw new Error(`${envName} must be non-negative`);
  }

  return parsedValue;
}

export function loadRuntimeConfig(lookupEnv: LookupEnv): RuntimeConfig {
  const listenAddr = requireEnvValue(lookupEnv, ListenAddrEnv);

  const tokenizerProxyEgressBaseUrlValue = requireEnvValue(
    lookupEnv,
    TokenizerProxyEgressBaseUrlEnv,
  );
  let tokenizerProxyEgressBaseUrl: string;
  try {
    tokenizerProxyEgressBaseUrl = normalizeUrl(tokenizerProxyEgressBaseUrlValue);
  } catch (error) {
    throw new Error(
      `${TokenizerProxyEgressBaseUrlEnv} is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const proxyCaCertFdValue = lookupEnv(ProxyCaCertFdEnv);
  const proxyCaKeyFdValue = lookupEnv(ProxyCaKeyFdEnv);

  if ((proxyCaCertFdValue === undefined) !== (proxyCaKeyFdValue === undefined)) {
    throw new Error(`${ProxyCaCertFdEnv} and ${ProxyCaKeyFdEnv} must be set together`);
  }

  if (proxyCaCertFdValue === undefined || proxyCaKeyFdValue === undefined) {
    return {
      listenAddr,
      tokenizerProxyEgressBaseUrl,
      proxyCaCertFd: 0,
      proxyCaKeyFd: 0,
      proxyCaConfigured: false,
    };
  }

  return {
    listenAddr,
    tokenizerProxyEgressBaseUrl,
    proxyCaCertFd: parseFdEnv(ProxyCaCertFdEnv, proxyCaCertFdValue),
    proxyCaKeyFd: parseFdEnv(ProxyCaKeyFdEnv, proxyCaKeyFdValue),
    proxyCaConfigured: true,
  };
}
