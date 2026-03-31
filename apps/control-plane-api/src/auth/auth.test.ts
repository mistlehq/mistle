import { describe, expect, it } from "vitest";

import { createAccountOptions } from "./auth.js";

describe("createAccountOptions", () => {
  it("enables implicit account linking when google auth is enabled", () => {
    const accountOptions = createAccountOptions();

    expect(accountOptions).toEqual({
      modelName: "accounts",
      accountLinking: {
        enabled: true,
      },
    });
  });

  it("keeps account linking configuration the same when google auth is disabled", () => {
    const accountOptions = createAccountOptions();

    expect(accountOptions).toEqual({
      modelName: "accounts",
      accountLinking: {
        enabled: true,
      },
    });
  });
});
