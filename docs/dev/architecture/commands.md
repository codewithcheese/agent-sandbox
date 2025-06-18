# Command Implementation Guide

This document explains how commands are implemented in the Agent Sandbox Obsidian plugin.

## Overview

All commands use a class with a static register method. Commands and other register type functionality are grouped semantically in these classes.

## Command Registration Pattern

Components encapsulate their command registration in a static `register()` method.

**Example**: `src/editor/prompt-command.ts:34-55`

```typescript
export class PromptCommand {
  static register(plugin: Plugin) {
    plugin.addCommand({
      id: "prompt",
      name: "Insert as prompt",
      editorCallback: async () => {
        const editorView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if (!editorView) {
          return new Notice("No active markdown view");
        }

        const leaf = getActiveSidebarLeaf(plugin.app, "right");
        let view: ChatView;
        if (leaf?.getViewState().type === CHAT_VIEW_TYPE) {
          view = leaf.view as ChatView;
        } else {
          view = await ChatView.newChat();
        }
        view.chat.messages.push(await loadPromptMessage(editorView.file));
      },
    });
  }
}
```

**Registration**: Called during plugin initialization (`src/plugin.ts:76`)
```typescript
PromptCommand.register(this);
```

## Registration Types

### Command Registration

Commands use `plugin.addCommand()` within the static register method.

**Example**: Prompt Command
- Uses `editorCallback` for editor-specific commands
- Uses `callback` for general commands

### Event-Based Registration

For UI interactions like context menus, use event listeners within the static register method.

**Example**: `src/editor/context-menu.ts:10-34`

```typescript
export class ContextMenu {
  static register(plugin: AgentSandboxPlugin) {
    plugin.registerEvent(
      plugin.app.workspace.on("editor-menu", (menu, editor, view) => {
        const selection = editor.getSelection();
        if (selection) {
          menu.addItem((item) => {
            item
              .setTitle("Copy to chat")
              .setIcon("message-square")
              .onClick(() => {
                let chatView = ChatView.findActiveChatView();
                if (!chatView) {
                  return new Notice("Chat not found. Open chat in sidebar.", 5000);
                }
                const spacer = chatView.inputState.text ? " " : "";
                chatView.inputState.text += spacer + selection;
              });
          });
        }
      }),
    );
  }
}
```

## Command Types

### Editor Commands

Commands that work with the active markdown editor.

- Use `editorCallback` instead of `callback`
- Automatically receive editor context
- Only enabled when markdown editor is active

### Context Menu Commands

Commands added to right-click context menus.

- Use `registerEvent()` with `editor-menu` event
- Appear conditionally based on context (e.g., text selection)

## Registration Flow

The plugin registers commands during initialization:

```typescript
// Component Registration (src/plugin.ts:72-77)
ChatView.register(this);
ChatHistoryView.register(this);
AgentView.register(this);
AgentBannerComponent.register(this);
PromptCommand.register(this);
ContextMenu.register(this);
```
