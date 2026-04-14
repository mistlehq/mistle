import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

import { resetDashboardConfigForTest } from "../config.js";
import { cleanupTestQueryClients, flushScheduledReactWork } from "../test-support/query-client.js";

Object.assign(import.meta.env, {
  VITE_CONTROL_PLANE_API_ORIGIN: "http://localhost:3000",
  VITE_AUTH_METHOD_GOOGLE: "true",
});

resetDashboardConfigForTest();

afterEach(async () => {
  cleanup();
  await cleanupTestQueryClients();
  await flushScheduledReactWork();
});
