# Agent Class Refactoring Design Document

**Author**: Development Team  
**Date**: January 2025  
**Status**: In Design

## Overview

This document outlines the refactoring of chat conversation logic from `chat.svelte.ts` into a clean Agent/Runner architecture. The goal is to separate concerns between configuration (Agent), execution (Runner), and UI/persistence (Chat).

### Key Design Principles

1. **Agent**: Pure configuration object containing instructions, model settings, and tools
2. **Runner**: Stateless executor that orchestrates a single conversation turn (potentially multiple LLM calls)
3. **Chat**: UI layer managing persistence, system messages, and agent lifecycle
4. **Message Ownership**: Runner receives and directly mutates the messages array during streaming
5. **Minimal Abstraction**: Keep using AI SDK directly, avoid over-engineering

## Background

### Current State
- All conversation logic is embedded in @chat.svelte.ts (~960 lines)
- Tight coupling between UI state, message management, and AI SDK calls
- Difficult to test, reuse, or extend the conversation logic
- Provider-specific logic scattered throughout the codebase
- Uses Vercel AI SDK for model interactions

### Agent Framework Inspired Design
The OpenAI framework provides a clean separation:
- **Agent**: Pure configuration object (instructions, model, tools)
- **Runner**: Orchestrates entire multi-turn conversations until completion
- **RunState/RunContext**: Manages execution state and dependency injection

## Goals

1. **Extract core agent logic** into reusable Agent and Runner classes
2. **Maintain compatibility** with existing Chat UI and Obsidian integration
3. **Enable future extensibility** for multi-agent workflows, testing, and batch processing
4. **Preserve all current functionality** including streaming, error handling, and vault integration

## Non-Goals

3. **Change message format** - Continue using `UIMessage` throughout
4. **Modify AI SDK integration** - Keep existing provider abstraction

## Detailed Design

### Core Components

#### 1. Agent Class - Pure Configuration

```typescript
export interface AgentConfig {
  name: string;
  instructions: (context: AgentContext) => Promise<string>;
  model: string;
  modelSettings?: {
    temperature?: number;
    maxTokens?: number;
    maxSteps?: number;
    thinkingEnabled?: boolean;
    thinkingTokensBudget?: number;
  };
  tools: Record<string, Tool>; // Tools belong to Agent configuration
}

export interface AgentContext {
  account: AIAccount;
  vault: VaultOverlay;
  sessionStore: SessionStore;
  chatPath: string;
  options: ChatOptions;
  metadata?: Record<string, any>;
}

export class Agent {
  constructor(private config: AgentConfig);
  static async fromFile(filePath: string, context: AgentContext): Promise<Agent>;
  async getInstructions(context: AgentContext): Promise<string>;
  get tools(): Record<string, Tool> { return this.config.tools || {}; }
}
```

**Design Decisions**:
- **No message state**: Agent is pure configuration, following OpenAI pattern
- **Dynamic instructions**: Support both static strings and context-aware functions
- **File loading**: Static factory method for loading from Obsidian files, including tool loading
- **Model ownership**: Agent specifies its preferred model (can be overridden)
- **Tools as configuration**: Tools loaded during Agent creation, not runtime
- **AgentContext**: Contains Chat-specific items (vault, sessionStore) as established

#### 2. AgentRunner - Full Conversation Orchestration

```typescript
export interface RunOptions {
  signal?: AbortSignal;
  callbacks?: RunCallbacks;
}

export interface RunCallbacks {
  onStepFinish?: (step: StepMetadata) => Promise<void>;
}

export class AgentRunner {
  constructor(
    private messages: UIMessageWithMetadata[],
    private context: AgentContext
  );
  
  async run(agent: Agent, options: RunOptions): Promise<void>;
}
```

**Design Decisions**:
- **No agent ownership**: Agent passed to `run()` method, enabling future multi-agent workflows
- **Direct message mutation**: Runner updates messages array during streaming because it owns the messages reference
- **Full conversation execution**: Handles the entire response generation (potentially multiple tool calls)
- **Single-conversation pattern**: New runner instance per user interaction

**Key Responsibilities**:
1. Convert UIMessages to AI SDK ModelMessages
2. Execute streaming conversation with AI SDK (potentially multiple tool calls in a loop)
3. Apply streaming updates back to UIMessages
4. Handle retries and rate limiting
5. Provider-specific model configuration
6. Tool execution and approval flow management

**NOT Runner Responsibilities**:
- System message updates (Chat responsibility between conversations)
- Agent file reloading (Chat responsibility)
- Vault persistence (Chat responsibility)
- Multiple conversation turns (each user message creates new Runner)

#### 3. Chat Class - UI and Persistence Layer

```typescript
export class Chat {
  messages = $state<UIMessageWithMetadata[]>([]);
  state = $state<LoadingState>({ type: "idle" });
  vault = $state<VaultOverlay>();
  
  async runConversation(): Promise<void> {
    // Chat manages system message updates between conversations
    await this.applySystemMessage();
    
    const agent = await this.ensureAgent();
    const runner = new AgentRunner(this.messages, this.createContext());
    await runner.run(agent, {
       onStepFinish: async (changes) => {
         if (changes.length > 0) {
           await MergeView.openForChanges(this.path);
         }
       }
    });
  }
}
```

### Component Interactions

```
┌─────────────┐     ┌─────────────────┐     ┌───────────┐
│    Chat     │────▶│   AgentRunner   │────▶│   Agent   │
│ (UI Layer)  │     │  (Orchestrator) │     │ (Config)  │
└─────────────┘     └─────────────────┘     └───────────┘
      │                      │                      │
      │ messages[]           │ run(agent)          │ getInstructions()
      │ vault               │ streaming           │ model settings
      │ sessionStore        │ retries             │ tools config
      └─────────────────────┴──────────────────────┘
```


