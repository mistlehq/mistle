import { AgentTransportKinds, type AgentTransport, type AgentWebSocketTransport } from "./types.js";

export function isAgentWebSocketTransport(
  transport: AgentTransport,
): transport is AgentWebSocketTransport {
  return transport.kind === AgentTransportKinds.WEBSOCKET;
}
