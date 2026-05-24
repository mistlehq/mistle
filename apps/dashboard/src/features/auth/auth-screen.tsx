import { Spinner } from "@mistle/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router";

import { getDashboardConfig } from "../../config.js";
import { authClient } from "../../lib/auth/client.js";
import { InlineDividerLabel } from "../shared/inline-divider-label.js";
import { SESSION_QUERY_KEY, useSessionQuery } from "../shell/session-query.js";
import {
  createStateForDifferentEmail,
  resolveEmailValidationError,
  resolveOtpValidationError,
  type AuthStep,
} from "./auth-flow.js";
import { useAuthMethodsQuery } from "./auth-methods-query.js";
import { AuthMethodIds, hasEnabledAuthMethod, resolveEnabledAuthMethods } from "./auth-methods.js";
import { AuthPageShell, AuthPageWidths } from "./auth-page-shell.js";
import {
  resolveAllowedControlPlaneRedirectOrigins,
  resolveRequestedPostLoginPath,
} from "./auth-redirect.js";
import { AuthScreenView } from "./auth-screen-view.js";
import { ErrorNotice } from "./error-notice.js";
import { GoogleSignInButton } from "./google-sign-in-button.js";
import { resolveErrorMessage, resolveOAuthCallbackError } from "./messages.js";

export function AuthScreen(): React.JSX.Element {
  const queryClient = useQueryClient();
  const sessionQuery = useSessionQuery();
  const authMethodsQuery = useAuthMethodsQuery();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const initialAuthError = resolveOAuthCallbackError(searchParams);

  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [authStep, setAuthStep] = useState<AuthStep>("email");
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [isSigningInWithGoogle, setIsSigningInWithGoogle] = useState(false);
  const [authError, setAuthError] = useState<string | null>(initialAuthError);
  const isSignedIn = (sessionQuery.data ?? null) !== null;
  const [postLoginPath] = useState(() =>
    resolveRequestedPostLoginPath({
      state: location.state,
      redirectTo: searchParams.get("redirectTo"),
      allowedExternalOrigins: resolveAllowedControlPlaneRedirectOrigins(
        getDashboardConfig().controlPlaneApiOrigin,
      ),
    }),
  );

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

    if (isVerifyingOtp) {
      return;
    }

    setAuthError(null);

    const submittedOtp = new FormData(event.currentTarget).get("otp");
    const otpValue = typeof submittedOtp === "string" ? submittedOtp.trim() : "";
    const otpError = resolveOtpValidationError(otpValue);
    if (otpError) {
      setAuthError(otpError);
      return;
    }

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

      await queryClient.invalidateQueries({
        queryKey: SESSION_QUERY_KEY,
      });
    } catch {
      setAuthError("Unable to verify OTP.");
      return;
    } finally {
      setIsVerifyingOtp(false);
    }
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

  if (isSignedIn) {
    if (isAbsoluteHttpUrl(postLoginPath)) {
      return <ExternalRedirect to={postLoginPath} />;
    }

    return <Navigate replace to={postLoginPath} />;
  }

  if (authMethodsQuery.isPending) {
    return (
      <AuthPageShell maxWidthClass={AuthPageWidths.SM} title={null}>
        <div className="justify-center py-2 flex">
          <Spinner className="text-muted-foreground size-6" />
        </div>
      </AuthPageShell>
    );
  }

  if (authMethodsQuery.isError) {
    return (
      <AuthPageShell maxWidthClass={AuthPageWidths.SM} title="Login unavailable">
        <ErrorNotice message={authMethodsQuery.error.message} />
      </AuthPageShell>
    );
  }

  const authMethods = resolveEnabledAuthMethods({
    google: authMethodsQuery.data.methods.google,
  });
  const hasGoogleAuthMethod = hasEnabledAuthMethod(authMethods, AuthMethodIds.GOOGLE);

  const emailStageAfterForm = hasGoogleAuthMethod ? (
    <div className="gap-4 pt-1 flex flex-col">
      <InlineDividerLabel label="Or" />
      <GoogleSignInButton isPending={isSigningInWithGoogle} onClick={handleSignInWithGoogle} />
    </div>
  ) : undefined;

  return (
    <AuthScreenView
      authError={authError}
      authStep={authStep}
      emailStageAfterForm={emailStageAfterForm}
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
    />
  );
}

function ExternalRedirect(input: { to: string }): React.JSX.Element {
  useEffect(() => {
    globalThis.location.assign(input.to);
  }, [input.to]);

  return (
    <AuthPageShell maxWidthClass={AuthPageWidths.SM} title={null}>
      <div className="justify-center py-2 flex">
        <Spinner className="text-muted-foreground size-6" />
      </div>
    </AuthPageShell>
  );
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
