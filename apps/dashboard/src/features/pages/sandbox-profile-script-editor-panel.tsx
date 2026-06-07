import { Field, FieldContent, FieldHeader, FieldLabel, cn } from "@mistle/ui";
import type { CSSProperties, ReactNode } from "react";

import {
  SandboxProfileSetupScriptTestButton,
  type SetupScriptTestButtonProps,
} from "./sandbox-profile-setup-script-test.js";
import {
  SandboxSetupScriptEditor,
  ScriptEditorLineHeight,
  ScriptEditorMaxHeight,
  ScriptEditorMinHeight,
} from "./sandbox-setup-script-editor.js";

export type SandboxProfileScriptAssistantControl = {
  disabled: boolean;
  isStarting: boolean;
  onClick: () => void;
  title: string;
};

export function SandboxProfileScriptEditorField(input: {
  ariaLabelledBy: string;
  description?: ReactNode | undefined;
  disabled?: boolean | undefined;
  errorMessage?: string | null | undefined;
  fieldLabel: string;
  footer?: ReactNode | undefined;
  notice?: ReactNode | undefined;
  onChange?: ((nextValue: string) => void) | undefined;
  placeholderText: string;
  readOnly?: boolean | undefined;
  setupAssistant?: SandboxProfileScriptAssistantControl | undefined;
  showFieldHeader?: boolean | undefined;
  testButtonProps?: SetupScriptTestButtonProps | undefined;
  testPanel?: ReactNode | undefined;
  value: string;
}): React.JSX.Element {
  const showsEditorControls = input.readOnly !== true;
  const showsFieldHeader = input.showFieldHeader !== false;
  const testControl =
    showsEditorControls && input.testButtonProps !== undefined ? (
      <SandboxProfileSetupScriptTestButton
        {...input.testButtonProps}
        {...(input.setupAssistant === undefined
          ? {}
          : {
              setupAssistant: {
                disabled: input.setupAssistant.disabled,
                isStarting: input.setupAssistant.isStarting,
                onClick: input.setupAssistant.onClick,
                title: input.setupAssistant.title,
              },
            })}
      />
    ) : undefined;

  return (
    <Field>
      {showsFieldHeader ? (
        <FieldHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <FieldLabel id={input.ariaLabelledBy}>{input.fieldLabel}</FieldLabel>
              {input.description === undefined ? null : (
                <p className="text-sm text-muted-foreground">{input.description}</p>
              )}
            </div>
            {testControl}
          </div>
        </FieldHeader>
      ) : (
        <span className="sr-only" id={input.ariaLabelledBy}>
          {input.fieldLabel}
        </span>
      )}
      <FieldContent>
        <div className="flex flex-col gap-2">
          {input.notice}
          {showsEditorControls ? input.testPanel : null}
          {input.readOnly === true ? (
            <SandboxProfileReadOnlyScriptBlock
              ariaLabelledBy={input.ariaLabelledBy}
              value={input.value}
            />
          ) : (
            <SandboxSetupScriptEditor
              ariaLabelledBy={input.ariaLabelledBy}
              disabled={input.disabled === true}
              onChange={(nextValue) => {
                input.onChange?.(nextValue);
              }}
              placeholderText={input.placeholderText}
              value={input.value}
            />
          )}
          {input.errorMessage ? (
            <div aria-live="polite" className="text-destructive text-xs" role="status">
              {input.errorMessage}
            </div>
          ) : null}
          {input.footer === undefined ? null : (
            <div className="flex flex-wrap items-center gap-3 pt-2">{input.footer}</div>
          )}
        </div>
      </FieldContent>
    </Field>
  );
}

const ReadOnlyScriptBlockHeightStyle = {
  lineHeight: ScriptEditorLineHeight,
  maxHeight: ScriptEditorMaxHeight,
  minHeight: ScriptEditorMinHeight,
  overflow: "auto",
} satisfies CSSProperties;

export function SandboxProfileReadOnlyScriptBlock(input: {
  ariaLabelledBy: string;
  className?: string | undefined;
  emptyMessage?: ReactNode | undefined;
  value: string;
}): React.JSX.Element {
  const scriptHasContent = input.value.trim().length > 0;

  return (
    <pre
      aria-labelledby={input.ariaLabelledBy}
      className={cn(
        "whitespace-pre-wrap break-words rounded-sm border border-border bg-background p-3 font-mono text-sm text-muted-foreground",
        input.className,
      )}
      data-slot="sandbox-profile-read-only-script-block"
      style={ReadOnlyScriptBlockHeightStyle}
    >
      {scriptHasContent ? (
        input.value
      ) : (
        <span className="font-sans text-muted-foreground">
          {input.emptyMessage ?? "Not configured."}
        </span>
      )}
    </pre>
  );
}
