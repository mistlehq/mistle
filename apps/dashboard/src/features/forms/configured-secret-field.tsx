import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Field,
  FieldContent,
  FieldHeader,
  FieldLabel,
  FieldLabelWithTooltip,
  Input,
  Spinner,
  Textarea,
  cn,
} from "@mistle/ui";
import { CheckCircleIcon } from "@phosphor-icons/react";
import { useRef, useState, type ReactNode } from "react";

export type SavingFieldStatus = "idle" | "saving" | "saved" | "saved-fading";

export type SavingFieldState = {
  status: SavingFieldStatus;
  errorMessage: string | null;
};

const ConfiguredSecretPlaceholder = "******";
const PasswordConfiguredSecretPlaceholder = "••••••";

type SavingTextFieldProps = {
  id: string;
  label: string;
  labelAccessory?: ReactNode;
  value: string;
  fieldState: SavingFieldState;
  required?: boolean;
  description?: string;
  placeholder?: string;
  rows?: number;
  type?: React.ComponentProps<typeof Input>["type"];
  multiline?: boolean;
  inputClassName?: string;
  autoComplete?: string;
  onePasswordIgnore?: boolean;
  onChange: (nextValue: string) => void;
  onBlur: () => void;
  onFocus?: () => void;
};

export function SavingTextField(input: SavingTextFieldProps): React.JSX.Element {
  const saveState = input.fieldState.errorMessage === null ? input.fieldState.status : "error";
  const showIndicator = saveState !== "idle" && saveState !== "error";
  const label =
    input.description === undefined ? (
      <FieldLabel htmlFor={input.id} {...(input.required === true ? { required: true } : {})}>
        {input.label}
      </FieldLabel>
    ) : (
      <FieldLabelWithTooltip
        htmlFor={input.id}
        {...(input.required === true ? { required: true } : {})}
        tooltip={input.description}
        tooltipLabel="Field description"
      >
        {input.label}
      </FieldLabelWithTooltip>
    );
  const liveMessage =
    input.fieldState.errorMessage !== null
      ? ""
      : input.fieldState.status === "saving"
        ? "Saving"
        : input.fieldState.status === "saved" || input.fieldState.status === "saved-fading"
          ? "Saved"
          : "";

  return (
    <Field contentWidth="fill" orientation="vertical">
      <FieldHeader>
        {input.labelAccessory === undefined ? (
          label
        ) : (
          <div className="flex items-center justify-between gap-3">
            {label}
            {input.labelAccessory}
          </div>
        )}
      </FieldHeader>
      <FieldContent>
        <div className="space-y-2" data-save-state={saveState}>
          <p aria-live="polite" className="sr-only" role="status">
            {liveMessage}
          </p>
          <div className="relative">
            {input.multiline ? (
              <Textarea
                aria-invalid={input.fieldState.errorMessage === null ? undefined : true}
                autoComplete={input.autoComplete}
                className={cn(showIndicator ? "pr-10" : null, input.inputClassName)}
                data-1p-ignore={input.onePasswordIgnore === true ? "true" : undefined}
                disabled={input.fieldState.status === "saving"}
                id={input.id}
                onBlur={input.onBlur}
                onChange={(event) => {
                  input.onChange(event.currentTarget.value);
                }}
                onFocus={input.onFocus}
                placeholder={input.placeholder}
                rows={input.rows}
                value={input.value}
              />
            ) : (
              <Input
                aria-invalid={input.fieldState.errorMessage === null ? undefined : true}
                autoComplete={input.autoComplete}
                className={cn(showIndicator ? "pr-9" : null, input.inputClassName)}
                data-1p-ignore={input.onePasswordIgnore === true ? "true" : undefined}
                disabled={input.fieldState.status === "saving"}
                id={input.id}
                onBlur={input.onBlur}
                onChange={(event) => {
                  input.onChange(event.currentTarget.value);
                }}
                onFocus={input.onFocus}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                }}
                placeholder={input.placeholder}
                type={input.type}
                value={input.value}
              />
            )}
            {showIndicator ? (
              <div
                className={cn(
                  "pointer-events-none absolute right-0 pr-3",
                  input.multiline ? "top-3" : "inset-y-0 flex items-center",
                )}
              >
                <SavingFieldIndicator status={input.fieldState.status} />
              </div>
            ) : null}
          </div>
          {input.fieldState.errorMessage === null ? null : (
            <div aria-live="polite" role="status">
              <div className="flex items-center justify-start text-xs text-destructive">
                <span>{input.fieldState.errorMessage}</span>
              </div>
            </div>
          )}
        </div>
      </FieldContent>
    </Field>
  );
}

type ConfiguredSecretFieldBaseProps = {
  id: string;
  label: string;
  secretLabel: string;
  value: string;
  fieldState: SavingFieldState;
  required?: boolean;
  configured?: boolean;
  description?: string;
  placeholder?: string;
  rows?: number;
  type?: React.ComponentProps<typeof Input>["type"];
  multiline?: boolean;
  autoComplete?: string;
  onePasswordIgnore?: boolean;
  replacementStaged?: boolean;
  onChange: (nextValue: string) => void;
};

