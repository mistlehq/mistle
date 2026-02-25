type DashboardEnv = {
  readonly VITE_CONTROL_PLANE_API_ORIGIN?: string;
};

export type DashboardConfig = {
  controlPlaneApiOrigin: string;
  authBasePath: "/v1/auth";
};

function parseRequiredUrlOrigin(value: string, key: string): string {
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
  };
}

let cachedDashboardConfig: DashboardConfig | undefined;

export function getDashboardConfig(): DashboardConfig {
  if (cachedDashboardConfig) {
    return cachedDashboardConfig;
  }

  cachedDashboardConfig = buildDashboardConfig({
    VITE_CONTROL_PLANE_API_ORIGIN: import.meta.env.VITE_CONTROL_PLANE_API_ORIGIN,
  });

  return cachedDashboardConfig;
}
