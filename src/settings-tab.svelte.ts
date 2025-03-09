import {mount} from "svelte";
import SettingsPage from "./SettingsPage.svelte";

if (!document.getElementById('settings-tab')) {
    console.error('settings-tab element not found');
}

mount(SettingsPage, {target: document.getElementById('settings-tab')!});

if (import.meta.hot) {
    import.meta.hot.accept(() => {
        console.log("Reload accepted");
    });
}