type ConfiguredSecretFieldProps = ConfiguredSecretFieldBaseProps &
  (
    | {
        confirmReplacement: false;
        onCommit?: () => void;
        onCancelReplace?: () => void;
      }
    | {
        confirmReplacement?: true;
        onCommit: () => void;
        onCancelReplace: () => void;
      }
  );

export function ConfiguredSecretField(input: ConfiguredSecretFieldProps): React.JSX.Element {
  const [isReplaceDialogOpen, setIsReplaceDialogOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const replaceConfirmedRef = useRef(false);
  const confirmReplacement = input.confirmReplacement !== false;
  const canRevealConfiguredPassword = input.configured === true && input.type === "password";
  const resolvedType = canRevealConfiguredPassword && isFocused ? "text" : input.type;
  const resolvedPlaceholder =
    input.configured === true && input.value.length === 0
      ? resolveConfiguredSecretPlaceholder(input.type)
      : input.placeholder;
  const configuredPlaceholderClassName =
    input.configured === true && input.value.length === 0
      ? "placeholder:text-foreground placeholder:opacity-100 focus:placeholder:text-transparent focus:placeholder:opacity-0"
      : undefined;
  const replacementLabel =
    input.replacementStaged === true ? (
      <span className="text-muted-foreground text-xs">Replace on save</span>
    ) : undefined;

  function handleCancel(): void {
    input.onCancelReplace?.();
    setIsReplaceDialogOpen(false);
  }

  function handleReplace(): void {
    replaceConfirmedRef.current = true;
    setIsReplaceDialogOpen(false);
    input.onCommit?.();
  }

  function handleBlur(): void {
    if (canRevealConfiguredPassword) {
      setIsFocused(false);
    }

    if (input.value.trim().length === 0) {
      input.onCommit?.();
      return;
    }

    if (input.configured === true && confirmReplacement) {
      setIsReplaceDialogOpen(true);
      return;
    }

    input.onCommit?.();
  }

  return (
    <>
      <SavingTextField
        fieldState={input.fieldState}
        id={input.id}
        label={input.label}
        onBlur={handleBlur}
        onChange={input.onChange}
        {...(canRevealConfiguredPassword
          ? {
              onFocus: () => {
                setIsFocused(true);
              },
            }
          : {})}
        value={input.value}
        {...(input.description === undefined ? {} : { description: input.description })}
        {...(input.autoComplete === undefined ? {} : { autoComplete: input.autoComplete })}
        {...(configuredPlaceholderClassName === undefined
          ? {}
          : { inputClassName: configuredPlaceholderClassName })}
        {...(input.multiline === undefined ? {} : { multiline: input.multiline })}
        {...(input.onePasswordIgnore === undefined
          ? {}
          : { onePasswordIgnore: input.onePasswordIgnore })}
        {...(replacementLabel === undefined ? {} : { labelAccessory: replacementLabel })}
        {...(resolvedPlaceholder === undefined ? {} : { placeholder: resolvedPlaceholder })}
        {...(input.required === undefined ? {} : { required: input.required })}
        {...(input.rows === undefined ? {} : { rows: input.rows })}
        {...(resolvedType === undefined ? {} : { type: resolvedType })}
      />

      {confirmReplacement ? (
        <AlertDialog
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              if (replaceConfirmedRef.current) {
                replaceConfirmedRef.current = false;
                setIsReplaceDialogOpen(false);
                return;
              }

              handleCancel();
              return;
            }

            setIsReplaceDialogOpen(true);
          }}
          open={isReplaceDialogOpen}
        >
          <AlertDialogContent className="sm:max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle>Replace secret?</AlertDialogTitle>
              <AlertDialogDescription>
                This will replace the existing {input.secretLabel}.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="sm:grid-cols-[1fr_auto]">
              <AlertDialogCancel>Keep existing</AlertDialogCancel>
              <AlertDialogAction onClick={handleReplace}>Replace</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </>
  );
}

function resolveConfiguredSecretPlaceholder(
  type: React.ComponentProps<typeof Input>["type"] | undefined,
): string {
  return type === "password" ? PasswordConfiguredSecretPlaceholder : ConfiguredSecretPlaceholder;
}

function SavingFieldIndicator(input: { status: SavingFieldStatus }): React.JSX.Element | null {
  if (input.status === "saving") {
    return (
      <div className="text-muted-foreground flex items-center justify-end">
        <Spinner className="size-3.5" />
        <span className="sr-only">Saving</span>
      </div>
    );
  }

  if (input.status === "saved" || input.status === "saved-fading") {
    return (
      <div
        className={cn(
          "flex items-center justify-end text-emerald-600 transition-opacity duration-700 dark:text-emerald-400",
          input.status === "saved" ? "opacity-100" : "opacity-0",
        )}
      >
        <CheckCircleIcon aria-hidden className="size-4" weight="fill" />
        <span className="sr-only">Saved</span>
      </div>
    );
  }

  return null;
}
