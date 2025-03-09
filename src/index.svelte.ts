/// <reference types="vite/client" />
import ChatElement from "./ChatElement.svelte";

if (!customElements.get("chat-view")) {
  // @ts-expect-error types incorrect for .element
  customElements.define("chat-view", ChatElement.element);
}

document.getElementById("chat-view")!.innerHTML = `<chat-view></chat-view>`;

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    console.log("Reload accepted");
  });
}
