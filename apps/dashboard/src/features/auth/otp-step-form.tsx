import { Button, Input, Label } from "@mistle/ui";

type OtpStepFormProps = {
  email: string;
  otp: string;
  isVerifyingOtp: boolean;
  onOtpChange: (value: string) => void;
  onSubmit: (event: React.SyntheticEvent<HTMLFormElement>) => Promise<void>;
  onUseDifferentEmail?: () => void;
};

export function OtpStepForm(props: OtpStepFormProps): React.JSX.Element {
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
        <Input
          autoComplete="one-time-code"
          className="h-12 text-base"
          data-1p-ignore="true"
          id="otp"
          inputMode="numeric"
          name="otp"
          onChange={(event) => props.onOtpChange(event.currentTarget.value)}
          placeholder="Enter your one-time code"
          type="text"
          value={props.otp}
        />
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
