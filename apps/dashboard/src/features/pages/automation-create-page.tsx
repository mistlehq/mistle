import { useNavigate, useSearchParams } from "react-router";

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

export function AutomationCreatePage(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const kind = parseAutomationCreateKind(searchParams.get("type"));
  const { title, description } = resolvePageFrameText(pageMeta, "Create automation");

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
          navigate={navigate}
        />
      ) : (
        <CreateWebhookAutomationEditor
          automationTypeField={automationTypeField}
          navigate={navigate}
        />
      )}
    </PageFrame>
  );
}
