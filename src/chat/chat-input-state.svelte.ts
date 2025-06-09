export class ChatInputState {
  text = $state<string>();

  reset() {
    this.text = "";
  }
}
