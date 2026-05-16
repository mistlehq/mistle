import type { CSSProperties } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { useAppPageMeta } from "../navigation/route-meta.js";
import { PageFrame, resolvePageFrameText } from "../shared/page-frame.js";
import { CreateTriggerEditor } from "../triggers/create-trigger-editor.js";
import {
  createProfileTriggerDetailPath,
  type CreatedTriggerNavigationTarget,
} from "../triggers/trigger-editor-navigation.js";
import { findTriggerTemplateById } from "../triggers/trigger-templates.js";

const TriggerCreatePageScrollStyle: CSSProperties = {
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

export function TriggerCreatePage(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialSandboxProfileId = parseSandboxProfileId(searchParams.get("sandboxProfileId"));
  const initialTemplateId = parseTriggerTemplateId(searchParams.get("template"));
  const { title, description } = resolvePageFrameText(pageMeta, "Create trigger");
  const createSuccessPath =
    initialSandboxProfileId === undefined
      ? undefined
      : (trigger: CreatedTriggerNavigationTarget) =>
          createProfileTriggerDetailPath({
            profileId: trigger.target.sandboxProfileId,
            triggerId: trigger.id,
          });

  return (
    <div
      aria-label="Create trigger page"
      className="h-full min-h-0 overflow-y-auto overscroll-contain"
      role="region"
      style={TriggerCreatePageScrollStyle}
    >
      <PageFrame description={description} title={title} width="form">
        <CreateTriggerEditor
          {...(initialSandboxProfileId === undefined ? {} : { initialSandboxProfileId })}
          {...(initialTemplateId === undefined ? {} : { initialTemplateId })}
          {...(createSuccessPath === undefined ? {} : { createSuccessPath })}
          navigate={navigate}
        />
      </PageFrame>
    </div>
  );
}
