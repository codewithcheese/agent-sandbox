import {mount} from "svelte";

export function mountComponent (container: Element, url: string, tag: string,  component: any) {
    // create div for component to mount in
    const div = document.createElement("div");
    div.setAttribute('id', tag)
    div.style.height = "100%";
    container.appendChild(div);

    if (process.env.NODE_ENV === "development") {
        // dev: Use vite dev server with HMR
        const script = document.createElement("script");
        script.setAttribute("type", "module");
        script.setAttribute(
            "src",
            `${url}?t=` + Date.now(),
        );
        container.appendChild(script);
    } else {
        // prod: Mount component
        mount(component, { target: div });
    }
}

export function mountCustomElement(container: Element, url: string, tag: string, component: any) {
    // create div for component to mount in
    const div = document.createElement("div");
    div.setAttribute('id', tag)
    div.style.height = "100%";
    container.appendChild(div);

    if (process.env.NODE_ENV === "development") {
        // dev: Use vite dev server with HMR
        const script = document.createElement("script");
        script.setAttribute("type", "module");
        script.setAttribute(
            "src",
            `${url}?t=` + Date.now(),
        );
        container.appendChild(script);
    } else {
        // prod: Mount registered custom element
        if (!customElements.get(tag)) {
            customElements.define(tag, component.element);
        }
        container.innerHTML = `<${tag}></${tag}>`;
    }
}
