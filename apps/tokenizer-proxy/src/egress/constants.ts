export const EGRESS_BASE_PATH = "/tokenizer-proxy/egress";
export const EGRESS_WILDCARD_BASE_PATH = "/tokenizer-proxy/egress/*";
export const LEGACY_EGRESS_ROUTE_BASE_PATH = "/tokenizer-proxy/egress/routes/:routeId/*";

export const EgressRequestHeaders = {
  ROUTE_ID: "X-Mistle-Egress-Route-Id",
  BINDING_ID: "X-Mistle-Egress-Binding-Id",
  UPSTREAM_BASE_URL: "X-Mistle-Egress-Upstream-Base-Url",
  AUTH_INJECTION_TYPE: "X-Mistle-Egress-Auth-Injection-Type",
  AUTH_INJECTION_TARGET: "X-Mistle-Egress-Auth-Injection-Target",
  AUTH_INJECTION_USERNAME: "X-Mistle-Egress-Auth-Injection-Username",
  CONNECTION_ID: "X-Mistle-Egress-Connection-Id",
  CREDENTIAL_SECRET_TYPE: "X-Mistle-Egress-Credential-Secret-Type",
  CREDENTIAL_PURPOSE: "X-Mistle-Egress-Credential-Purpose",
  CREDENTIAL_RESOLVER_KEY: "X-Mistle-Egress-Credential-Resolver-Key",
  SANDBOX_PROFILE_ID: "X-Mistle-Sandbox-Profile-Id",
  SANDBOX_PROFILE_VERSION: "X-Mistle-Sandbox-Profile-Version",
} as const;

export const CREDENTIAL_RESOLVER_REQUEST_TIMEOUT_MS = 3000;
export const CREDENTIAL_CACHE_MAX_ENTRIES = 10000;
export const CREDENTIAL_CACHE_DEFAULT_TTL_SECONDS = 300;
export const CREDENTIAL_CACHE_REFRESH_SKEW_SECONDS = 30;
