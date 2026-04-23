import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mistle/ui";
import { useState } from "react";

export type SandboxProfileEditorSection = {
  id: string;
  label: string;
};

export function SandboxProfileEditorSections(input: {
  sections: readonly SandboxProfileEditorSection[];
  initialSectionId?: string;
  renderPanel: (activeSectionId: string) => React.JSX.Element;
}): React.JSX.Element {
  const [activeSectionId, setActiveSectionId] = useState(
    input.initialSectionId ?? input.sections[0]?.id ?? "",
  );
  const activeSection = input.sections.find((section) => section.id === activeSectionId);

  return (
    <div className="flex flex-col gap-4">
      <div className="md:hidden">
        <Select onValueChange={(value) => setActiveSectionId(value ?? "")} value={activeSectionId}>
          <SelectTrigger aria-label="Select profile editor section" className="w-full">
            <SelectValue placeholder="Select section">
              {input.sections.find((section) => section.id === activeSectionId)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {input.sections.map((section) => (
              <SelectItem key={section.id} value={section.id}>
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
              aria-selected={section.id === activeSectionId}
              className={`flex w-full items-start border-l-2 py-3 pl-4 pr-3 text-left text-sm font-medium leading-tight transition-colors ${
                section.id === activeSectionId
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              id={`sandbox-profile-editor-tab-${section.id}`}
              key={section.id}
              onClick={() => {
                setActiveSectionId(section.id);
              }}
              role="tab"
              tabIndex={section.id === activeSectionId ? 0 : -1}
              type="button"
            >
              {section.label}
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
            {input.renderPanel(activeSectionId)}
          </div>
        </div>
      </div>
    </div>
  );
}
