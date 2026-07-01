import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createDesignerEvalArtifacts } from "./artifacts.ts";

describe("createDesignerEvalArtifacts", () => {
  it("stores run artifacts under date-first directories", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "designer-eval-artifacts-"));

    const artifacts = await createDesignerEvalArtifacts({
      artifactRoot,
      caseId: "github-pr-review-basic",
      runDate: "2026-06-30",
      runKey: "2026-06-30t10-01-22-774z-github-pr-review-basic",
    });

    expect(artifacts.artifactDir).toBe(
      join(
        artifactRoot,
        "2026-06-30",
        "github-pr-review-basic",
        "2026-06-30t10-01-22-774z-github-pr-review-basic",
      ),
    );
  });

  it("stores every blueprint canvas update as an ordered snapshot", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "designer-eval-artifacts-"));
    const artifacts = await createDesignerEvalArtifacts({
      artifactRoot,
      caseId: "github-pr-review-basic",
      runDate: "2026-06-30",
      runKey: "2026-06-30t10-01-22-774z-github-pr-review-basic",
    });

    await artifacts.writeDashboardAction({
      sequence: 1,
      kind: "show_designer_canvas_tab",
      tabKind: "blueprint",
      input: {
        kind: "blueprint",
        title: "First blueprint",
        blueprint: {
          version: 1,
          items: [
            {
              id: "step-1",
              label: "Initial step",
            },
          ],
        },
      },
      response: {},
    });
    await artifacts.writeDashboardAction({
      sequence: 2,
      kind: "request_user_input",
      inputId: "review_scope",
      input: {},
      response: {},
    });
    await artifacts.writeDashboardAction({
      sequence: 3,
      kind: "show_designer_canvas_tab",
      tabKind: "blueprint",
      input: {
        kind: "blueprint",
        title: "Updated blueprint",
        blueprint: {
          version: 1,
          items: [
            {
              id: "step-1",
              label: "Initial step",
            },
            {
              id: "step-2",
              label: "Added step",
            },
          ],
        },
      },
      response: {},
    });

    await expect(readFile(join(artifacts.artifactDir, "blueprints/index.jsonl"), "utf8")).resolves
      .toBe(`{"snapshotIndex":1,"sequence":1,"path":"blueprints/0001-sequence-0001.json"}
{"snapshotIndex":2,"sequence":3,"path":"blueprints/0002-sequence-0003.json"}
`);
    await expect(
      readFile(join(artifacts.artifactDir, "blueprints/0001-sequence-0001.json"), "utf8"),
    ).resolves.toContain("First blueprint");
    await expect(
      readFile(join(artifacts.artifactDir, "blueprints/0002-sequence-0003.json"), "utf8"),
    ).resolves.toContain("Added step");
  });
});
