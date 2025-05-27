import type { Attachment, UIMessage } from "ai";
import { extractDataFromDataUrl } from "$lib/utils/data-url.ts";
import type { TextUIPart } from "@ai-sdk/ui-utils";

function attachmentIsText(attachment: Attachment) {
  return attachment.contentType?.startsWith("text/");
}

/**
 * AI SDK inlines text attachments into the content without wrapping them into tags with metadata,
 * as a result models do not differentiate them as documents with a name.
 */
export function wrapTextAttachments(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => {
    const textAttachments =
      message.experimental_attachments?.filter(attachmentIsText) ?? [];
    // update content with tagged text attachments
    message.parts = [
      ...textAttachments.map((a) => {
        const file = extractDataFromDataUrl(a.url);
        return {
          type: "text",
          text: `<Document path="${a.name}" type="${a.contentType}">\n${file.data}\n</Document>`,
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
