import { timingSafeEqual } from "node:crypto";

const TokenEncoder = new TextEncoder();

export function isInternalServiceTokenValid(input: {
  providedToken: string | undefined;
  expectedToken: string;
}): boolean {
  if (input.providedToken === undefined) {
    return false;
  }

  const providedTokenBytes = TokenEncoder.encode(input.providedToken);
  const expectedTokenBytes = TokenEncoder.encode(input.expectedToken);
  if (providedTokenBytes.byteLength !== expectedTokenBytes.byteLength) {
    return false;
  }

  return timingSafeEqual(providedTokenBytes, expectedTokenBytes);
}
