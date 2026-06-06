import { Field, FieldContent, FieldHeader, FieldLabel, SectionBlock, cn } from "@mistle/ui";
import type { CSSProperties, ReactNode } from "react";

import { SandboxProfileSectionCard } from "./sandbox-profile-section-card.js";
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

export function SandboxProfileScriptEditorPanel(input: {
  ariaLabelledBy: string;
  description?: ReactNode | undefined;
  detailsContent?: ReactNode | undefined;
  disabled?: boolean | undefined;
  errorMessage?: string | null | undefined;
  fieldLabel: string;
  footer?: ReactNode | undefined;
  notice?: ReactNode | undefined;
  onChange?: ((nextValue: string) => void) | undefined;
  placeholderText: string;
  readOnly?: boolean | undefined;
  setupAssistant?: SandboxProfileScriptAssistantControl | undefined;
  testButtonProps?: SetupScriptTestButtonProps | undefined;
  testControl?: ReactNode | undefined;
  testPanel?: ReactNode | undefined;
  title: string;
  value: string;
}): React.JSX.Element {
  return (
    <SectionBlock description={input.description} title={input.title}>
      <SandboxProfileSectionCard>
        <SandboxProfileScriptEditorField
          ariaLabelledBy={input.ariaLabelledBy}
          description={input.description}
          detailsContent={input.detailsContent}
          disabled={input.disabled}
          errorMessage={input.errorMessage}
          fieldLabel={input.fieldLabel}
          footer={input.footer}
          notice={input.notice}
          onChange={input.onChange}
          placeholderText={input.placeholderText}
          readOnly={input.readOnly}
          setupAssistant={input.setupAssistant}
          testButtonProps={input.testButtonProps}
          testControl={input.testControl}
          testPanel={input.testPanel}
          value={input.value}
        />
      </SandboxProfileSectionCard>
    </SectionBlock>
  );
}

export function SandboxProfileScriptEditorField(input: {
  ariaLabelledBy: string;
  description?: ReactNode | undefined;
  detailsContent?: ReactNode | undefined;
  disabled?: boolean | undefined;
  errorMessage?: string | null | undefined;
  fieldLabel: string;
  footer?: ReactNode | undefined;
  notice?: ReactNode | undefined;
  onChange?: ((nextValue: string) => void) | undefined;
  placeholderText: string;
  readOnly?: boolean | undefined;
  setupAssistant?: SandboxProfileScriptAssistantControl | undefined;
  testButtonProps?: SetupScriptTestButtonProps | undefined;
  testControl?: ReactNode | undefined;
  testPanel?: ReactNode | undefined;
  value: string;
}): React.JSX.Element {
  const showsEditorControls = input.readOnly !== true;
  const testControl =
    showsEditorControls &&
    (input.testControl ??
      (input.testButtonProps === undefined ? undefined : (
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
      )));

  return (
    <Field>
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
          {input.detailsContent}
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
        "whitespace-pre-wrap break-words rounded-sm border border-border bg-muted/40 p-3 font-mono text-sm text-muted-foreground",
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
