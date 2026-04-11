import { describe, expect, it } from "vitest";

import {
  createProcessKey,
  createProcessLabel,
  resolvePrimaryProcessListener,
} from "./session-port-access-model.js";

describe("session port access model", () => {
  it("prefers the first listener as the primary process listener", () => {
    expect(
      resolvePrimaryProcessListener({
        pid: 123,
        command: "vite",
        listeners: [
          {
            bindAddress: "127.0.0.1",
            port: 5173,
          },
          {
            bindAddress: "127.0.0.1",
            port: 24678,
          },
        ],
      }),
    ).toEqual({
      bindAddress: "127.0.0.1",
      port: 5173,
    });
  });

  it("builds a deterministic process key from the primary listener", () => {
    expect(
      createProcessKey({
        pid: 123,
        command: "vite",
        listeners: [
          {
            bindAddress: "127.0.0.1",
            port: 5173,
          },
        ],
      }),
    ).toBe("pid:123:port:5173");
  });

  it("falls back to the pid when no command is present", () => {
    expect(
      createProcessLabel({
        pid: 4321,
        listeners: [],
      }),
    ).toBe("PID 4321");
  });
});
