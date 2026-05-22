// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HomeOnboardingHeaderTitle } from "./home-onboarding-header-title.js";

describe("HomeOnboardingHeaderTitle", () => {
  it("renders the beta notice before the onboarding title", () => {
    render(<HomeOnboardingHeaderTitle showGetStartedTitle={true} />);

    const noticeTitle = screen.getByText(
      "Mistle Cloud is in beta - Usage is free, subject to usage limits",
    );
    const pageTitle = screen.getByRole("heading", { name: "Get started" });

    expect(noticeTitle.compareDocumentPosition(pageTitle)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      screen.getByText(
        "The free tier includes up to 2 concurrent sandboxes, with runtime and instance-size limits. During beta, some limits may be higher while we tune capacity.",
      ),
    ).toBeDefined();
  });

  it("can render the beta notice without the onboarding title", () => {
    render(<HomeOnboardingHeaderTitle showGetStartedTitle={false} />);

    expect(
      screen.getByText("Mistle Cloud is in beta - Usage is free, subject to usage limits"),
    ).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Get started" })).toBeNull();
  });
});
