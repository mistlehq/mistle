export const DesignerRoutePath = "/designer";

export function createDesignerSessionPath(sessionId: string): string {
  return `${DesignerRoutePath}/${encodeURIComponent(sessionId)}`;
}
