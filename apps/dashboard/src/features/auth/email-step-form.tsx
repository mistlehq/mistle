import { Input, Label, ScreenActionButton } from "@mistle/ui";

type EmailStepFormProps = {
  email: string;
  isEmailEditable?: boolean;
  isEmailHidden?: boolean;
  isSendingOtp: boolean;
  onEmailChange: (value: string) => void;
  onSubmit: (event: React.SyntheticEvent<HTMLFormElement>) => Promise<void>;
  submitLabel?: string;
};

export function EmailStepForm(props: EmailStepFormProps): React.JSX.Element {
  const isEmailEditable = props.isEmailEditable ?? true;
  const isEmailHidden = props.isEmailHidden ?? false;

  return (
    <form className="gap-4 flex flex-col" onSubmit={(event) => void props.onSubmit(event)}>
      {isEmailHidden ? null : (
        <Label className="sr-only" htmlFor="email">
          Email address
        </Label>
      )}
      {isEmailHidden ? (
        <input autoComplete="email" id="email" name="email" type="hidden" value={props.email} />
      ) : isEmailEditable ? (
        <Input
          autoComplete="email"
          autoFocus
          className="h-12"
          id="email"
          name="email"
          onChange={(event) => {
            props.onEmailChange(event.currentTarget.value);
          }}
          placeholder="Enter your email address..."
          type="email"
          value={props.email}
        />
      ) : (
        <div
          aria-label="Email address"
          className="bg-muted/40 text-foreground flex h-12 items-center rounded-md border px-2.5 py-1 text-sm"
          id="email"
          role="note"
        >
          {props.email}
        </div>
      )}
      <ScreenActionButton disabled={props.isSendingOtp} type="submit">
        {props.isSendingOtp ? "Sending code..." : (props.submitLabel ?? "Continue with email")}
      </ScreenActionButton>
    </form>
  );
}
