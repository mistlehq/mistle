// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Button } from "./button.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogShortcut,
  DialogTitle,
} from "./dialog.js";

describe("Dialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("suppresses dismissal while nondismissible", () => {
    const openChanges: boolean[] = [];

    render(
      <Dialog
        isDismissible={false}
        onOpenChange={(open) => {
          openChanges.push(open);
        }}
        open
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Locked dialog</DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <Button type="button">Continue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    if (overlay === null) {
      throw new Error("Expected dialog overlay.");
    }
    fireEvent.click(overlay);

    expect(openChanges).toEqual([]);
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("marks dialog content busy when requested", () => {
    render(
      <Dialog isBusy open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Busy dialog</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("true");
  });

  it("renders the shared dialog shortcut token", () => {
    render(<DialogShortcut aria-label="Enter" />);

    expect(screen.getByLabelText("Enter").textContent).toBe("\u2B90");
  });

  it("renders dialog content inside a form when form props are provided", () => {
    const submits: string[] = [];

    render(
      <Dialog open>
        <DialogContent
          formProps={{
            onSubmit: (event) => {
              event.preventDefault();
              submits.push("submitted");
            },
          }}
        >
          <DialogHeader>
            <DialogTitle>Form dialog</DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );

    const dialog = screen.getByRole("dialog");
    const form = dialog.querySelector("form");

    if (form === null) {
      throw new Error("Expected dialog form.");
    }

    fireEvent.submit(form);

    expect(submits).toEqual(["submitted"]);
    expect(screen.getByRole("button", { name: "Close" }).getAttribute("type")).toBe("button");
  });
});
