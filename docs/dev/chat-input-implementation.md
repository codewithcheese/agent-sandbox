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

## Backlink Modal Integration

The chat input includes intelligent backlink handling triggered by typing `[[`:

### Detection and Triggering
- **Trigger Detection** (`src/lib/utils/backlinks.ts:detectBacklinkTrigger`) - Detects when user types `[[` in the textarea
- **Event Handling** (`src/chat/ChatInput.svelte:177-185`) - Input event handler that checks cursor position and triggers modal
- **Modal Opening** (`src/chat/ChatInput.svelte:187-193`) - Opens fuzzy search modal for file selection

### Modal Components
- **BacklinkFileSelectModal** (`src/lib/modals/backlink-file-select-modal.ts`) - Extends Obsidian's FuzzySuggestModal
- **File Resolution** - Returns basename if unique in vault, otherwise full path to avoid ambiguity
- **Fuzzy Search** - Built-in Obsidian functionality for finding files by name/path

### Completion and Expansion
- **Backlink Insertion** (`src/lib/utils/backlinks.ts:insertBacklink`) - Replaces `[[` with complete `[[filename]]` syntax
- **Cursor Management** - Automatically positions cursor after inserted backlink
- **Pre-submission Expansion** (`src/lib/utils/backlinks.ts:expandBacklinks`) - Transforms backlinks to pipe format for model context

### Processing Pipeline
1. User types `[[` → triggers detection
2. Modal opens with file search
3. User selects file → inserts `[[basename]]` or `[[path]]`
4. On submit → expands to `[[full/path|basename]]` for AI model context
5. Model receives full path information while user sees clean basename

This provides seamless Obsidian-style backlink creation with intelligent path resolution and context expansion for the AI model.

## Real-time Integration

The component includes infrastructure for real-time transcription (currently disabled) and handles streaming chat responses with proper cancellation support.
