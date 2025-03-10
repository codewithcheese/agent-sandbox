/// <reference types="vite/client" />
import ChatElement from "./ChatElement.svelte";
import SettingsPage from "./SettingsPage.svelte";
import ModelProviderModal from "./ModelProviderModal.svelte";
import ModelModal from "./ModelModal.svelte";

const url = new URL(import.meta.url);
const params = url.searchParams;
const mountId = params.get("mountId");

if (!mountId) {
  throw new Error("mountId not set");
}

if (!(mountId in window.Mounts)) {
  throw new Error(`Mount ${mountId} not found`);
}

// map of components imported via vite dev server, no HMR if imported in plugin
window.Mounts[mountId]({
  ChatElement,
  SettingsPage,
  ModelProviderModal,
  ModelModal,
});

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    console.log("Reload accepted");
  });
}
