import type { Client } from "openapi-fetch";
import createClient from "openapi-fetch";

import type { paths } from "../../apps/dashboard/src/lib/control-plane-api/generated/schema.js";

export type ControlPlaneApiClient = Client<paths>;

export function createControlPlaneApiClient(baseUrl: string): ControlPlaneApiClient {
  return createClient<paths>({
    baseUrl,
  });
}
