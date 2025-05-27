---
trigger: manual
---

# Agent Sandbox Project Analysis

## Overview

Agent Sandbox is an Obsidian plugin designed as a development environment for building and testing "knowledge agents" - automated tools that can process, analyze, and interact with your notes to provide intelligent features like answering questions, summarizing content, and automating workflows.

## Core Architecture

### Main Plugin Structure

- **Entry Point**: `AgentSandboxPlugin` class extends Obsidian's Plugin base class
- **Technology Stack**: TypeScript/Svelte 5 frontend with Vite build system
- **AI Integration**: Uses AI SDK with support for multiple providers (OpenAI, Anthropic, Google)
- **Database**: PGlite for local persistence
- **Styling**: Tailwind CSS with custom components

## Key Components

### 1. Chat System (`/src/chat/`)

- **Core Chat Class**: Manages conversation state, AI model interactions, and message flow
- **UI Components**: Svelte components for chat interface, input handling, and message display
- **AI Integration**: Supports streaming responses, tool calling, and multiple AI providers
- **File Attachments**: Can attach Obsidian files as context for conversations
- **Serialization**: Custom chat file format with superjson for persistence

### 2. Vault Overlay System (`/src/chat/vault-overlay.svelte.ts`)

- **CRDT-based Transaction Layer**: Uses Loro CRDT for collaborative editing
- **Safe File Operations**: Provides a staging layer before committing changes to disk
- **Master/Staging Architecture**:
  - Master doc: Accepted state mirrored from disk
  - Staging doc: Working copy for edits before approval
- **Obsidian Integration**: Swaps in for normal Vault API to intercept file operations

### 3. Tool System (`/src/tools/`)

- **Extensible Framework**: Supports built-in, imported, and code-based tools
- **Tool Types**:
  - Built-in tools (text editor, file operations)
  - Import tools (from external modules)
  - Code tools (custom JavaScript/Python execution)
- **Dynamic Loading**: Tools can be defined in markdown files with frontmatter schemas
- **Execution Environment**: Supports Python execution via Pyodide

### 4. Settings & Configuration (`/src/settings/`)

- **AI Provider Management**: Configure accounts for different AI services
- **Model Selection**: Support for chat and embedding models
- **Plugin Settings**: Vault paths, behavior configuration
- **Modal Interfaces**: Svelte-based configuration dialogs

### 5. Shared Libraries (`/src/lib/`)

- **Components**: Reusable UI components built with Svelte 5
- **Utilities**: Helper functions for Obsidian integration, file handling, etc.
- **Artifacts**: System for displaying and managing generated content
- **Modals**: File selection, merge operations, and other dialog interfaces

## Key Functionality

### 1. Knowledge Agent Development

- Create custom agents with specific prompts and tool access
- Test agent behavior in a sandboxed environment
- Iterate on agent design with immediate feedback

### 2. AI-Powered Chat Interface

- Natural language conversations with AI models
- Context-aware responses using attached files
- Tool calling for dynamic functionality
- Streaming responses for real-time interaction

### 3. Safe File Operations

- Vault overlay prevents accidental file corruption
- Preview changes before applying to actual vault
- CRDT-based collaboration support
- Atomic operations with rollback capability

### 4. Extensible Tool System

- Built-in tools for common operations
- Custom tool development via markdown files
- Python code execution for advanced functionality
- Integration with external APIs and services

### 5. Cross-Platform Support

- Desktop and mobile Obsidian support
- Responsive UI design
- Platform-specific optimizations

## Development Workflow

### Installation & Setup

- Installable via BRAT (Beta Reviewer's Auto-update Tool)
- Uses pnpm for package management
- Vite-based development server with hot reloading

### Testing

- Comprehensive test suite using Vitest
- Browser and jsdom test environments
- Coverage reporting with v8

### Build & Release

- Automated GitHub workflows for CI/CD
- Version bumping and release automation
- Zip file generation for distribution

## Technical Highlights

### Modern Frontend Architecture

- Svelte 5 with runes for reactive state management
- TypeScript for type safety
- Component-based architecture with reusable UI elements

### AI Integration

- Provider-agnostic AI SDK integration
- Support for streaming, function calling, and multi-modal inputs
- Rate limiting and error handling

### Data Persistence

- PGlite for local SQL database
- Custom serialization for chat data
- CRDT-based collaborative editing

### Obsidian Integration

- Deep integration with Obsidian's API
- Custom view types and workspace management
- File system abstraction with overlay support

## Conclusion

This project represents a sophisticated platform for developing AI-powered knowledge agents within the Obsidian ecosystem, providing both the infrastructure and tools needed to create intelligent note-processing applications.