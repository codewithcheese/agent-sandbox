# Modal Implementation

## Architecture

The modal system uses two patterns:
- **Component Modals**: Factory function bridges Svelte components with Obsidian modals
- **Native Modals**: Direct Obsidian Modal subclasses for simple dialogs

## Component Modal Factory

The `createModal()` function creates anonymous Modal subclasses that handle component mounting and cleanup automatically.

```typescript
export function createModal(component: any, props: any) {
  const plugin = usePlugin();
  return new (class extends Modal {
    private component?: any;
    onOpen() {
      this.component = mount(component, {
        target: this.contentEl,
        props,
      });
    }
    async onClose() {
      if (this.component) {
        await unmount(this.component);
      }
      this.contentEl.empty();
    }
  })(plugin.app);
}
```

## Dynamic Form Generation

`AccountModal` (`src/settings/AccountModal.svelte`) and `ModelModal` (`src/settings/ModelModal.svelte`) generate form fields based on configuration objects, allowing adaptation to different providers and model types without hardcoded forms.

### Provider-Based Fields
`AccountModal` (`src/settings/AccountModal.svelte`) reads field definitions from provider configurations to generate appropriate input controls for API keys, endpoints, and other provider-specific settings.

### Type-Adaptive Forms
`ModelModal` (`src/settings/ModelModal.svelte`) switches form layout based on model type selection:
- Chat models require token limits
- Embedding models need dimension settings
- Transcription models have minimal configuration

## File Selection Pattern

`FileSelectModal` (`src/lib/modals/file-select-modal.ts`) extends Obsidian's `FuzzySuggestModal` to provide vault-aware file selection with search capabilities.

## Memory Management

The factory pattern handles component lifecycle automatically - mounting on open and unmounting on close prevents memory leaks without manual cleanup.
