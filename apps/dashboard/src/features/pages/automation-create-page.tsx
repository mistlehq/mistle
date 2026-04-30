import {
  Field,
  FieldContent,
  FieldHeader,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@mistle/ui";
import { useNavigate, useSearchParams } from "react-router";

import { useAppPageMeta } from "../navigation/route-meta.js";
import { FormPageFrame, resolvePageFrameText } from "../shared/page-frame.js";
import { CreateScheduledAutomationEditor } from "./scheduled-automation-editor-page.js";
import { CreateWebhookAutomationEditor } from "./webhook-automation-editor-page.js";

type AutomationCreateKind = "trigger" | "scheduled";

function parseAutomationCreateKind(value: string | null): AutomationCreateKind {
  return value === "scheduled" ? "scheduled" : "trigger";
}

function formatAutomationCreateKind(kind: AutomationCreateKind): string {
  return kind === "scheduled" ? "Scheduled" : "Trigger";
}

export function AutomationCreatePage(): React.JSX.Element {
  const pageMeta = useAppPageMeta();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const kind = parseAutomationCreateKind(searchParams.get("type"));
  const { title, description } = resolvePageFrameText(pageMeta, "Create automation");

  function updateKind(nextKind: AutomationCreateKind): void {
    const nextSearchParams = new URLSearchParams(searchParams);
    if (nextKind === "trigger") {
      nextSearchParams.delete("type");
    } else {
      nextSearchParams.set("type", nextKind);
    }
    setSearchParams(nextSearchParams, { replace: true });
  }

  const automationTypeField = (
    <Field orientation="horizontal">
      <FieldHeader>
        <FieldLabel>Automation type</FieldLabel>
      </FieldHeader>
      <FieldContent>
        <Select
          onValueChange={(value) => {
            if (value === "trigger" || value === "scheduled") {
              updateKind(value);
            }
          }}
          value={kind}
        >
          <SelectTrigger>
            <SelectValue>{formatAutomationCreateKind(kind)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="trigger">Trigger</SelectItem>
            <SelectItem value="scheduled">Scheduled</SelectItem>
          </SelectContent>
        </Select>
      </FieldContent>
    </Field>
  );

  return (
    <FormPageFrame description={description} title={title}>
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
    </FormPageFrame>
  );
}
