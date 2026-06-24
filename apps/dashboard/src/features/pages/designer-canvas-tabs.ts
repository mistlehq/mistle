import type { DesignerSessionCanvasTab } from "../designer/designer-service.js";

export function mergeDesignerCanvasTabSnapshotIntoLatestTabs(input: {
  latestTabs: readonly DesignerSessionCanvasTab[];
  snapshotTabs: readonly DesignerSessionCanvasTab[];
}): readonly DesignerSessionCanvasTab[] {
  const snapshotTabById = new Map(input.snapshotTabs.map((tab) => [tab.id, tab]));
  const latestTabIds = new Set(input.latestTabs.map((tab) => tab.id));

  return [
    ...input.latestTabs.map((tab) => snapshotTabById.get(tab.id) ?? tab),
    ...input.snapshotTabs.filter((tab) => !latestTabIds.has(tab.id)),
  ];
}

export function removeDesignerCanvasTabFromLatestTabs(input: {
  latestTabs: readonly DesignerSessionCanvasTab[];
  tabId: string;
}): readonly DesignerSessionCanvasTab[] {
  return input.latestTabs.filter((tab) => tab.id !== input.tabId);
}
