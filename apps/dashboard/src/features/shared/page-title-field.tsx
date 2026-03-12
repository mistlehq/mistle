import { Input } from "@mistle/ui";

export function PageTitleField(input: {
  fieldId: string;
  label: string;
  showLabel?: boolean;
  ariaLabel: string;
  value: string;
  placeholder?: string;
  errorMessage?: string;
  maxWidthClassName?: string;
  className?: string;
  autoFocus?: boolean;
  onBlur?: () => void;
  onChange: (nextValue: string) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}): React.JSX.Element {
  const containerClassName = `w-full ${input.maxWidthClassName ?? "max-w-2xl"} space-y-2`;

  return (
    <div className={containerClassName}>
      {input.showLabel === true ? (
        <label className="text-sm font-medium" htmlFor={input.fieldId}>
          {input.label}
        </label>
      ) : null}
      <Input
        aria-label={input.ariaLabel}
        autoFocus={input.autoFocus}
        className={`h-10 w-full py-0 text-xl font-semibold leading-none ${input.className ?? ""}`}
        id={input.fieldId}
        onBlur={input.onBlur}
        onChange={(event) => {
          input.onChange(event.currentTarget.value);
        }}
        onKeyDown={input.onKeyDown}
        placeholder={input.placeholder}
        value={input.value}
      />
      {input.errorMessage === undefined ? null : (
        <p className="text-destructive text-sm">{input.errorMessage}</p>
      )}
    </div>
  );
}
