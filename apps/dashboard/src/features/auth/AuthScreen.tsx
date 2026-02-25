import { Card, CardContent, CardDescription, CardHeader, CardTitle, Spinner } from "@mistle/ui";
import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router";

import type { SessionData } from "./types.js";

import { MistleLogo } from "../../components/MistleLogo.js";
import { authClient } from "../../lib/auth/client.js";
import {
  createStateForDifferentEmail,
  resolveEmailValidationError,
  resolveOtpValidationError,
  type AuthStep,
} from "./authFlow.js";
import { resolvePostLoginPath } from "./authRedirect.js";
import { EmailStepForm } from "./EmailStepForm.js";
import { ErrorNotice } from "./ErrorNotice.js";
import { resolveErrorMessage } from "./messages.js";
import { OtpStepForm } from "./OtpStepForm.js";

export function AuthScreen(): React.JSX.Element {
  const location = useLocation();
  const [session, setSession] = useState<SessionData>(null);
  const [isSessionLoading, setIsSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [authStep, setAuthStep] = useState<AuthStep>("email");
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  async function refreshSession(): Promise<SessionData> {
    try {
      const response = await authClient.getSession();

      if (response.error) {
        if (response.error.status !== 401) {
          setSessionError(resolveErrorMessage(response.error, "Unable to load session."));
        } else {
          setSessionError(null);
        }
        setSession(null);
        return null;
      }

      setSessionError(null);
      setSession(response.data);
      return response.data;
    } catch {
      setSession(null);
      setSessionError("Unable to load session.");
      return null;
    }
  }

  useEffect(() => {
    let isMounted = true;

    async function loadInitialSession(): Promise<void> {
      try {
        await refreshSession();
      } finally {
        if (isMounted) {
          setIsSessionLoading(false);
        }
      }
    }

    void loadInitialSession();

    return () => {
      isMounted = false;
    };
  }, []);

  const isSignedIn = session !== null;
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
    try {
      const signInResponse = await authClient.signIn.emailOtp({
        email,
        otp: otpValue,
      });

      if (signInResponse.error) {
        setAuthError(resolveErrorMessage(signInResponse.error, "Unable to verify OTP."));
        return;
      }

      const signedInSession = await refreshSession();
      if (!signedInSession) {
        setAuthError(
          "Sign-in succeeded but no session cookie was established. Use the same hostname for dashboard and API (localhost with localhost, or 127.0.0.1 with 127.0.0.1).",
        );
      }
    } catch {
      setAuthError("Unable to verify OTP.");
    } finally {
      setIsVerifyingOtp(false);
    }
  }

  function handleUseDifferentEmail(): void {
    const nextState = createStateForDifferentEmail();
    setAuthError(nextState.authError);
    setOtp(nextState.otp);
    setAuthStep(nextState.authStep);
  }

  if (isSessionLoading) {
    return (
      <main className="from-background to-muted/20 min-h-svh bg-linear-to-b">
        <div className="mx-auto flex min-h-svh w-full max-w-xl items-center px-4 py-8">
          <Card className="w-full">
            <CardHeader>
              <CardTitle>Mistle dashboard</CardTitle>
              <CardDescription>Preparing your session.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-muted-foreground gap-2 flex items-center">
                <Spinner />
                Loading session...
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  if (isSignedIn && session) {
    return <Navigate replace to={postLoginPath} />;
  }

  return (
    <main className="from-background to-muted/20 min-h-svh bg-linear-to-b">
      <div className="mx-auto flex min-h-svh w-full max-w-sm items-center px-4 py-8">
        <div className="w-full gap-4 flex flex-col">
          <MistleLogo className="mx-auto" mode="with-text" />
          {authStep === "email" ? (
            <h1 className="text-center text-lg font-medium">Log in with email</h1>
          ) : null}
          <div className="gap-4 pt-1 flex flex-col">
            <ErrorNotice message={authError} />
            {authStep === "email" ? (
              <EmailStepForm
                email={email}
                isSendingOtp={isSendingOtp}
                onEmailChange={setEmail}
                onSubmit={handleSendOtp}
              />
            ) : (
              <OtpStepForm
                email={email}
                isVerifyingOtp={isVerifyingOtp}
                onOtpChange={setOtp}
                onSubmit={handleVerifyOtp}
                onUseDifferentEmail={handleUseDifferentEmail}
                otp={otp}
              />
            )}
            <ErrorNotice message={sessionError} />
          </div>
        </div>
      </div>
    </main>
  );
}
