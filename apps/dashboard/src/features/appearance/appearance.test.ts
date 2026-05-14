import { describe, expect, it } from "vitest";

import { readUserAppearanceFromSession, resolveAppearance, UserAppearances } from "./appearance.js";

describe("appearance preferences", () => {
  it("resolves system appearance from the current system color scheme", () => {
    expect(
      resolveAppearance({
        appearance: UserAppearances.SYSTEM,
        systemPrefersDark: true,
      }),
    ).toBe(UserAppearances.DARK);

    expect(
      resolveAppearance({
        appearance: UserAppearances.SYSTEM,
        systemPrefersDark: false,
      }),
    ).toBe(UserAppearances.LIGHT);
  });

  it("keeps explicit light and dark appearances independent of the system color scheme", () => {
    expect(
      resolveAppearance({
        appearance: UserAppearances.LIGHT,
        systemPrefersDark: true,
      }),
    ).toBe(UserAppearances.LIGHT);

    expect(
      resolveAppearance({
        appearance: UserAppearances.DARK,
        systemPrefersDark: false,
      }),
    ).toBe(UserAppearances.DARK);
  });

  it("reads the appearance preference from the authenticated session", () => {
    expect(
      readUserAppearanceFromSession({
        user: {
          appearance: UserAppearances.DARK,
        },
      }),
    ).toBe(UserAppearances.DARK);
  });

  it("fails when the authenticated session does not include a valid appearance preference", () => {
    expect(() =>
      readUserAppearanceFromSession({
        user: {
          appearance: "sepia",
        },
      }),
    ).toThrow("Authenticated user session is missing a valid appearance preference.");
  });
});
