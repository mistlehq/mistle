import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mistle/ui";
import { useState, type ReactNode } from "react";

export type SandboxProfileEditorSection<TSectionId extends string = string> = {
  id: TSectionId;
  label: string;
  sideLabel?: ReactNode;
  disabled?: boolean;
};

export function SandboxProfileEditorSections<TSectionId extends string>(input: {
  sections: readonly SandboxProfileEditorSection<TSectionId>[];
  activeSectionId?: TSectionId;
  initialSectionId?: TSectionId;
  onActiveSectionIdChange?: (sectionId: TSectionId) => void;
  renderPanel: (activeSectionId: TSectionId) => React.JSX.Element;
}): React.JSX.Element {
  const [internalActiveSectionId, setInternalActiveSectionId] = useState<TSectionId | undefined>(
    input.initialSectionId ?? input.sections[0]?.id,
  );
  const activeSectionId = input.activeSectionId ?? internalActiveSectionId;
  const activeSection = input.sections.find((section) => section.id === activeSectionId);

  function updateActiveSectionId(sectionId: TSectionId): void {
    const nextSection = input.sections.find((section) => section.id === sectionId);
    if (nextSection?.disabled === true) {
      return;
    }

    if (input.activeSectionId === undefined) {
      setInternalActiveSectionId(sectionId);
    }
    input.onActiveSectionIdChange?.(sectionId);
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
          value={activeSectionId}
        >
          <SelectTrigger aria-label="Select profile editor section" className="w-full">
            <SelectValue placeholder="Select section">
              {input.sections.find((section) => section.id === activeSectionId)?.label}
            </SelectValue>
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
              aria-selected={section.id === activeSectionId}
              disabled={section.disabled === true}
              className={`flex w-full items-start border-l-2 py-3 pl-4 pr-3 text-left text-sm font-medium leading-tight transition-colors ${
                section.id === activeSectionId
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
              tabIndex={section.id === activeSectionId ? 0 : -1}
              type="button"
            >
              {section.sideLabel ?? section.label}
            </button>
          ))}
        </div>

        <div aria-hidden className="hidden self-stretch bg-border md:block md:w-px" />

        <div className="flex min-w-0 flex-1 flex-col gap-4 md:pl-8">
          <div
            aria-labelledby={
              activeSection === undefined
                ? undefined
                : `sandbox-profile-editor-tab-${activeSection.id}`
            }
            id={
              activeSection === undefined
                ? undefined
                : `sandbox-profile-editor-panel-${activeSection.id}`
            }
            role="tabpanel"
          >
            {activeSectionId === undefined ? null : input.renderPanel(activeSectionId)}
          </div>
        </div>
      </div>
    </div>
  );
}
