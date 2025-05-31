/**
 * Encode an ArrayBuffer | Uint8Array to a Base-64 string.
 * Works in browsers and Electron (renderer & main).
 */
export function encodeBase64(data: ArrayBuffer): string {
  // Fast path in Electron or any environment with Buffer
  if (typeof Buffer !== "undefined" && typeof Buffer.from === "function") {
    return Buffer.from(new Uint8Array(data)).toString("base64");
  }

  // Browser-only fallback — build the binary string in safe slices
  const bytes = new Uint8Array(data);
  const CHUNK = 0x8000; // 32 768 bytes per slice
  let binary = "";

  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Decode a Base-64 string back to binary (Uint8Array).
 * Call `.buffer` on the result if you specifically need an ArrayBuffer.
 */
export function decodeBase64(b64: string): ArrayBuffer {
  // Fast path in Electron / Buffer-enabled contexts
  if (typeof Buffer !== "undefined" && typeof Buffer.from === "function") {
    return new Uint8Array(Buffer.from(b64, "base64")).buffer;
  }

  // Browser-only fallback
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
