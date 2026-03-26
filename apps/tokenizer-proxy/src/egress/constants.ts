export const EGRESS_BASE_PATH = "/tokenizer-proxy/egress";
export const EGRESS_WILDCARD_BASE_PATH = "/tokenizer-proxy/egress/*";

export const EgressRequestHeaders = {
  GRANT: "X-Mistle-Egress-Grant",
} as const;
export const CREDENTIAL_RESOLVER_REQUEST_TIMEOUT_MS = 3000;
export const CREDENTIAL_CACHE_MAX_ENTRIES = 10000;
export const CREDENTIAL_CACHE_DEFAULT_TTL_SECONDS = 300;
export const CREDENTIAL_CACHE_REFRESH_SKEW_SECONDS = 30;
