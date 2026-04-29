import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import { resetDashboardConfigForTest } from "../config.js";
import { resetAuthClientForTest } from "../lib/auth/client.js";
import { cleanupTestQueryClients, flushScheduledReactWork } from "../test-support/query-client.js";

Object.assign(import.meta.env, {
  VITE_CONTROL_PLANE_API_ORIGIN: "http://localhost:3000",
});

resetDashboardConfigForTest();
resetAuthClientForTest();

afterEach(async () => {
  cleanup();
  const cleanedQueryClients = await cleanupTestQueryClients();
  if (cleanedQueryClients) {
    await flushScheduledReactWork();
  }
});
