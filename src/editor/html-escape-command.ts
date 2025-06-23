import { MarkdownView, Notice, Plugin } from "obsidian";

export class HtmlEscapeCommand {
  static register(plugin: Plugin) {
    plugin.addCommand({
      id: "escape-html",
      name: "Escape HTML",
      editorCallback: (editor) => {
        const content = editor.getValue();
        const escapedContent = HtmlEscapeCommand.escapeHtml(content);

        if (content === escapedContent) {
          new Notice("No HTML tags found to escape");
          return;
        }

        editor.setValue(escapedContent);
        new Notice("HTML tags escaped successfully");
      },
    });
  }

  private static escapeHtml(text: string): string {
    // Match HTML tags that are not already wrapped in backticks
    return text.replace(/(?<!`)<[^>]*>(?!`)/g, (match) => `\`${match}\``);
  }
}
