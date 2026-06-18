import { createHash, timingSafeEqual } from "node:crypto";

const InternalServiceTokenHashDomain = "mistle-internal-service-token\0";

function hashInternalServiceToken(token: string): Buffer {
  return createHash("sha256").update(InternalServiceTokenHashDomain).update(token, "utf8").digest();
}

export function isInternalServiceTokenValid(input: {
  providedToken: string | undefined;
  expectedToken: string;
}): boolean {
  if (input.providedToken === undefined) {
    return false;
  }

  return timingSafeEqual(
    hashInternalServiceToken(input.providedToken),
    hashInternalServiceToken(input.expectedToken),
  );
}
