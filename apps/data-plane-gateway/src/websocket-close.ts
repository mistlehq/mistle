export const MaxWebSocketCloseReasonBytes = 123;

export function normalizeWebSocketCloseReason(closeReason: string): string {
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
