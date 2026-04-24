type ExternalAuthorizationWindow = {
  close: () => void;
  navigate: (url: string) => void;
  targetName: string;
};

export function openExternalAuthorizationWindow(input: {
  loadingMessage: string;
  targetName?: string;
  title: string;
}): ExternalAuthorizationWindow | null {
  const targetName = input.targetName ?? "_blank";
  const openedWindow = window.open("about:blank", targetName);
  if (openedWindow === null) {
    return null;
  }

  openedWindow.opener = null;
  openedWindow.name = targetName;
  openedWindow.document.title = input.title;
  openedWindow.document.body.innerHTML = `<p style="font-family: sans-serif; padding: 24px;">${input.loadingMessage}</p>`;

  return {
    close: () => {
      openedWindow.close();
    },
    navigate: (url: string) => {
      openedWindow.location.replace(url);
    },
    targetName,
  };
}
