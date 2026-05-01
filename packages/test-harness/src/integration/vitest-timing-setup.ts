import { beforeAll } from "vitest";

import { writeIntegrationTimingEvent } from "./timing.js";

writeIntegrationTimingEvent("vitest setup imported", `cwd=${process.cwd()}`);

beforeAll(() => {
  writeIntegrationTimingEvent("vitest beforeAll", `cwd=${process.cwd()}`);
});
