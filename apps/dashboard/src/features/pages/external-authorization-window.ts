type ExternalAuthorizationWindow = {
  close: () => void;
  navigate: (url: string) => void;
};

export function openExternalAuthorizationWindow(input: {
  loadingMessage: string;
  title: string;
}): ExternalAuthorizationWindow | null {
  const openedWindow = window.open("about:blank", "_blank");
  if (openedWindow === null) {
    return null;
  }

  openedWindow.opener = null;
  openedWindow.document.title = input.title;
  openedWindow.document.body.innerHTML = `<p style="font-family: sans-serif; padding: 24px;">${input.loadingMessage}</p>`;

  return {
    close: () => {
      openedWindow.close();
    },
    navigate: (url: string) => {
      openedWindow.location.replace(url);
    },
  };
}
