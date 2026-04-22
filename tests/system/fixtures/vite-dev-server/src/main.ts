import "./styles.css";
import { virtualList, virtualMessage } from "virtual:mistle-vite-fixture";

import logoUrl from "./logo.svg";
import noteText from "./note.txt?raw";

const root = document.querySelector("#app");
if (!(root instanceof HTMLElement)) {
  throw new Error("Fixture root element is missing.");
}

const assetImage = document.createElement("img");
assetImage.alt = "Mistle fixture logo";
assetImage.src = logoUrl;
assetImage.width = 160;

const headline = document.createElement("h1");
headline.textContent = "Mistle Vite Fixture";

const copy = document.createElement("p");
copy.dataset.virtual = virtualMessage;
copy.dataset.virtualList = virtualList.join(",");
copy.textContent = noteText.trim();

root.replaceChildren(headline, assetImage, copy);

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    console.info("mistle fixture hmr accepted");
  });
}
