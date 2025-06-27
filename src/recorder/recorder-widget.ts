import { mount, unmount } from "svelte";
import Recorder from "./Recorder.svelte";
import RecorderStreaming from "./RecorderStreaming.svelte";

const ELEMENT_ID = "recorder-container";

export class RecorderWidget {
  private component: any = null;

  async toggle() {
    if (!document.getElementById(ELEMENT_ID)) {
      this.createContainer();
    }
    if (this.component) {
      await unmount(this.component);
      this.component = null;
      const container = document.getElementById(ELEMENT_ID)!;
      container.remove();
    } else {
      const workspaceRoot = document.querySelector(".workspace")!;
      const container = document.createElement("div");
      container.id = ELEMENT_ID;
      workspaceRoot.appendChild(container);
      this.component = mount(RecorderStreaming, {
        target: document.getElementById(ELEMENT_ID)!,
        props: {},
      });
    }
  }

  createContainer() {}
}
