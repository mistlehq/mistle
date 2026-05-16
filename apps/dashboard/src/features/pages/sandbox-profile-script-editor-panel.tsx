import { Field, FieldContent, FieldHeader, FieldLabel, SectionBlock } from "@mistle/ui";
import type { ReactNode } from "react";

import { SandboxProfileSectionCard } from "./sandbox-profile-section-card.js";
import { SandboxSetupScriptEditor } from "./sandbox-setup-script-editor.js";

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
  testControl?: ReactNode | undefined;
  testPanel?: ReactNode | undefined;
  title: string;
  value: string;
}): React.JSX.Element {
  return (
    <SectionBlock description={input.description} title={input.title}>
      <SandboxProfileSectionCard>
        <Field>
          <FieldHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <FieldLabel id={input.ariaLabelledBy}>{input.fieldLabel}</FieldLabel>
              {input.testControl}
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
      </SandboxProfileSectionCard>
    </SectionBlock>
  );
}
