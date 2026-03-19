import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { authClient } from "../../lib/auth/client.js";
import { resolveEmailValidationError, resolveOtpValidationError } from "../auth/auth-flow.js";
import { resolveErrorMessage } from "../auth/messages.js";
import { SESSION_QUERY_KEY } from "../shell/session-query-key.js";

type UseInvitationAuthInput = {
  initialEmail: string;
};

type AuthStep = "email" | "otp";

export type UseInvitationAuthState = {
  authError: string | null;
  authStep: AuthStep;
  email: string;
  isSendingOtp: boolean;
  isVerifyingOtp: boolean;
  otp: string;
  setEmail: (value: string) => void;
  setOtp: (value: string) => void;
  handleSendOtp: (event: React.SyntheticEvent<HTMLFormElement>) => Promise<void>;
  handleVerifyOtp: (event: React.SyntheticEvent<HTMLFormElement>) => Promise<void>;
};

export function useInvitationAuth(input: UseInvitationAuthInput): UseInvitationAuthState {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState(input.initialEmail);
  const [otp, setOtp] = useState("");
  const [authStep, setAuthStep] = useState<AuthStep>("email");
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  async function handleSendOtp(event: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setAuthError(null);

    const emailError = resolveEmailValidationError(email);
    if (emailError) {
      setAuthError(emailError);
      return;
    }

    const emailValue = email.trim();
    setIsSendingOtp(true);
    const response = await authClient.emailOtp.sendVerificationOtp({
      email: emailValue,
      type: "sign-in",
    });
    setIsSendingOtp(false);

    if (response.error) {
      setAuthError(resolveErrorMessage(response.error, "Unable to send OTP."));
      return;
    }

    setEmail(emailValue);
    setOtp("");
    setAuthStep("otp");
  }

  async function handleVerifyOtp(event: React.SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setAuthError(null);

    const otpError = resolveOtpValidationError(otp);
    if (otpError) {
      setAuthError(otpError);
      return;
    }

    const otpValue = otp.trim();
    setIsVerifyingOtp(true);
    const signInResponse = await authClient.signIn.emailOtp({
      email,
      otp: otpValue,
    });
    setIsVerifyingOtp(false);

    if (signInResponse.error) {
      setAuthError(resolveErrorMessage(signInResponse.error, "Unable to verify OTP."));
      return;
    }

    await queryClient.invalidateQueries({
      queryKey: SESSION_QUERY_KEY,
    });
  }

  return {
    authError,
    authStep,
    email,
    handleSendOtp,
    handleVerifyOtp,
    isSendingOtp,
    isVerifyingOtp,
    otp,
    setEmail,
    setOtp,
  };
}
