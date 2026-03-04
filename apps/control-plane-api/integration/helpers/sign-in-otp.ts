import type { ControlPlaneDatabase } from "@mistle/db/control-plane";

type ReadLatestSignInOtpInput = {
  db: ControlPlaneDatabase;
  email: string;
  otpLength: number;
};

function extractOtpFromVerificationValue(input: {
  storedValue: string;
  otpLength: number;
}): string | undefined {
  const separatorIndex = input.storedValue.lastIndexOf(":");
  const otpCandidate =
    separatorIndex >= 0 ? input.storedValue.slice(0, separatorIndex) : input.storedValue;
  const otpPattern = new RegExp(`^\\d{${String(input.otpLength)}}$`, "u");

  return otpPattern.test(otpCandidate) ? otpCandidate : undefined;
}

export async function readLatestSignInOtp(input: ReadLatestSignInOtpInput): Promise<string> {
  const normalizedEmail = input.email.toLowerCase();
  const verificationIdentifier = `sign-in-otp-${normalizedEmail}`;
  const verification = await input.db.query.verifications.findFirst({
    columns: {
      value: true,
      expiresAt: true,
    },
    where: (table, { eq }) => eq(table.identifier, verificationIdentifier),
    orderBy: (table, { desc }) => [desc(table.createdAt)],
  });
  if (verification === undefined) {
    throw new Error(`Expected OTP verification row to exist for '${normalizedEmail}'.`);
  }
  if (verification.expiresAt.getTime() <= Date.now()) {
    throw new Error(`Expected OTP verification row for '${normalizedEmail}' to be unexpired.`);
  }

  const otp = extractOtpFromVerificationValue({
    storedValue: verification.value,
    otpLength: input.otpLength,
  });
  if (otp === undefined) {
    throw new Error(
      `Expected OTP verification value for '${normalizedEmail}' to contain a ${String(input.otpLength)}-digit code.`,
    );
  }

  return otp;
}
