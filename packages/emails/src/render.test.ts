import { describe, expect, it } from "vitest";

import { renderEmailText } from "./render.js";

describe("emails", () => {
  it("renders text from html", () => {
    const text = renderEmailText("<p>Hello <strong>world</strong></p>");
    expect(text).toContain("Hello");
    expect(text).toContain("world");
  });
});
