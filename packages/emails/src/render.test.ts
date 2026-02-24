import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { renderEmailText } from "./render.js";

describe("emails", () => {
  it("renders text from a template", async () => {
    const text = await renderEmailText(
      createElement("p", {}, "Hello ", createElement("strong", {}, "world")),
    );
    expect(text).toContain("Hello");
    expect(text).toContain("world");
  });
});
