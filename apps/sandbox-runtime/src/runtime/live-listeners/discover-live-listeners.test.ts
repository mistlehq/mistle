import { describe, expect, it } from "vitest";

import { parseLsofListeningSockets } from "./discover-live-listeners.js";

describe("parseLsofListeningSockets", () => {
  it("keeps only loopback listeners and deduplicates repeated file descriptors", () => {
    const listeners = parseLsofListeningSockets(`
p101
cnode
f17
n127.0.0.1:5173
f18
n127.0.0.1:5173
f19
n*:3000
p102
cwebsocket-server
f4
n[::1]:4500
`);

    expect(listeners).toEqual([
      {
        bindAddress: "::1",
        command: "websocket-server",
        pid: 102,
        port: 4500,
      },
      {
        bindAddress: "127.0.0.1",
        command: "node",
        pid: 101,
        port: 5173,
      },
    ]);
  });

  it("ignores malformed listener records", () => {
    const listeners = parseLsofListeningSockets(`
p201
cnode
f7
n127.0.0.1:notaport
f8
nlocalhost:3000
f9
n0.0.0.0:3000
`);

    expect(listeners).toEqual([]);
  });
});
