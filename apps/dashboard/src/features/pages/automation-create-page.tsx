import type { CSSProperties } from "react";
import { useNavigate, useSearchParams } from "react-router";

import {
  createProfileAutomationDetailPath,
  type CreatedAutomationNavigationTarget,
} from "../automations/automation-editor-navigation.js";
import { CreateAutomationEditor } from "../automations/create-automation-editor.js";
import { findTriggerTemplateById } from "../automations/trigger-templates.js";
import { useAppPageMeta } from "../navigation/route-meta.js";
import { PageFrame, resolvePageFrameText } from "../shared/page-frame.js";

const AutomationCreatePageScrollStyle: CSSProperties = {
  scrollbarGutter: "stable",
};

function parseSandboxProfileId(value: string | null): string | undefined {
  if (value === null) {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length === 0 ? undefined : normalized;
}

function parseTriggerTemplateId(value: string | null): string | undefined {
  if (value === null) {
    return undefined;
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return undefined;
  }

  if (findTriggerTemplateById(normalized) === null) {
    throw new Error(`Unknown trigger template '${normalized}'.`);
  }

  return normalized;
}

export function AutomationCreatePage(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialSandboxProfileId = parseSandboxProfileId(searchParams.get("sandboxProfileId"));
  const initialTemplateId = parseTriggerTemplateId(searchParams.get("template"));
  const { title, description } = resolvePageFrameText(pageMeta, "Create trigger");
  const createSuccessPath =
    initialSandboxProfileId === undefined
      ? undefined
      : (automation: CreatedAutomationNavigationTarget) =>
          createProfileAutomationDetailPath({
            profileId: automation.target.sandboxProfileId,
            automationId: automation.id,
          });

  return (
    <div
      aria-label="Create trigger page"
      className="h-full min-h-0 overflow-y-auto overscroll-contain"
      role="region"
      style={AutomationCreatePageScrollStyle}
    >
      <PageFrame description={description} title={title} width="form">
        <CreateAutomationEditor
          {...(initialSandboxProfileId === undefined ? {} : { initialSandboxProfileId })}
          {...(initialTemplateId === undefined ? {} : { initialTemplateId })}
          {...(createSuccessPath === undefined ? {} : { createSuccessPath })}
          navigate={navigate}
        />
      </PageFrame>
    </div>
  );
}
