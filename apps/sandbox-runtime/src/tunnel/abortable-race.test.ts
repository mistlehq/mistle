import { describe, expect, it } from "vitest";

import { createAbortRace } from "./abortable-race.js";

describe("createAbortRace", () => {
  it("rejects when the signal aborts", async () => {
    const controller = new AbortController();
    const race = createAbortRace(controller.signal);
    const abortError = new Error("aborted");

    controller.abort(abortError);

    await expect(race.promise).rejects.toBe(abortError);
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    const abortError = new Error("already aborted");

    controller.abort(abortError);

    const race = createAbortRace(controller.signal);

    await expect(race.promise).rejects.toBe(abortError);
  });

  it("does not reject after disposal", async () => {
    const controller = new AbortController();
    const race = createAbortRace(controller.signal);
    let settled = false;

    void race.promise.catch(() => {
      settled = true;
    });

    race.dispose();
    controller.abort(new Error("aborted after dispose"));
    await Promise.resolve();

    expect(settled).toBe(false);
  });
});
