export class ChatInputState {
  state = $state<{ type: "new" } | { type: "editing"; index: number }>({
    type: "new",
  });
  text = $state<string>();
  attachments = $state<string[]>([]);

  startEditing(index: number, content: string, attachments: string[]) {
    this.state = { type: "editing", index };
    this.text = content;
    this.attachments = attachments;
  }

  reset() {
    this.state = { type: "new" };
    this.text = "";
    this.attachments = [];
  }
}
