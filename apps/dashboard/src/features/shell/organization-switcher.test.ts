import { describe, expect, it } from "vitest";

import { sortOrganizationSwitcherOptions } from "./organization-switcher.js";

describe("sortOrganizationSwitcherOptions", () => {
  it("orders organizations alphabetically by name", () => {
    const sortedOrganizations = sortOrganizationSwitcherOptions([
      { id: "org_staffany", name: "StaffAny" },
      { id: "org_mistle", name: "Mistle" },
      { id: "org_cyber_sierra", name: "Cyber Sierra" },
    ]);

    expect(sortedOrganizations).toEqual([
      { id: "org_cyber_sierra", name: "Cyber Sierra" },
      { id: "org_mistle", name: "Mistle" },
      { id: "org_staffany", name: "StaffAny" },
    ]);
  });

  it("does not mutate the original organization list", () => {
    const organizations = [
      { id: "org_staffany", name: "StaffAny" },
      { id: "org_mistle", name: "Mistle" },
    ];

    sortOrganizationSwitcherOptions(organizations);

    expect(organizations).toEqual([
      { id: "org_staffany", name: "StaffAny" },
      { id: "org_mistle", name: "Mistle" },
    ]);
  });

  it("uses organization id as a deterministic tie-breaker", () => {
    const sortedOrganizations = sortOrganizationSwitcherOptions([
      { id: "org_beta", name: "Mistle" },
      { id: "org_alpha", name: "Mistle" },
    ]);

    expect(sortedOrganizations).toEqual([
      { id: "org_alpha", name: "Mistle" },
      { id: "org_beta", name: "Mistle" },
    ]);
  });
});
