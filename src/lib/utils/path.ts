export function getBaseName(path: string): string {
  const filename = path.split("/").pop() || path;
  return filename.includes(".")
    ? filename.substring(0, filename.lastIndexOf("."))
    : filename;
}
