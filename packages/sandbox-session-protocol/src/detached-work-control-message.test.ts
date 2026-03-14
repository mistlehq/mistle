import { describe, expect, it } from "vitest";

import { parseDetachedWorkLeaseControlMessage } from "./detached-work-control-message.js";

describe("detached work lease control message parser", () => {
  it("parses lease open messages into the shared control shape", () => {
    const message = parseDetachedWorkLeaseControlMessage(
      JSON.stringify({
        type: "detached_work.lease.open",
        leaseId: "lease_codex_turn_123",
        kind: "agent_turn",
        protocolFamily: "codex-json-rpc",
        externalExecutionId: "turn_123",
        ignored: true,
      }),
    );

    expect(message).toEqual({
      type: "detached_work.lease.open",
      leaseId: "lease_codex_turn_123",
      kind: "agent_turn",
      protocolFamily: "codex-json-rpc",
      externalExecutionId: "turn_123",
    });
  });

  it("parses lease renew messages without an external execution id", () => {
    expect(
      parseDetachedWorkLeaseControlMessage(
        JSON.stringify({
          type: "detached_work.lease.renew",
          leaseId: "lease_codex_turn_123",
          kind: "agent_turn",
          protocolFamily: "codex-json-rpc",
        }),
      ),
    ).toEqual({
      type: "detached_work.lease.renew",
      leaseId: "lease_codex_turn_123",
      kind: "agent_turn",
      protocolFamily: "codex-json-rpc",
    });
  });

  it("rejects malformed detached work lease messages", () => {
    expect(
      parseDetachedWorkLeaseControlMessage(
        JSON.stringify({
          type: "detached_work.lease.open",
          leaseId: "",
          kind: "agent_turn",
          protocolFamily: "codex-json-rpc",
        }),
      ),
    ).toBeUndefined();

    expect(
      parseDetachedWorkLeaseControlMessage(
        JSON.stringify({
          type: "detached_work.lease.renew",
          leaseId: "lease_codex_turn_123",
          kind: "agent_turn",
          externalExecutionId: "turn_123",
        }),
      ),
    ).toBeUndefined();
  });
});
