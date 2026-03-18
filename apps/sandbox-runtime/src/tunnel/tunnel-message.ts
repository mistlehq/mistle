import { decodeDataFrame, type StreamDataFrame } from "@mistle/sandbox-session-protocol";

import type { TunnelSocketMessage } from "./connect-request.js";

export type TunnelMessageRouting = {
  controlMessageType?: string;
  streamId: number;
  dataFrame?: StreamDataFrame;
};

function parseJsonObject(payload: string): Record<string, unknown> {
  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(payload);
  } catch (error) {
    throw new Error(
      `control message must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (typeof parsedPayload !== "object" || parsedPayload === null || Array.isArray(parsedPayload)) {
    throw new Error("control message must be valid JSON: expected object");
  }

  return Object.fromEntries(Object.entries(parsedPayload));
}

export function parseTunnelMessageRouting(message: TunnelSocketMessage): TunnelMessageRouting {
  if (message.kind === "binary") {
    let dataFrame: StreamDataFrame;
    try {
      dataFrame = decodeDataFrame(message.payload);
    } catch (error) {
      throw new Error(
        `stream data frame must be valid binary: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return {
      streamId: dataFrame.streamId,
      dataFrame,
    };
  }

  const payload = parseJsonObject(message.payload);
  const type = typeof payload.type === "string" ? payload.type.trim() : "";
  const streamId =
    typeof payload.streamId === "number" && Number.isInteger(payload.streamId)
      ? payload.streamId
      : 0;

  if (type.length === 0) {
    throw new Error("control message type is required");
  }
  if (streamId <= 0) {
    throw new Error("control message streamId must be a positive integer");
  }

  return {
    controlMessageType: type,
    streamId,
  };
}
