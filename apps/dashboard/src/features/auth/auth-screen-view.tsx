import type React from "react";

import type { AuthStep } from "./auth-flow.js";
import { AuthPageShell, AuthPageWidths } from "./auth-page-shell.js";
import { EmailStage } from "./email-stage.js";
import { OtpStage } from "./otp-stage.js";

type AuthScreenViewProps = {
  authError: string | null;
  authStep: AuthStep;
  email: string;
  footerError: string | null;
  isSendingOtp: boolean;
  isVerifyingOtp: boolean;
  onEmailChange: (value: string) => void;
  onOtpChange: (value: string) => void;
  onSendOtp: (event: React.SyntheticEvent<HTMLFormElement>) => Promise<void>;
  onUseDifferentEmail: () => void;
  onVerifyOtp: (event: React.SyntheticEvent<HTMLFormElement>) => Promise<void>;
  otp: string;
};

export function AuthScreenView(props: AuthScreenViewProps): React.JSX.Element {
  return (
    <AuthPageShell
      maxWidthClass={AuthPageWidths.SM}
      title={props.authStep === "email" ? "Log in with email" : null}
    >
      {props.authStep === "email" ? (
        <EmailStage
          authError={props.authError}
          email={props.email}
          footerError={props.footerError}
          isSendingOtp={props.isSendingOtp}
          onEmailChange={props.onEmailChange}
          onSubmit={props.onSendOtp}
        />
      ) : (
        <OtpStage
          authError={props.authError}
          email={props.email}
          footerError={props.footerError}
          isVerifyingOtp={props.isVerifyingOtp}
          onOtpChange={props.onOtpChange}
          onSubmit={props.onVerifyOtp}
          onUseDifferentEmail={props.onUseDifferentEmail}
          otp={props.otp}
        />
      )}
    </AuthPageShell>
  );
}
