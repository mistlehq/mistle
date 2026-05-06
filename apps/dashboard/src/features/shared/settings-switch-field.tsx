import { Field, FieldContent, FieldDescription, FieldHeader, FieldLabel, Switch } from "@mistle/ui";

export function SettingsSwitchField(input: {
  checked: boolean;
  id: string;
  label: string;
  onCheckedChange: (checked: boolean) => void;
  description?: string | undefined;
  disabled?: boolean | undefined;
  framed?: boolean | undefined;
}): React.JSX.Element {
  const field = (
    <Field className="items-center md:items-center" orientation="horizontal">
      <FieldHeader className="md:w-auto md:flex-1">
        <FieldLabel htmlFor={input.id}>{input.label}</FieldLabel>
        {input.description === undefined ? null : (
          <FieldDescription>{input.description}</FieldDescription>
        )}
      </FieldHeader>
      <FieldContent className="items-end justify-center">
        <Switch
          checked={input.checked}
          disabled={input.disabled === true}
          id={input.id}
          onCheckedChange={input.onCheckedChange}
        />
      </FieldContent>
    </Field>
  );

  return input.framed === true ? (
    <div className="max-w-5xl rounded-md border bg-background p-4">{field}</div>
  ) : (
    field
  );
}
