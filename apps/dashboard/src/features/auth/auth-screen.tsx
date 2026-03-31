import { Separator } from "@mistle/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate, useLoaderData, useLocation } from "react-router";

import { authClient } from "../../lib/auth/client.js";
import { SESSION_QUERY_KEY, useSessionQuery } from "../shell/session-query.js";
import { parseAuthCapabilities } from "./auth-capabilities.js";
import {
  createStateForDifferentEmail,
  resolveEmailValidationError,
  resolveOtpValidationError,
  type AuthStep,
} from "./auth-flow.js";
import { resolveRequestedPostLoginPath } from "./auth-redirect.js";
import { AuthScreenView } from "./auth-screen-view.js";
import { GoogleSignInButton } from "./google-sign-in-button.js";
import { resolveErrorMessage } from "./messages.js";

export function AuthScreen(): React.JSX.Element {
  const queryClient = useQueryClient();
  const sessionQuery = useSessionQuery();
  const location = useLocation();
  const authCapabilities = parseAuthCapabilities(useLoaderData());

  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [authStep, setAuthStep] = useState<AuthStep>("email");
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [isSigningInWithGoogle, setIsSigningInWithGoogle] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const isSignedIn = (sessionQuery.data ?? null) !== null;
  const postLoginPath = resolveRequestedPostLoginPath({
    state: location.state,
    redirectTo: new URLSearchParams(location.search).get("redirectTo"),
  });

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

  async function handleSignInWithGoogle(): Promise<void> {
    setAuthError(null);
    setIsSigningInWithGoogle(true);

    const callbackUrl = new URL("/auth/login/callback", globalThis.location.origin);
    callbackUrl.searchParams.set("redirectTo", postLoginPath);
    const errorCallbackUrl = new URL("/auth/login", globalThis.location.origin);
    errorCallbackUrl.searchParams.set("redirectTo", postLoginPath);

    try {
      const response = await authClient.signIn.social({
        provider: "google",
        callbackURL: callbackUrl.toString(),
        errorCallbackURL: errorCallbackUrl.toString(),
      });

      if (response.error) {
        setAuthError(resolveErrorMessage(response.error, "Unable to continue with Google."));
        setIsSigningInWithGoogle(false);
      }
    } catch {
      setAuthError("Unable to continue with Google.");
      setIsSigningInWithGoogle(false);
    }
  }

  function handleUseDifferentEmail(): void {
    const nextState = createStateForDifferentEmail();
    setAuthError(nextState.authError);
    setOtp(nextState.otp);
    setAuthStep(nextState.authStep);
  }

  const emailStageAfterForm = authCapabilities.methods.google ? (
    <div className="gap-4 pt-1 flex flex-col">
      <div className="items-center gap-4 flex">
        <Separator className="flex-1" />
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-[0.2em]">Or</p>
        <Separator className="flex-1" />
      </div>
      <GoogleSignInButton isPending={isSigningInWithGoogle} onClick={handleSignInWithGoogle} />
    </div>
  ) : undefined;

  const authScreenViewOptionalProps = {
    ...(emailStageAfterForm === undefined ? {} : { emailStageAfterForm }),
    ...(authStep === "email" && authCapabilities.methods.google ? { title: "Log in" } : {}),
  };

  if (isSignedIn) {
    return <Navigate replace to={postLoginPath} />;
  }

  return (
    <AuthScreenView
      authError={authError}
      authStep={authStep}
      email={email}
      footerError={sessionQuery.isError ? sessionQuery.error.message : null}
      isSendingOtp={isSendingOtp}
      isVerifyingOtp={isVerifyingOtp}
      onEmailChange={setEmail}
      onOtpChange={setOtp}
      onSendOtp={handleSendOtp}
      onUseDifferentEmail={handleUseDifferentEmail}
      onVerifyOtp={handleVerifyOtp}
      otp={otp}
      {...authScreenViewOptionalProps}
    />
  );
}
