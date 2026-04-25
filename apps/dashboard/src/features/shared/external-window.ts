type DeferredExternalWindow = {
  close: () => void;
  navigate: (url: string) => void;
};

export function openDeferredExternalWindow(input: {
  loadingMessage: string;
  title: string;
}): DeferredExternalWindow | null {
  const openedWindow = window.open("about:blank", "_blank");
  if (openedWindow === null) {
    return null;
  }

  openedWindow.opener = null;
  openedWindow.document.title = input.title;

  const message = openedWindow.document.createElement("p");
  message.style.fontFamily = "sans-serif";
  message.style.padding = "24px";
  message.textContent = input.loadingMessage;
  openedWindow.document.body.replaceChildren(message);

  return {
    close: () => {
      openedWindow.close();
    },
    navigate: (url: string) => {
      openedWindow.location.replace(url);
    },
  };
}
