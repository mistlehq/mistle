import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mistle/ui";
import type { ReactNode } from "react";

export type SandboxProfileEditorSection<TSectionId extends string = string> = {
  id: TSectionId;
  label: string;
  sideLabel?: ReactNode;
  disabled?: boolean;
};

export function SandboxProfileEditorHorizontalTabContent(input: {
  children: ReactNode;
}): React.JSX.Element {
  return <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">{input.children}</div>;
}

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
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="px-4 md:hidden">
        <div className="mx-auto w-full max-w-5xl">
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
                <SelectItem
                  disabled={section.disabled === true}
                  key={section.id}
                  value={section.id}
                >
                  {section.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="hidden border-b border-border px-4 md:block">
          <div
            aria-label="Profile sections"
            className="mx-auto flex w-full max-w-5xl"
            role="tablist"
          >
            {input.sections.map((section) => (
              <button
                aria-controls={`sandbox-profile-editor-panel-${section.id}`}
                aria-disabled={section.disabled === true}
                aria-selected={section.id === input.activeSectionId}
                disabled={section.disabled === true}
                className={`-mb-px flex items-center border-b-2 px-4 py-3 text-left text-sm font-medium leading-tight transition-colors ${
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
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-4 bg-muted/30">
          {input.sections.map((section) => (
            <div
              aria-labelledby={`sandbox-profile-editor-tab-${section.id}`}
              className="flex-1 px-4 py-6"
              hidden={section.id !== activeSection.id}
              id={`sandbox-profile-editor-panel-${section.id}`}
              key={section.id}
              role="tabpanel"
            >
              {input.renderPanel(section.id)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
