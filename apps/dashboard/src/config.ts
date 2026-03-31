type DashboardEnv = {
  readonly VITE_CONTROL_PLANE_API_ORIGIN?: string;
  readonly VITE_AUTH_METHOD_EMAIL_OTP?: string;
  readonly VITE_AUTH_METHOD_GOOGLE?: string;
};

export type DashboardConfig = {
  controlPlaneApiOrigin: string;
  authBasePath: "/v1/auth";
  authMethods: {
    emailOtp: boolean;
    google: boolean;
  };
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

function parseRequiredBoolean(value: string | undefined, key: string): boolean {
  if (value === undefined) {
    throw new Error(`${key} is required.`);
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`${key} must be either "true" or "false".`);
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
    authMethods: {
      emailOtp: parseRequiredBoolean(env.VITE_AUTH_METHOD_EMAIL_OTP, "VITE_AUTH_METHOD_EMAIL_OTP"),
      google: parseRequiredBoolean(env.VITE_AUTH_METHOD_GOOGLE, "VITE_AUTH_METHOD_GOOGLE"),
    },
  };
}

let cachedDashboardConfig: DashboardConfig | undefined;

export function getDashboardConfig(): DashboardConfig {
  if (cachedDashboardConfig) {
    return cachedDashboardConfig;
  }

  cachedDashboardConfig = buildDashboardConfig({
    VITE_CONTROL_PLANE_API_ORIGIN: import.meta.env.VITE_CONTROL_PLANE_API_ORIGIN,
    VITE_AUTH_METHOD_EMAIL_OTP: import.meta.env.VITE_AUTH_METHOD_EMAIL_OTP,
    VITE_AUTH_METHOD_GOOGLE: import.meta.env.VITE_AUTH_METHOD_GOOGLE,
  });

  return cachedDashboardConfig;
}

export function resetDashboardConfigForTest(): void {
  cachedDashboardConfig = undefined;
}
