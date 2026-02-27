import type { InviteChip, InviteNotSentItem } from "./member-invite-state.js";
import { buildInviteResultsViewModel } from "./member-invite-state.js";

function renderSentSection(chips: readonly InviteChip[]): React.JSX.Element | null {
  if (chips.length === 0) {
    return null;
  }

  return (
    <div className="border rounded-md p-3">
      <p className="font-medium text-sm">Invites sent successfully ({chips.length})</p>
      <ul className="space-y-1 mt-2 max-h-56 overflow-y-auto pr-1">
        {chips.map((chip) => (
          <li className="text-sm" key={chip.id}>
            {chip.normalizedEmail}
          </li>
        ))}
      </ul>
    </div>
  );
}

function renderNotSentSection(items: readonly InviteNotSentItem[]): React.JSX.Element | null {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="border rounded-md p-3">
      <p className="font-medium text-sm">Invites not sent ({items.length})</p>
      <ul className="space-y-1 mt-2 max-h-56 overflow-y-auto pr-1">
        {items.map((item) => (
          <li className="text-sm" key={item.chip.id}>
            {item.chip.normalizedEmail}{" "}
            <span className="text-muted-foreground">- {item.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MemberInviteResultsView(input: { chips: InviteChip[] }): React.JSX.Element {
  const viewModel = buildInviteResultsViewModel(input.chips);
  const hasAnyResults = viewModel.sentSuccessfully.length > 0 || viewModel.notSent.length > 0;

  return (
    <div className="gap-4 grid">
      <div className="gap-3 grid">
        {!hasAnyResults ? (
          <p className="text-sm text-muted-foreground">No invite results yet.</p>
        ) : null}
        {renderSentSection(viewModel.sentSuccessfully)}
        {renderNotSentSection(viewModel.notSent)}
      </div>
    </div>
  );
}
