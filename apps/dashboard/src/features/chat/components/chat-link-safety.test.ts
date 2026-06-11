import { describe, expect, it } from "vitest";

import { isTrustedChatLink } from "./chat-link-safety.js";

describe("isTrustedChatLink", () => {
  it("trusts configured https domain links", () => {
    expect(isTrustedChatLink("https://github.com/mistlehq/mistle.dev/pull/24")).toBe(true);
    expect(isTrustedChatLink("https://gist.github.com/mistlehq/abc123")).toBe(true);
    expect(isTrustedChatLink("https://github.com/third-party/project/issues/1")).toBe(true);
    expect(isTrustedChatLink("https://mistle.dev/docs")).toBe(true);
    expect(isTrustedChatLink("https://docs.mistle.dev/guides/sessions")).toBe(true);
    expect(isTrustedChatLink("https://linear.app/mistle/issue/MIS-123")).toBe(true);
    expect(isTrustedChatLink("https://mistle.atlassian.net/browse/MIS-123")).toBe(true);
  });

  it("does not trust non-configured or non-https links", () => {
    expect(isTrustedChatLink("http://github.com/mistlehq/mistle.dev/pull/24")).toBe(false);
    expect(isTrustedChatLink("https://github.example.com/mistlehq/mistle.dev")).toBe(false);
    expect(isTrustedChatLink("https://github.com.example.com/mistlehq/mistle.dev")).toBe(false);
    expect(isTrustedChatLink("https://linear.app.example.com/mistle/issue/MIS-123")).toBe(false);
    expect(isTrustedChatLink("https://mistle.atlassian.net.example.com/browse/MIS-123")).toBe(
      false,
    );
    expect(isTrustedChatLink("not a url")).toBe(false);
  });
});
