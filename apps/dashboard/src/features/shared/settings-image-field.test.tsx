// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SettingsImageField } from "./settings-image-field.js";

describe("SettingsImageField", () => {
  it("renders image operation errors at the full field-content width", () => {
    render(
      <SettingsImageField
        alt="Mistle profile image"
        busy={false}
        errorMessage="Could not upload profile image."
        fallbackInitial="U"
        imageUrl={null}
        imageName="profile image"
        label="Avatar"
        name="Mistle Developer"
        onDelete={async () => {}}
        onUpload={async () => {}}
      />,
    );

    const errorMessage = screen.getByText("Could not upload profile image.");

    expect(errorMessage.className).toContain("w-full");
    expect(errorMessage.className).toContain("self-stretch");
    expect(errorMessage.className).not.toContain("max-w-44");
  });
});
