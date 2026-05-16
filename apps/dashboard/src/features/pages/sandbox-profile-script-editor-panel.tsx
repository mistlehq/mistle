import { Field, FieldContent, FieldHeader, FieldLabel, SectionBlock } from "@mistle/ui";
import type { ReactNode } from "react";

import { SandboxProfileSectionCard } from "./sandbox-profile-section-card.js";
import {
  SandboxProfileSetupScriptTestButton,
  type SetupScriptTestButtonProps,
} from "./sandbox-profile-setup-script-test.js";
import { SandboxSetupScriptEditor } from "./sandbox-setup-script-editor.js";

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
  setupAssistant?: SandboxProfileScriptAssistantControl | undefined;
  testButtonProps?: SetupScriptTestButtonProps | undefined;
  testControl?: ReactNode | undefined;
  testPanel?: ReactNode | undefined;
  value: string;
}): React.JSX.Element {
  const testControl =
    input.testControl ??
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
    ));

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
          {input.testPanel}
          <SandboxSetupScriptEditor
            ariaLabelledBy={input.ariaLabelledBy}
            disabled={input.disabled === true}
            onChange={(nextValue) => {
              input.onChange?.(nextValue);
            }}
            placeholderText={input.placeholderText}
            value={input.value}
          />
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
