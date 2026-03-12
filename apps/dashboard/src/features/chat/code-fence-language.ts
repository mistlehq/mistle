const CodeFenceLanguageByExtension = {
  cjs: "js",
  js: "js",
  mjs: "js",
  cts: "ts",
  mts: "ts",
  ts: "ts",
  jsx: "jsx",
  tsx: "tsx",
  css: "css",
  diff: "diff",
  go: "go",
  html: "html",
  java: "java",
  json: "json",
  py: "py",
  rb: "rb",
  rs: "rs",
  sh: "sh",
  sql: "sql",
  xml: "xml",
  yaml: "yaml",
  yml: "yml",
} as const;

function getPathExtension(path: string): string | null {
  const lastDotIndex = path.lastIndexOf(".");
  if (lastDotIndex === -1 || lastDotIndex === path.length - 1) {
    return null;
  }

  return path.slice(lastDotIndex + 1).toLowerCase();
}

export function isMarkdownPath(path: string): boolean {
  const extension = getPathExtension(path);
  return extension === "md" || extension === "mdx";
}

export function getCodeFenceLanguage(path: string): string | null {
  const extension = getPathExtension(path);
  if (extension === null) {
    return null;
  }

  return (
    CodeFenceLanguageByExtension[extension as keyof typeof CodeFenceLanguageByExtension] ?? null
  );
}
