import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mistle/ui";
import type { ReactNode } from "react";

export type SandboxProfileEditorSection<TSectionId extends string = string> = {
  id: TSectionId;
  label: string;
  sideLabel?: ReactNode;
  disabled?: boolean;
};

export function SandboxProfileEditorSections<TSectionId extends string>(input: {
  sections: readonly SandboxProfileEditorSection<TSectionId>[];
  activeSectionId: TSectionId;
  onActiveSectionIdChange: (sectionId: TSectionId) => void;
  renderPanel: (activeSectionId: TSectionId) => React.JSX.Element;
}): React.JSX.Element {
  const activeSection = input.sections.find((section) => section.id === input.activeSectionId);
  if (activeSection === undefined) {
    throw new Error(
      `Active sandbox profile editor section is not registered: ${input.activeSectionId}`,
    );
  }

  function updateActiveSectionId(sectionId: TSectionId): void {
    const nextSection = input.sections.find((section) => section.id === sectionId);
    if (nextSection?.disabled === true) {
      return;
    }

    input.onActiveSectionIdChange(sectionId);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="md:hidden">
        <Select
          onValueChange={(value) => {
            const nextSection = input.sections.find((section) => section.id === value);
            if (nextSection === undefined) {
              return;
            }

            updateActiveSectionId(nextSection.id);
          }}
          value={input.activeSectionId}
        >
          <SelectTrigger aria-label="Select profile editor section" className="w-full">
            <SelectValue placeholder="Select section">{activeSection.label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {input.sections.map((section) => (
              <SelectItem disabled={section.disabled === true} key={section.id} value={section.id}>
                {section.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-6 md:grid md:grid-cols-[10rem_1px_minmax(0,1fr)] md:gap-0 lg:grid-cols-[11rem_1px_minmax(0,1fr)]">
        <div aria-label="Profile sections" className="hidden flex-col md:flex" role="tablist">
          {input.sections.map((section) => (
            <button
              aria-controls={`sandbox-profile-editor-panel-${section.id}`}
              aria-disabled={section.disabled === true}
              aria-selected={section.id === input.activeSectionId}
              disabled={section.disabled === true}
              className={`flex w-full items-start border-l-2 py-3 pl-4 pr-3 text-left text-sm font-medium leading-tight transition-colors ${
                section.id === input.activeSectionId
                  ? "border-foreground text-foreground"
                  : section.disabled === true
                    ? "border-transparent text-muted-foreground/50"
                    : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              id={`sandbox-profile-editor-tab-${section.id}`}
              key={section.id}
              onClick={() => {
                updateActiveSectionId(section.id);
              }}
              role="tab"
              tabIndex={section.id === input.activeSectionId ? 0 : -1}
              type="button"
            >
              {section.sideLabel ?? section.label}
            </button>
          ))}
        </div>

        <div aria-hidden className="hidden self-stretch bg-border md:block md:w-px" />

        <div className="flex min-w-0 flex-1 flex-col gap-4 md:pl-8">
          <div
            aria-labelledby={`sandbox-profile-editor-tab-${activeSection.id}`}
            id={`sandbox-profile-editor-panel-${activeSection.id}`}
            role="tabpanel"
          >
            {input.renderPanel(input.activeSectionId)}
          </div>
        </div>
      </div>
    </div>
  );
}
