import { Component, mount } from "svelte";
import { slug } from "github-slugger";
import { nanoid } from "nanoid";

declare global {
  interface Window {
    __DEV__: { serverUrl: string } | false;
    Mounts: Record<string, any>;
  }
}

export function mountComponent(
  container: Element,
  component: Component,
  mountType: "component" | "element",
  props: Record<string, any> = {},
) {
  const div = document.createElement("div");
  div.style.height = "100%";
  container.appendChild(div);

  const mountId = nanoid();
  window.Mounts = window.Mounts || {};
  window.Mounts[mountId] = (components: Record<string, Component>) => {
    const ref = components[component.name];
    if (mountType === "component") {
      mount(ref, { target: div, props });
    } else {
      const tag = `svelte-${slug(ref.name)}`;
      if (!customElements.get(tag)) {
        //@ts-expect-error
        customElements.define(tag, ref.element);
      }
      div.innerHTML = `<${tag}${Object.entries(props)
        .map(([k, v]) => ` ${k}="${v}"`)
        .join("")}></${tag}>`;
    }
  };

  if (window.__DEV__) {
    // dev: Use vite dev server with HMR
    const script = document.createElement("script");
    script.setAttribute("type", "module");
    script.setAttribute(
      "src",
      `${window.__DEV__.serverUrl}src/main.ts?t=${Date.now()}&mountId=${mountId}`,
    );
    container.appendChild(script);
    return;
  }

  window.Mounts[mountId]({ [component.name]: component });
}
