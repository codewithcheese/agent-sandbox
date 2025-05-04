export function getBaseName(path: string): string {
  const filename = path.split("/").pop() || path;
  return filename.includes(".")
    ? filename.substring(0, filename.lastIndexOf("."))
    : filename;
}

export function getLastDirName(path: string): string {
  if (!path || !path.includes("/")) throw new Error("Path must include a /");
  const parts = path.split("/");
  parts.pop();
  return parts.pop();
}
