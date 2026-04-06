import { describe, expect, it } from "vitest";

import { buildBasicAuthorizationHeader } from "./basic-auth.js";

describe("buildBasicAuthorizationHeader", () => {
  it("encodes the username and password as a Basic auth header", () => {
    expect(
      buildBasicAuthorizationHeader({
        username: "jira@example.com",
        password: "api-token",
      }),
    ).toBe("Basic amlyYUBleGFtcGxlLmNvbTphcGktdG9rZW4=");
  });
});
