# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Agent Sandbox is an Obsidian plugin for building and testing "knowledge agents" - AI-powered tools that can process, analyze, and interact with notes. The plugin provides a chat interface with AI models, tool execution capabilities, and vault interaction features.

## Development Commands

**Package Manager**: This project uses `pnpm` as the package manager.

```bash
# Install dependencies
pnpm install

# Development server (hot reload)
pnpm dev

# Build for production
pnpm build

# Run all tests
pnpm test

# Run browser tests only
pnpm test:browser

# Run jsdom tests only  
pnpm test:jsdom

# Type checking
pnpm typecheck
```

## Architecture Overview

### Core Structure
- **Plugin Entry**: `src/plugin.ts` - Main plugin class extending Obsidian's Plugin
- **Bridge System**: `src/bridge/` - Compatibility layer for different environments (dev, test, production)
- **Chat System**: `src/chat/` - Core chat interface and AI model integration
- **Tools System**: `src/tools/` - Tool execution framework for AI agents
- **Settings**: `src/settings/` - Plugin configuration and AI provider management

### Key Components

**Chat Views**: The plugin registers custom Obsidian views for chat interfaces:
- `ChatView` - Main chat interface (`.chat` files)
- `ChatHistoryView` - Chat history management
- `ArtifactView` - Code/content artifacts from AI responses
- `MergeView` - File diff/merge operations

**Tool Architecture**: Tools are defined as markdown files in `src/tools/` and the vault's tools directory. Tools can be:
- Built-in tools (like text editor)
- Vault-defined tools (markdown files with schemas)
- Code-based tools (JavaScript implementations)

**Bridge Pattern**: The `src/bridge/` directory provides environment-specific implementations for:
- Development (via dev-proxy.js)
- Testing (mocked dependencies)
- Production (direct Obsidian API)

### File Extensions
- `.chat` files - Chat conversations (JSON-serialized)
- `.md` files in tools directories - Tool definitions with JSON schemas

### Development Setup
The build process uses Vite with special handling for:
- Obsidian plugin format (CommonJS output)
- Svelte compilation with custom elements
- Bridge system for different environments
- Manifest and CSS copying to dist/

### Testing Strategy
- **Browser tests**: Files ending in `.browser.test.ts` - Run in actual browser with Playwright
- **jsdom tests**: Standard `.test.ts` files - Run in jsdom environment
- **Workspace configuration**: Multiple test projects defined in vite.config.ts

### Database Integration
PGlite (PostgreSQL in WebAssembly) is available with pg_vector initialized for future embedding-based RAG support, but is not currently used in the application. Provider initialized in `src/pglite/provider.ts`.

## Key Development Notes

- The plugin supports hot reloading in development via the dev-proxy system
- All external dependencies that conflict with Obsidian are bridged through `src/bridge/`
- Tool schemas are validated using AJV and rendered with a custom schema editor
- Chat data is serialized using superjson for complex object handling
- The plugin supports both desktop and mobile Obsidian installations