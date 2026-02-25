import { Button, Input, Label } from "@mistle/ui";

type EmailStepFormProps = {
  email: string;
  isSendingOtp: boolean;
  onEmailChange: (value: string) => void;
  onSubmit: (event: React.SyntheticEvent<HTMLFormElement>) => Promise<void>;
};

export function EmailStepForm(props: EmailStepFormProps): React.JSX.Element {
  return (
    <form className="gap-4 flex flex-col" onSubmit={(event) => void props.onSubmit(event)}>
      <Label className="sr-only" htmlFor="email">
        Email address
      </Label>
      <Input
        autoComplete="email"
        className="h-12 text-base"
        id="email"
        name="email"
        onChange={(event) => props.onEmailChange(event.currentTarget.value)}
        placeholder="Enter your email address..."
        type="email"
        value={props.email}
      />
      <Button className="h-12 w-full text-sm" disabled={props.isSendingOtp} size="lg" type="submit">
        {props.isSendingOtp ? "Sending code..." : "Continue with email"}
      </Button>
    </form>
  );
}
