import type { Attachment, UIMessage } from "ai";
import { extractDataFromDataUrl } from "$lib/utils/data-url.ts";
import type { TextUIPart } from "@ai-sdk/ui-utils";
import { createDebug } from "$lib/debug.ts";
import {
  defaultConfig,
  formatWithLineNumbers,
} from "../../tools/files/read.ts";

const debug = createDebug();

function attachmentIsText(attachment: Attachment) {
  return attachment.contentType?.startsWith("text/");
}

/**
 * AI SDK inlines text attachments into the content without wrapping them into tags with metadata,
 * as a result models do not differentiate them as documents with a name.
 */
export function wrapTextAttachments(messages: UIMessage[]): UIMessage[] {
  debug("Wrapping text attachments");
  return messages.map((message) => {
    const textAttachments =
      message.experimental_attachments?.filter(attachmentIsText) ?? [];
    // update content with tagged text attachments
    message.parts = [
      ...textAttachments.map((a) => {
        const file = extractDataFromDataUrl(a.url);
        const lines = file.data.split("\n");
        const formatted = formatWithLineNumbers(
          lines,
          a.name,
          1,
          defaultConfig.DEFAULT_LINE_LIMIT,
          defaultConfig.MAX_LINE_LENGTH,
          defaultConfig.MAX_TEXT_FILE_SIZE,
        );
        return {
          type: "text",
          text: `<Document type="${a.contentType}">\n${formatted}\n</Document>`,
        } satisfies TextUIPart;
      }),
      ...message.parts,
    ];
    // remove text attachment
    message.experimental_attachments =
      message.experimental_attachments?.filter((a) => !attachmentIsText(a)) ??
      [];
    return message;
  });
}
