import {
  AgentExecutionObservationTypes,
  type AgentExecutionObservation,
} from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { createOpenAiExecutionObserver } from "./execution-observer.server.js";

function isActiveObservation(
  observation: AgentExecutionObservation,
): observation is Extract<AgentExecutionObservation, { type: "active" }> {
  return observation.type === AgentExecutionObservationTypes.ACTIVE;
}

describe("createOpenAiExecutionObserver", () => {
  it("drains observed turn/start and turn/steer executions", () => {
    const observer = createOpenAiExecutionObserver();
    const session = observer.createSession({
      transportUrl: "ws://127.0.0.1:4500",
    });

    session.onOutboundMessage(
      JSON.stringify({
        id: "1",
        method: "turn/start",
        params: {
          threadId: "thr_123",
          input: [],
        },
      }),
    );
    session.onInboundMessage(
      JSON.stringify({
        id: "1",
        result: {
          turn: {
            id: "turn_123",
            status: "inProgress",
          },
        },
      }),
    );

    session.onOutboundMessage(
      JSON.stringify({
        id: "2",
        method: "turn/steer",
        params: {
          threadId: "thr_123",
          expectedTurnId: "turn_123",
          input: [],
        },
      }),
    );
    session.onInboundMessage(
      JSON.stringify({
        id: "2",
        result: {
          turnId: "turn_456",
        },
      }),
    );

    const observations = session.drainObservations();
    const activeObservations = observations.filter(isActiveObservation);

    expect(observations).toHaveLength(2);
    expect(activeObservations).toHaveLength(2);
    expect(
      activeObservations.map((observation) => ({
        type: observation.type,
        lease: observation.lease,
      })),
    ).toEqual([
      {
        type: "active",
        lease: {
          leaseId: "sxl_codex_1ce34b9b1d075061",
          kind: "agent_execution",
          source: "codex",
          externalExecutionId: "turn_123",
          metadata: {
            threadId: "thr_123",
          },
        },
      },
      {
        type: "active",
        lease: {
          leaseId: "sxl_codex_ae0d83a59dda146e",
          kind: "agent_execution",
          source: "codex",
          externalExecutionId: "turn_456",
          metadata: {
            threadId: "thr_123",
          },
        },
      },
    ]);
    expect(session.drainObservations()).toEqual([]);
  });

  it("ignores binary frames and failed turn responses", () => {
    const observer = createOpenAiExecutionObserver();
    const session = observer.createSession({
      transportUrl: "ws://127.0.0.1:4500",
    });

    session.onOutboundMessage(new Uint8Array([1, 2, 3]));
    session.onInboundMessage(new Uint8Array([4, 5, 6]));
    session.onOutboundMessage(
      JSON.stringify({
        id: "1",
        method: "turn/start",
        params: {
          threadId: "thr_ignored",
          input: [],
        },
      }),
    );
    session.onInboundMessage(
      JSON.stringify({
        id: "1",
        error: {
          code: -32600,
          message: "invalid thread id: thr_ignored",
        },
      }),
    );

    expect(session.drainObservations()).toEqual([]);
  });
});
