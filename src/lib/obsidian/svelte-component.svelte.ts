import { Component } from "obsidian";
import { mount, unmount } from "svelte";

export class SvelteComponent<
  Props extends Record<string, any> = {},
> extends Component {
  protected ref: any;
  protected props = $state<Props>({} as any);

  constructor(
    protected component: any,
    protected target: HTMLElement,
    props: Record<string, any> = {},
  ) {
    super();
    Object.assign(this.props, props);
  }

  onload() {
    super.onload();
    this.ref = mount(this.component, {
      target: this.target,
      props: this.props,
    });
  }

  async onunload() {
    if (this.ref) {
      await unmount(this.ref);
    }
    super.onunload();
  }
}
