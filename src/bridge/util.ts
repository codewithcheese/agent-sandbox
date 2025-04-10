export async function bridge(name: string): Promise<unknown> {
  if (typeof window !== "undefined" && window.bridge && window.bridge[name]) {
    // Development mode - use global bridge provided by dev-proxy
    return window.bridge[name];
  } else {
    return import(/* @vite-ignore */ name);
  }
}
