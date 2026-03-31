import { z } from "zod";

import { getDashboardConfig } from "../../config.js";
import { requestControlPlane } from "../api/request-control-plane.js";

const AuthCapabilitiesSchema = z
  .object({
    methods: z
      .object({
        emailOtp: z.boolean(),
        google: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type AuthCapabilities = z.infer<typeof AuthCapabilitiesSchema>;

export function parseAuthCapabilities(input: unknown): AuthCapabilities {
  return AuthCapabilitiesSchema.parse(input);
}

export async function fetchAuthCapabilities(): Promise<AuthCapabilities> {
  const dashboardConfig = getDashboardConfig();
  const response = await requestControlPlane({
    operation: "authApi:/capabilities",
    pathname: "/capabilities",
    method: "GET",
    basePath: dashboardConfig.authBasePath,
    fallbackMessage: "Could not load sign-in methods.",
  });

  return parseAuthCapabilities(await response.json().catch(() => null));
}
