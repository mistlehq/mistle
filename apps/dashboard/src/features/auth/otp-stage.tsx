import { Notice } from "@mistle/ui";

import { OtpStepForm } from "./otp-step-form.js";

type OtpStageProps = {
  authError: string | null;
  email: string;
  footerError: string | null;
  isVerifyingOtp: boolean;
  onOtpChange: (value: string) => void;
  onSubmit: (event: React.SyntheticEvent<HTMLFormElement>) => Promise<void>;
  onUseDifferentEmail?: () => void;
  otp: string;
};

export function OtpStage(props: OtpStageProps): React.JSX.Element {
  return (
    <div className="gap-4 pt-1 flex flex-col">
      {props.authError === null ? null : <Notice variant="alert">{props.authError}</Notice>}
      <OtpStepForm
        email={props.email}
        isVerifyingOtp={props.isVerifyingOtp}
        onOtpChange={props.onOtpChange}
        onSubmit={props.onSubmit}
        otp={props.otp}
        {...(props.onUseDifferentEmail === undefined
          ? {}
          : { onUseDifferentEmail: props.onUseDifferentEmail })}
      />
      {props.footerError === null ? null : <Notice variant="alert">{props.footerError}</Notice>}
    </div>
  );
}
