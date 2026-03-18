import type { Client } from "openapi-fetch";
import createClient from "openapi-fetch";

import { getDashboardConfig } from "../../config.js";
import type { paths } from "./generated/schema.js";

let controlPlaneApiClient: Client<paths> | null = null;

export function getControlPlaneApiClient(): Client<paths> {
  if (controlPlaneApiClient !== null) {
    return controlPlaneApiClient;
  }

  const config = getDashboardConfig();
  controlPlaneApiClient = createClient<paths>({
    baseUrl: config.controlPlaneApiOrigin,
  });

  return controlPlaneApiClient;
}

export function resetControlPlaneApiClientForTest(): void {
  controlPlaneApiClient = null;
}
