import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate, useLocation } from "react-router";

import { authClient } from "../../lib/auth/client.js";
import { SESSION_QUERY_KEY, useSessionQuery } from "../shell/session-query.js";
import {
  createStateForDifferentEmail,
  resolveEmailValidationError,
  resolveOtpValidationError,
  type AuthStep,
} from "./auth-flow.js";
import { AuthPageShell, AuthPageWidths } from "./auth-page-shell.js";
import { resolvePostLoginPath } from "./auth-redirect.js";
import { EmailStage } from "./email-stage.js";
import { resolveErrorMessage } from "./messages.js";
import { OtpStage } from "./otp-stage.js";

export function AuthScreen(): React.JSX.Element {
  const queryClient = useQueryClient();
  const sessionQuery = useSessionQuery();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [authStep, setAuthStep] = useState<AuthStep>("email");
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const isSignedIn = (sessionQuery.data ?? null) !== null;
  const postLoginPath = resolvePostLoginPath(location.state);

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
    try {
      const response = await authClient.emailOtp.sendVerificationOtp({
        email: emailValue,
        type: "sign-in",
      });

      if (response.error) {
        setAuthError(resolveErrorMessage(response.error, "Unable to send OTP."));
        return;
      }
    } catch {
      setAuthError("Unable to send OTP.");
      return;
    } finally {
      setIsSendingOtp(false);
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

  function handleUseDifferentEmail(): void {
    const nextState = createStateForDifferentEmail();
    setAuthError(nextState.authError);
    setOtp(nextState.otp);
    setAuthStep(nextState.authStep);
  }

  if (isSignedIn) {
    return <Navigate replace to={postLoginPath} />;
  }

  return (
    <AuthPageShell
      maxWidthClass={AuthPageWidths.SM}
      title={authStep === "email" ? "Log in with email" : null}
    >
      {authStep === "email" ? (
        <EmailStage
          authError={authError}
          email={email}
          footerError={sessionQuery.isError ? sessionQuery.error.message : null}
          isSendingOtp={isSendingOtp}
          onEmailChange={setEmail}
          onSubmit={handleSendOtp}
        />
      ) : (
        <OtpStage
          authError={authError}
          email={email}
          footerError={sessionQuery.isError ? sessionQuery.error.message : null}
          isVerifyingOtp={isVerifyingOtp}
          onOtpChange={setOtp}
          onSubmit={handleVerifyOtp}
          onUseDifferentEmail={handleUseDifferentEmail}
          otp={otp}
        />
      )}
    </AuthPageShell>
  );
}
