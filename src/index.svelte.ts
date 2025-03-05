/// <reference types="vite/client" />
import ChatView from "./ChatView.svelte";
// import { mount } from "svelte";

console.log(customElements);

if (!customElements.get("chat-view")) {
  // @ts-expect-error types incorrect for .element
  customElements.define("chat-view", ChatView.element);
}

document.getElementById("chat-view")!.innerHTML = `<chat-view></chat-view>`;

// mount(ChatView, { target: document.getElementById("chat-view")! });
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    console.log("Reload accepted");
  });
}
