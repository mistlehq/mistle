const MaxWebSocketCloseReasonBytes = 123;
const InternalErrorCloseCode = 1011;

export function normalizeForwardedDirectEgressWebSocketCloseCode(closeCode: number): number {
  if (closeCode === 1005 || closeCode === 1006 || closeCode < 1000 || closeCode >= 5000) {
    return InternalErrorCloseCode;
  }

  return closeCode;
}

export function normalizeForwardedDirectEgressWebSocketCloseReason(closeReason: string): string {
  let normalized = "";
  let normalizedBytes = 0;

  for (const character of closeReason) {
    const characterBytes = Buffer.byteLength(character);
    if (normalizedBytes + characterBytes > MaxWebSocketCloseReasonBytes) {
      return normalized;
    }

    normalized += character;
    normalizedBytes += characterBytes;
  }

  return normalized;
}
