// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OrganizationBillingSettingsPageView } from "./organization-billing-settings-page-view.js";

describe("OrganizationBillingSettingsPageView", () => {
  it("renders available billing details as plain definition values", () => {
    const { container } = render(
      <OrganizationBillingSettingsPageView
        billing={{
          available: true,
          organization: {
            name: "Mistle Labs",
            stripeCustomerId: "cus_test_123",
          },
        }}
        loadErrorMessage={null}
      />,
    );

    const details = container.querySelector("dl");
    expect(details).toBeTruthy();
    expect(screen.getByText("Organization name")).toBeTruthy();
    expect(screen.getByText("Mistle Labs")).toBeTruthy();
    expect(screen.getByText("Stripe customer ID")).toBeTruthy();
    expect(screen.getByText("cus_test_123")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders unavailable billing information without a retry action", () => {
    render(
      <OrganizationBillingSettingsPageView
        billing={{
          available: false,
        }}
        loadErrorMessage={null}
      />,
    );

    expect(screen.getByText("Billing information is not available yet.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders load errors without a retry action", () => {
    render(
      <OrganizationBillingSettingsPageView
        billing={{
          available: false,
        }}
        loadErrorMessage="Could not load billing information."
      />,
    );

    expect(
      screen.getByText("Could not load billing information. Please try again later."),
    ).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
