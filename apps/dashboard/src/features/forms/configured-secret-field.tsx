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
  FieldDescription,
  FieldHeader,
  FieldLabel,
  Input,
  Spinner,
  Textarea,
  cn,
} from "@mistle/ui";
import { CheckCircleIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

export type SavingFieldStatus = "idle" | "saving" | "saved" | "saved-fading";

export type SavingFieldState = {
  status: SavingFieldStatus;
  errorMessage: string | null;
};

type SavingTextFieldProps = {
  id: string;
  label: string;
  value: string;
  fieldState: SavingFieldState;
  required?: boolean;
  description?: string;
  placeholder?: string;
  rows?: number;
  type?: React.ComponentProps<typeof Input>["type"];
  multiline?: boolean;
  inputClassName?: string;
  onChange: (nextValue: string) => void;
  onBlur: () => void;
};

export function SavingTextField(input: SavingTextFieldProps): React.JSX.Element {
  const saveState = input.fieldState.errorMessage === null ? input.fieldState.status : "error";
  const showIndicator = saveState !== "idle" && saveState !== "error";
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
        <FieldLabel htmlFor={input.id} {...(input.required === true ? { required: true } : {})}>
          {input.label}
        </FieldLabel>
        {input.description === undefined ? null : (
          <FieldDescription>{input.description}</FieldDescription>
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
                className={cn(showIndicator ? "pr-10" : null, input.inputClassName)}
                disabled={input.fieldState.status === "saving"}
                id={input.id}
                onBlur={input.onBlur}
                onChange={(event) => {
                  input.onChange(event.currentTarget.value);
                }}
                placeholder={input.placeholder}
                rows={input.rows}
                value={input.value}
              />
            ) : (
              <Input
                aria-invalid={input.fieldState.errorMessage === null ? undefined : true}
                className={cn(showIndicator ? "pr-9" : null, input.inputClassName)}
                disabled={input.fieldState.status === "saving"}
                id={input.id}
                onBlur={input.onBlur}
                onChange={(event) => {
                  input.onChange(event.currentTarget.value);
                }}
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

export function ConfiguredSecretField(input: {
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
  onChange: (nextValue: string) => void;
  onCommit: () => void;
  onCancelReplace: () => void;
  onReplacementDialogOpenChange?: (open: boolean) => void;
}): React.JSX.Element {
  const [isReplaceDialogOpen, setIsReplaceDialogOpen] = useState(false);
  const resolvedPlaceholder =
    input.configured === true && input.value.length === 0 ? "******" : input.placeholder;
  const configuredPlaceholderClassName =
    input.configured === true && input.value.length === 0
      ? "placeholder:text-foreground placeholder:opacity-100 focus:placeholder:text-transparent focus:placeholder:opacity-0"
      : undefined;

  useEffect(() => {
    input.onReplacementDialogOpenChange?.(isReplaceDialogOpen);
  }, [input.onReplacementDialogOpenChange, isReplaceDialogOpen]);

  function handleCancel(): void {
    input.onCancelReplace();
    setIsReplaceDialogOpen(false);
  }

  function handleBlur(): void {
    if (input.value.trim().length === 0) {
      input.onCommit();
      return;
    }

    if (input.configured === true) {
      setIsReplaceDialogOpen(true);
      return;
    }

    input.onCommit();
  }

  return (
    <>
      <SavingTextField
        fieldState={input.fieldState}
        id={input.id}
        label={input.label}
        onBlur={handleBlur}
        onChange={input.onChange}
        value={input.value}
        {...(input.description === undefined ? {} : { description: input.description })}
        {...(configuredPlaceholderClassName === undefined
          ? {}
          : { inputClassName: configuredPlaceholderClassName })}
        {...(input.multiline === undefined ? {} : { multiline: input.multiline })}
        {...(resolvedPlaceholder === undefined ? {} : { placeholder: resolvedPlaceholder })}
        {...(input.required === undefined ? {} : { required: input.required })}
        {...(input.rows === undefined ? {} : { rows: input.rows })}
        {...(input.type === undefined ? {} : { type: input.type })}
      />

      <AlertDialog
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
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
            <AlertDialogCancel onClick={handleCancel}>Keep existing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setIsReplaceDialogOpen(false);
                input.onCommit();
              }}
            >
              Replace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
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
          "flex items-center justify-end text-emerald-700 transition-opacity duration-700",
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
