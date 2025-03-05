export function extensionToMimeType(extension: string): string {
  const mimeTypes: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    txt: "text/plain",
    md: "text/markdown",
  };

  return mimeTypes[extension.toLowerCase()] || "application/octet-stream";
}
