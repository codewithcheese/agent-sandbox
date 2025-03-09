import {Component, mount} from "svelte";
import {slug} from "github-slugger";

declare global {
    interface Window {
        __DEV__: { serverUrl: string } | false;
    }
}

export function mountComponent(container: Element, component: Component, mountType: 'component' | 'element') {
    const tag = `svelte-${slug(component.name)}`

    const div = document.createElement("div");
    div.setAttribute('id', tag)
    div.style.height = "100%";
    container.appendChild(div);

    if (window.__DEV__) {
        // dev: Use vite dev server with HMR
        const script = document.createElement("script");
        script.setAttribute("type", "module");
        script.setAttribute(
            "src",
            `${window.__DEV__.serverUrl}src/main.ts?t=${Date.now()}&componentName=${component.name}&mountType=${mountType}&tag=${tag}`,
        );
        container.appendChild(script);
        return
    }

    if (mountType === 'component') {
        mount(component, { target: div });
    } else {
        if (!customElements.get(tag)) {
            //@ts-expect-error
            customElements.define(tag, component.element);
        }
        div.innerHTML = `<${tag}></${tag}>`;
    }
}
