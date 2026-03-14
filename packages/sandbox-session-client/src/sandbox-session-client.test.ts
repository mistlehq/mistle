import { describe, expect, it } from "vitest";

import { parseStreamOpenControlMessage } from "./client.js";

describe("sandbox session client", () => {
  it("parses stream.open.ok control messages", () => {
    expect(
      parseStreamOpenControlMessage(
        JSON.stringify({
          type: "stream.open.ok",
          streamId: 1,
        }),
      ),
    ).toEqual({
      type: "stream.open.ok",
      streamId: 1,
    });
  });

  it("parses stream.open.error control messages", () => {
    expect(
      parseStreamOpenControlMessage(
        JSON.stringify({
          type: "stream.open.error",
          streamId: 7,
          code: "agent_unavailable",
          message: "agent unavailable",
        }),
      ),
    ).toEqual({
      type: "stream.open.error",
      streamId: 7,
      code: "agent_unavailable",
      message: "agent unavailable",
    });
  });

  it("returns null for invalid control messages", () => {
    expect(parseStreamOpenControlMessage("{")).toBeNull();
    expect(
      parseStreamOpenControlMessage(
        JSON.stringify({
          type: "stream.open.ok",
          streamId: 0,
        }),
      ),
    ).toBeNull();
  });
});
