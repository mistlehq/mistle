type DashboardEnv = {
  readonly VITE_CONTROL_PLANE_API_ORIGIN?: string;
  readonly VITE_POSTHOG_ENABLED?: string;
  readonly VITE_POSTHOG_PROJECT_API_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
};

export type DashboardPostHogConfig =
  | {
      enabled: false;
    }
  | {
      enabled: true;
      projectApiKey: string;
      host: string;
    };

export type DashboardConfig = {
  controlPlaneApiOrigin: string;
  authBasePath: "/v1/auth";
  posthog: DashboardPostHogConfig;
};

const SameOriginControlPlaneApiOrigin = "same-origin";

function parseRequiredUrlOrigin(value: string, key: string): string {
  if (value === SameOriginControlPlaneApiOrigin) {
    if (globalThis.location?.origin === undefined) {
      throw new Error(`${key} cannot use same-origin outside a browser environment.`);
    }

    return globalThis.location.origin;
  }

  if (value.trim().length === 0) {
    throw new Error(`${key} must be a valid absolute URL origin.`);
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`${key} must be a valid absolute URL origin.`);
    }
    return parsed.origin;
  } catch {
    throw new Error(`${key} must be a valid absolute URL origin.`);
  }
}

function parseOptionalBoolean(value: string | undefined, key: string): boolean {
  if (value === undefined || value.trim().length === 0) {
    return false;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`${key} must be either "true" or "false".`);
}

function parseDashboardPostHogConfig(env: DashboardEnv): DashboardPostHogConfig {
  const enabled = parseOptionalBoolean(env.VITE_POSTHOG_ENABLED, "VITE_POSTHOG_ENABLED");
  if (!enabled) {
    return { enabled: false };
  }

  const projectApiKey = env.VITE_POSTHOG_PROJECT_API_KEY;
  if (projectApiKey === undefined || projectApiKey.trim().length === 0) {
    throw new Error("VITE_POSTHOG_PROJECT_API_KEY is required when VITE_POSTHOG_ENABLED is true.");
  }

  const host = env.VITE_POSTHOG_HOST;
  if (host === undefined || host.trim().length === 0) {
    throw new Error("VITE_POSTHOG_HOST is required when VITE_POSTHOG_ENABLED is true.");
  }

  return {
    enabled: true,
    projectApiKey,
    host: parseRequiredUrlOrigin(host, "VITE_POSTHOG_HOST"),
  };
}

export function buildDashboardConfig(env: DashboardEnv): DashboardConfig {
  const configuredOrigin = env.VITE_CONTROL_PLANE_API_ORIGIN;
  if (!configuredOrigin || configuredOrigin.trim().length === 0) {
    throw new Error("VITE_CONTROL_PLANE_API_ORIGIN is required.");
  }

  return {
    controlPlaneApiOrigin: parseRequiredUrlOrigin(
      configuredOrigin,
      "VITE_CONTROL_PLANE_API_ORIGIN",
    ),
    authBasePath: "/v1/auth",
    posthog: parseDashboardPostHogConfig(env),
  };
}

let cachedDashboardConfig: DashboardConfig | undefined;

function readDashboardEnvironment(): DashboardEnv {
  return {
    VITE_CONTROL_PLANE_API_ORIGIN: import.meta.env.VITE_CONTROL_PLANE_API_ORIGIN,
    VITE_POSTHOG_ENABLED: import.meta.env.VITE_POSTHOG_ENABLED,
    VITE_POSTHOG_PROJECT_API_KEY: import.meta.env.VITE_POSTHOG_PROJECT_API_KEY,
    VITE_POSTHOG_HOST: import.meta.env.VITE_POSTHOG_HOST,
  };
}

export function getDashboardConfig(): DashboardConfig {
  if (cachedDashboardConfig) {
    return cachedDashboardConfig;
  }

  cachedDashboardConfig = buildDashboardConfig(readDashboardEnvironment());

  return cachedDashboardConfig;
}

export function resetDashboardConfigForTest(): void {
  cachedDashboardConfig = undefined;
}
