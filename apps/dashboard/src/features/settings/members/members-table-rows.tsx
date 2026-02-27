import { DropdownMenuItem, TableCell, TableRow } from "@mistle/ui";

import { MoreActionsMenu } from "../../../components/more-actions-menu.js";
import type {
  MembersDirectoryActionDescriptor,
  MembersDirectoryActionFeedback,
} from "./members-directory-model.js";

export type MembersTableAction = {
  key: MembersDirectoryActionDescriptor["key"];
  label: string;
  disabled: boolean;
  destructive: boolean;
  onSelect: () => void;
};

function MembersTableMenuItems(input: { actions: MembersTableAction[] }): React.JSX.Element[] {
  return input.actions.map((action) => (
    <DropdownMenuItem
      className="whitespace-nowrap"
      disabled={action.disabled}
      key={action.key}
      onClick={action.onSelect}
      {...(action.destructive ? { variant: "destructive" } : {})}
    >
      {action.label}
    </DropdownMenuItem>
  ));
}

function MembersTableActions(input: {
  triggerLabel: string;
  contentClassName?: string;
  actionFeedback: MembersDirectoryActionFeedback | null;
  actions: MembersTableAction[];
}): React.JSX.Element | null {
  if (input.actionFeedback !== null) {
    const feedbackClassName =
      input.actionFeedback.tone === "destructive"
        ? "text-destructive"
        : input.actionFeedback.tone === "success"
          ? "text-emerald-700"
          : "text-muted-foreground";

    return (
      <div className="flex justify-end">
        <span
          aria-atomic="true"
          aria-live="polite"
          className={`text-sm font-medium ${feedbackClassName}`}
          role="status"
        >
          {input.actionFeedback.label}
        </span>
      </div>
    );
  }

  if (input.actions.length === 0) {
    return null;
  }

  return (
    <div className="flex justify-end">
      <MoreActionsMenu
        triggerLabel={input.triggerLabel}
        triggerSize="icon-xs"
        {...(input.contentClassName === undefined
          ? {}
          : { contentClassName: input.contentClassName })}
      >
        <MembersTableMenuItems actions={input.actions} />
      </MoreActionsMenu>
    </div>
  );
}

export function DirectoryTableRow(input: {
  name: string;
  email: string;
  status: string;
  date: string;
  actionsLabel: string;
  actionsContentClassName?: string;
  actionFeedback: MembersDirectoryActionFeedback | null;
  actions: MembersTableAction[];
}): React.JSX.Element {
  return (
    <TableRow>
      <TableCell className="font-medium">{input.name}</TableCell>
      <TableCell>{input.email}</TableCell>
      <TableCell>{input.status}</TableCell>
      <TableCell>{input.date}</TableCell>
      <TableCell>
        <MembersTableActions
          actionFeedback={input.actionFeedback}
          actions={input.actions}
          triggerLabel={input.actionsLabel}
          {...(input.actionsContentClassName === undefined
            ? {}
            : { contentClassName: input.actionsContentClassName })}
        />
      </TableCell>
    </TableRow>
  );
}
