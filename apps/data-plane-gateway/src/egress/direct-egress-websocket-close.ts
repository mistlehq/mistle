import { normalizeWebSocketCloseReason } from "../websocket-close.js";

const InternalErrorCloseCode = 1011;

export function normalizeForwardedDirectEgressWebSocketCloseCode(closeCode: number): number {
  if (closeCode === 1005 || closeCode === 1006 || closeCode < 1000 || closeCode >= 5000) {
    return InternalErrorCloseCode;
  }

  return closeCode;
}

export function normalizeForwardedDirectEgressWebSocketCloseReason(closeReason: string): string {
  return normalizeWebSocketCloseReason(closeReason);
}
