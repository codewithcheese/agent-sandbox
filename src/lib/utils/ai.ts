import type { UIMessagePart } from "ai";

export function getTextFromParts(parts: UIMessagePart<any, any>[]): string {
  return parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}
