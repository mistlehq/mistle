import { useMemo, useState } from "react";

import type { SettingsInvitation, SettingsMember } from "./members-api.js";

import {
  buildMembersDirectoryRows,
  filterMembersDirectoryRows,
  type MembersDirectoryRow,
  type MembersDirectoryTableFilter,
} from "./members-directory-model.js";

export function useMembersDirectoryTableState(input: {
  members: SettingsMember[];
  invitations: SettingsInvitation[];
}): {
  selectedInvitationForDetails: SettingsInvitation | null;
  setSelectedInvitationForDetails: (nextValue: SettingsInvitation | null) => void;
  activeFilter: MembersDirectoryTableFilter;
  setActiveFilter: (nextValue: MembersDirectoryTableFilter) => void;
  searchValue: string;
  setSearchValue: (nextValue: string) => void;
  rows: MembersDirectoryRow[];
  visibleRows: MembersDirectoryRow[];
  hasRows: boolean;
} {
  const [selectedInvitationForDetails, setSelectedInvitationForDetails] =
    useState<SettingsInvitation | null>(null);
  const [activeFilter, setActiveFilter] = useState<MembersDirectoryTableFilter>("all");
  const [searchValue, setSearchValue] = useState("");

  const rows = useMemo(
    () =>
      buildMembersDirectoryRows({
        members: input.members,
        invitations: input.invitations,
      }),
    [input.members, input.invitations],
  );
  const visibleRows = useMemo(
    () =>
      filterMembersDirectoryRows({
        rows,
        filter: activeFilter,
        search: searchValue,
      }),
    [rows, activeFilter, searchValue],
  );

  return {
    selectedInvitationForDetails,
    setSelectedInvitationForDetails,
    activeFilter,
    setActiveFilter,
    searchValue,
    setSearchValue,
    rows,
    visibleRows,
    hasRows: rows.length > 0,
  };
}
