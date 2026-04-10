import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  DropdownMenuItem,
  MoreActionsMenu,
  TableCell,
  TableRow,
} from "@mistle/ui";

import { deriveInitials } from "../../shared/derive-initials.js";
import type { MemberAvatar } from "./members-api.js";
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
          data-feedback-state={input.actionFeedback.state}
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
  role: string;
  status: string | null;
  invitedBy: string | null;
  expiresAt: string | null;
  showNameColumn: boolean;
  showStatusColumn: boolean;
  showInvitedByColumn: boolean;
  showExpiresColumn: boolean;
  date: string;
  showMemberAvatar: boolean;
  memberAvatar: MemberAvatar | null;
  actionsLabel: string;
  actionsContentClassName?: string;
  actionFeedback: MembersDirectoryActionFeedback | null;
  actions: MembersTableAction[];
}): React.JSX.Element {
  return (
    <TableRow>
      {input.showNameColumn ? (
        <TableCell className="font-medium whitespace-normal break-words">
          {!input.showMemberAvatar ? (
            input.name
          ) : (
            <div className="flex items-center gap-3">
              <Avatar className="bg-muted h-8 w-8 shrink-0">
                {input.memberAvatar === null || input.memberAvatar.imageUrl === null ? null : (
                  <AvatarImage alt={`${input.name} avatar`} src={input.memberAvatar.imageUrl} />
                )}
                <AvatarFallback>
                  {deriveInitials({ name: input.name, fallback: "?" })}
                </AvatarFallback>
              </Avatar>
              <span>{input.name}</span>
            </div>
          )}
        </TableCell>
      ) : null}
      <TableCell className="whitespace-normal break-words">{input.email}</TableCell>
      <TableCell className="whitespace-nowrap">{input.role}</TableCell>
      {input.showStatusColumn ? (
        <TableCell className="whitespace-nowrap">{input.status}</TableCell>
      ) : null}
      {input.showInvitedByColumn ? (
        <TableCell className="whitespace-nowrap">{input.invitedBy}</TableCell>
      ) : null}
      <TableCell className="whitespace-nowrap">{input.date}</TableCell>
      {input.showExpiresColumn ? (
        <TableCell className="whitespace-nowrap">{input.expiresAt}</TableCell>
      ) : null}
      <TableCell className="whitespace-nowrap">
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
