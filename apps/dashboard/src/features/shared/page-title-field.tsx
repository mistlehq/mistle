import type { AutoSaveInputVisualStatus } from "./auto-save-input-surface.js";
import { AutoSaveInputSurface } from "./auto-save-input-surface.js";

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
  disabled?: boolean;
  saveStatus?: AutoSaveInputVisualStatus;
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
      <AutoSaveInputSurface
        ariaLabel={input.ariaLabel}
        id={input.fieldId}
        inputClassName={`h-10 w-full py-0 text-xl font-semibold leading-none ${input.className ?? ""}`}
        onChange={input.onChange}
        value={input.value}
        {...(input.autoFocus === undefined ? {} : { autoFocus: input.autoFocus })}
        {...(input.disabled === undefined ? {} : { disabled: input.disabled })}
        {...(input.errorMessage === undefined ? {} : { errorMessage: input.errorMessage })}
        {...(input.onBlur === undefined ? {} : { onBlur: input.onBlur })}
        {...(input.onKeyDown === undefined ? {} : { onKeyDown: input.onKeyDown })}
        {...(input.placeholder === undefined ? {} : { placeholder: input.placeholder })}
        {...(input.saveStatus === undefined ? {} : { saveStatus: input.saveStatus })}
      />
    </div>
  );
}
