import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  Label,
  REGEXP_ONLY_DIGITS,
  ScreenActionButton,
} from "@mistle/ui";
import { useRef } from "react";

type OtpStepFormProps = {
  email: string;
  otp: string;
  isVerifyingOtp: boolean;
  onOtpChange: (value: string) => void;
  onSubmit: (event: React.SyntheticEvent<HTMLFormElement>) => Promise<void>;
  onUseDifferentEmail?: () => void;
};

export function OtpStepForm(props: OtpStepFormProps): React.JSX.Element {
  const otpSlotClassName = "h-12 min-w-0 flex-1 text-base tabular-nums sm:h-14 sm:text-lg";
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      className="gap-4 flex flex-col"
      onSubmit={(event) => void props.onSubmit(event)}
      ref={formRef}
    >
      <div className="gap-2 flex flex-col">
        <p className="text-muted-foreground text-sm leading-relaxed">
          We sent a one-time code to{" "}
          <span className="font-medium text-foreground">{props.email}</span>.
        </p>
        <Label className="sr-only" htmlFor="otp">
          One-time code
        </Label>
        <InputOTP
          autoComplete="one-time-code"
          autoFocus
          containerClassName="w-full justify-center"
          data-1p-ignore="true"
          disabled={props.isVerifyingOtp}
          id="otp"
          inputMode="numeric"
          maxLength={6}
          name="otp"
          onChange={props.onOtpChange}
          onComplete={() => formRef.current?.requestSubmit()}
          pattern={REGEXP_ONLY_DIGITS}
          value={props.otp}
        >
          <InputOTPGroup className="w-full">
            {Array.from({ length: 6 }, (_, index) => (
              <InputOTPSlot className={otpSlotClassName} index={index} key={index} />
            ))}
          </InputOTPGroup>
        </InputOTP>
      </div>
      <ScreenActionButton disabled={props.isVerifyingOtp} type="submit">
        {props.isVerifyingOtp ? "Verifying..." : "Sign in"}
      </ScreenActionButton>
      {props.onUseDifferentEmail === undefined ? null : (
        <ScreenActionButton
          className="text-muted-foreground hover:text-foreground"
          onClick={props.onUseDifferentEmail}
          type="button"
          variant="link"
        >
          Use a different email
        </ScreenActionButton>
      )}
    </form>
  );
}
