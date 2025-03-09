/// <reference types="vite/client" />
import ChatElement from "./ChatElement.svelte";
import {mount} from "svelte";
import SettingsPage from "./SettingsPage.svelte";

const COMPONENTS = {
  'ChatElement': ChatElement,
  'SettingsPage': SettingsPage
}

const url = new URL(import.meta.url)
const params = url.searchParams

const componentName = params.get('componentName')
const mountType = params.get('mountType')
const tag = params.get('tag')

if (!componentName) {
  throw new Error('componentName not set')
}

if (!mountType) {
  throw new Error('mountType not set')
}

if (!tag) {
  throw new Error('tag not set')
}

// @ts-expect-error
const component = COMPONENTS[componentName]

if (!component) {
  throw new Error(`Unknown component ${componentName}`)
}

console.log(`Mounting ${componentName} as ${mountType} to ${tag}`)

if (mountType === 'element'){
    if (!customElements.get(tag)) {
      customElements.define(tag, component.element);
    }
    document.getElementById(tag)!.innerHTML = `<${tag}></${tag}>`;
} else if (mountType === 'component') {
    mount(component, {target: document.getElementById(tag)!});
} else {
    throw new Error(`Unknown mount type ${mountType}`)
}

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    console.log("Reload accepted");
  });
}
