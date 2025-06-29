import type {
  FilePart,
  FileUIPart,
  TextUIPart,
  UIMessage,
  UIMessagePart,
} from "ai";
import { extractDataFromDataUrl } from "$lib/utils/data-url.ts";
import { createDebug } from "$lib/debug.ts";
import {
  defaultConfig,
  formatWithLineNumbers,
} from "../../tools/files/read.ts";

const debug = createDebug();

function filePartIsText(part: UIMessagePart<any, any>): part is FileUIPart {
  return part.type === "file" && part.mediaType.startsWith("text/");
}

/**
 * AI SDK inlines text attachments into the content without wrapping them into tags with metadata,
 * as a result models do not differentiate them as documents with a name.
 */
export function wrapTextAttachments(messages: UIMessage[]): UIMessage[] {
  debug("Wrapping text attachments");
  return messages.map((message) => {
    const textFileParts = message.parts?.filter(filePartIsText) ?? [];
    // update content with tagged text attachments
    message.parts = [
      ...textFileParts.map((part) => {
        const file = extractDataFromDataUrl(part.url);
        const lines = file.data.split("\n");
        const formatted = formatWithLineNumbers(
          lines,
          part.filename,
          1,
          defaultConfig.DEFAULT_LINE_LIMIT,
          defaultConfig.MAX_LINE_LENGTH,
          defaultConfig.MAX_TEXT_FILE_SIZE,
        );
        return {
          type: "text",
          text: `<Document type="${part.mediaType}">\n${formatted}\n</Document>`,
        } satisfies TextUIPart;
      }),
      ...message.parts,
    ];
    // remove text attachment
    message.parts = message.parts?.filter((a) => !filePartIsText(a)) ?? [];
    return message;
  });
}
