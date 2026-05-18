import { describe, expect, it } from "vitest";

import { DeleteScheduledTriggerResultSchema } from "./scheduled-triggers-types.js";

describe("scheduled triggers types", () => {
  it("parses delete responses", () => {
    const parsed = DeleteScheduledTriggerResultSchema.parse({
      triggerId: "trg_123",
    });

    expect(parsed).toEqual({
      triggerId: "trg_123",
    });
  });
});
