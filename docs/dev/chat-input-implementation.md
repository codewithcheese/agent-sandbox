# Chat Input Implementation

## Architecture

The chat input uses a three-component architecture:

- **`ChatInput.svelte`** (`src/chat/ChatInput.svelte`) - Main container orchestrating the chat input experience
- **`Textarea.svelte`** (`src/chat/Textarea.svelte`) - Auto-growing text area using CSS Grid pseudo-element technique
- **`ChatInputState`** (`src/chat/chat-input-state.svelte.ts`) - State management for dual mode operation (new vs editing messages)

## Auto-Growing Mechanism

The textarea auto-sizing works by mirroring content to an invisible pseudo-element that calculates the required height. This avoids JavaScript height calculations and provides smooth resizing.

## Dual Mode Operation

The input operates in two modes managed by `ChatInputState` (`src/chat/chat-input-state.svelte.ts`):
- **New Mode**: Standard message composition
- **Edit Mode**: Modifying existing messages with different UI and submission behavior

Mode switching triggers focus management and UI updates automatically.

## File Attachment System

File attachments are managed through the plugin's file selection modal, which integrates with Obsidian's vault API for file access and path normalization.

## Real-time Integration

The component includes infrastructure for real-time transcription (currently disabled) and handles streaming chat responses with proper cancellation support.
