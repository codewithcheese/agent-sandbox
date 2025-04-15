<script lang="ts">
  import { Chat } from "./chat.svelte.ts";
  import ChatPage from "./ChatPage.svelte";
  import { onDestroy, onMount, setContext } from "svelte";
  import { VIEW_CTX, type ViewContext } from "$lib/obsidian/view.ts";
  import { ChatSerializer } from "./chat-serializer.ts";

  type Props = {
    data: string | null;
    onSave: (data: string) => void;
    view: ViewContext;
  };

  const { data, onSave, view }: Props = $props();

  const chat = new Chat(ChatSerializer.parse(data), () => {
    onSave(ChatSerializer.stringify(chat));
  });

  setContext(VIEW_CTX, view);

  onMount(() => {
    console.log("onMount");
  });

  onDestroy(() => {
    console.log("onDestroy");
  });
</script>

<ChatPage {chat} />
