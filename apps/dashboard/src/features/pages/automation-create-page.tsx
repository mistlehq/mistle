import { useNavigate, useSearchParams } from "react-router";

import {
  createProfileAutomationDetailPath,
  type CreatedAutomationNavigationTarget,
} from "../automations/automation-editor-navigation.js";
import {
  AutomationTypeSelectField,
  type AutomationTypeValue,
} from "../automations/automation-type-field.js";
import { useAppPageMeta } from "../navigation/route-meta.js";
import { PageFrame, resolvePageFrameText } from "../shared/page-frame.js";
import { CreateScheduledAutomationEditor } from "./scheduled-automation-editor-page.js";
import { CreateWebhookAutomationEditor } from "./webhook-automation-editor-page.js";

function parseAutomationCreateKind(value: string | null): AutomationTypeValue {
  return value === "scheduled" ? "scheduled" : "trigger";
}

function parseSandboxProfileId(value: string | null): string | undefined {
  if (value === null) {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length === 0 ? undefined : normalized;
}

export function AutomationCreatePage(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const kind = parseAutomationCreateKind(searchParams.get("type"));
  const initialSandboxProfileId = parseSandboxProfileId(searchParams.get("sandboxProfileId"));
  const { title, description } = resolvePageFrameText(pageMeta, "Create automation");
  const createSuccessPath =
    initialSandboxProfileId === undefined
      ? undefined
      : (automation: CreatedAutomationNavigationTarget) =>
          createProfileAutomationDetailPath({
            profileId: automation.target.sandboxProfileId,
            automationId: automation.id,
          });

  function updateKind(nextKind: AutomationTypeValue): void {
    const nextSearchParams = new URLSearchParams(searchParams);
    if (nextKind === "trigger") {
      nextSearchParams.delete("type");
    } else {
      nextSearchParams.set("type", nextKind);
    }
    setSearchParams(nextSearchParams, { replace: true });
  }

  const automationTypeField = <AutomationTypeSelectField onValueChange={updateKind} value={kind} />;

  return (
    <PageFrame description={description} title={title} width="form">
      {kind === "scheduled" ? (
        <CreateScheduledAutomationEditor
          automationTypeField={automationTypeField}
          initialSandboxProfileId={initialSandboxProfileId}
          {...(createSuccessPath === undefined ? {} : { createSuccessPath })}
          navigate={navigate}
        />
      ) : (
        <CreateWebhookAutomationEditor
          automationTypeField={automationTypeField}
          initialSandboxProfileId={initialSandboxProfileId}
          {...(createSuccessPath === undefined ? {} : { createSuccessPath })}
          navigate={navigate}
        />
      )}
    </PageFrame>
  );
}
