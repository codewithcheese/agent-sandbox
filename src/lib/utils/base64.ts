export function encodeBase64(data: string): string;
export function encodeBase64(data: ArrayBuffer | Uint8Array): string;

export function encodeBase64(data: string | ArrayBuffer | Uint8Array): string {
  const CHUNK = 0x8000; // 32 768 bytes per slice
  if (typeof data === "string") {
    if (typeof Buffer !== "undefined" && typeof Buffer.from === "function") {
      return Buffer.from(data, "utf-8").toString("base64");
    }

    const utf8Bytes = new TextEncoder().encode(data);
    let binary = "";
    for (let i = 0; i < utf8Bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...utf8Bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }

  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (typeof Buffer !== "undefined" && typeof Buffer.from === "function") {
    return Buffer.from(bytes).toString("base64");
  }

  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function decodeBase64(b64: string): ArrayBuffer {
  if (typeof Buffer !== "undefined" && typeof Buffer.from === "function") {
    return new Uint8Array(Buffer.from(b64, "base64")).buffer;
  }

  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
