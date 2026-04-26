import { describe, expect, it } from "vitest";

import { buildUrlWithPath } from "./url.js";

describe("buildUrlWithPath", () => {
  it("appends paths to an origin-only base URL", () => {
    expect(buildUrlWithPath("https://control-plane.mistle.test", "/p/foo")).toBe(
      "https://control-plane.mistle.test/p/foo",
    );
  });

  it("handles base URLs with trailing slashes", () => {
    expect(buildUrlWithPath("https://control-plane.mistle.test/", "/p/foo")).toBe(
      "https://control-plane.mistle.test/p/foo",
    );
  });

  it("preserves base URL path prefixes", () => {
    expect(buildUrlWithPath("https://control-plane.mistle.test/base", "/p/foo")).toBe(
      "https://control-plane.mistle.test/base/p/foo",
    );
  });

  it("strips base URL query and hash", () => {
    expect(buildUrlWithPath("https://control-plane.mistle.test/base?x=1#frag", "/p/foo")).toBe(
      "https://control-plane.mistle.test/base/p/foo",
    );
  });

  it("preserves query strings from the path", () => {
    expect(buildUrlWithPath("https://control-plane.mistle.test", "/p/foo?state=abc")).toBe(
      "https://control-plane.mistle.test/p/foo?state=abc",
    );
  });

  it("strips hashes from the path", () => {
    expect(buildUrlWithPath("https://control-plane.mistle.test", "/p/foo#frag")).toBe(
      "https://control-plane.mistle.test/p/foo",
    );
  });

  it("keeps encoded path segments encoded", () => {
    expect(buildUrlWithPath("https://control-plane.mistle.test", "/p/foo%2Fbar")).toBe(
      "https://control-plane.mistle.test/p/foo%2Fbar",
    );
  });
});
