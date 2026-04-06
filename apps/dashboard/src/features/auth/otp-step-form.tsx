import {
  Button,
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  Label,
  REGEXP_ONLY_DIGITS,
} from "@mistle/ui";

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

  return (
    <form className="gap-4 flex flex-col" onSubmit={(event) => void props.onSubmit(event)}>
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
          containerClassName="w-full justify-center"
          data-1p-ignore="true"
          disabled={props.isVerifyingOtp}
          id="otp"
          inputMode="numeric"
          maxLength={6}
          name="otp"
          onChange={props.onOtpChange}
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
      <Button
        className="h-12 w-full text-sm"
        disabled={props.isVerifyingOtp}
        size="lg"
        type="submit"
      >
        {props.isVerifyingOtp ? "Verifying..." : "Sign in"}
      </Button>
      {props.onUseDifferentEmail === undefined ? null : (
        <Button
          className="h-12 w-full text-sm text-zinc-500 hover:text-zinc-700"
          onClick={props.onUseDifferentEmail}
          size="lg"
          type="button"
          variant="link"
        >
          Use a different email
        </Button>
      )}
    </form>
  );
}
