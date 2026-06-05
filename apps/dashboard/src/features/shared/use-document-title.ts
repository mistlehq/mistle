import { useEffect } from "react";

export function useDocumentTitle(title: string): void {
  // Synchronizes React with the browser document title, an external DOM side effect that
  // cannot run during render and needs cleanup when the owning route unmounts.
  useEffect(() => {
    const previousTitle = document.title;

    return () => {
      document.title = previousTitle;
    };
  }, []);

  useEffect(() => {
    document.title = title;
  }, [title]);
}
