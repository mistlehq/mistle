import { describe, expect, it } from "vitest";

import { updateMstlGoVersion } from "./mstl-version.js";

describe("updateMstlGoVersion", () => {
  it("updates the Go CLI version constant", () => {
    const source = `const (
\tVersion = "0.16.0"

defaultControlPlaneAPIPublicURL = "http://localhost:5100"
)`;

    expect(updateMstlGoVersion(source, "0.17.0")).toBe(`const (
\tVersion = "0.17.0"

defaultControlPlaneAPIPublicURL = "http://localhost:5100"
)`);
  });
});
