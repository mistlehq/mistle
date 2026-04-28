import { describe, expect, it } from "vitest";

import {
  encodeConnectionRedirectStateMetadata,
  resolveConnectionRedirectStateConnectionId,
} from "./redirect-flow.js";

describe("connection redirect state metadata", () => {
  it("encodes and resolves connection ids", () => {
    const state = encodeConnectionRedirectStateMetadata({
      state: "redirect_state",
      connectionId: "icn_connection_123",
    });

    expect(state).toBe(
      `redirect_state.${Buffer.from("icn_connection_123", "utf8").toString("base64url")}`,
    );
    expect(resolveConnectionRedirectStateConnectionId(state)).toBe("icn_connection_123");
  });

  it("rejects states without connection metadata", () => {
    expect(() => resolveConnectionRedirectStateConnectionId("redirect_state")).toThrow(
      "Connection redirect state is missing connection metadata.",
    );
  });

  it("rejects empty connection metadata", () => {
    const state = `redirect_state.${Buffer.from(" ", "utf8").toString("base64url")}`;

    expect(() => resolveConnectionRedirectStateConnectionId(state)).toThrow(
      "Connection redirect state contains an empty connection id.",
    );
  });
});
