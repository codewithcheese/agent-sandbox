<script lang="ts">
  type Props = {
    name: string;
    description: string;
    content: string;
    onSave: (content: string) => void;
    onCancel: () => void;
  };
  let { name, description, content, onSave, onCancel }: Props = $props();
</script>

<div class="flex flex-col gap-2">
  <div class="font-semibold">{name}</div>
  <div class="setting-item-description whitespace-pre">{description}</div>
  <textarea bind:value={content} rows="20"></textarea>
  <div class="flex gap-2">
    <div class="flex-1"></div>
    <button type="button" onclick={() => onCancel()}>Cancel</button>
    <button type="button" class="mod-cta" onclick={() => onSave(content)}
      >Save</button
    >
  </div>
</div>
