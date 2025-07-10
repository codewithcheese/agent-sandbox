// Shared types for both AgentRunner and ClaudeCodeRunner

export interface RunOptions {
  signal?: AbortSignal;
  callbacks?: RunCallbacks;
  retryConfig?: {
    maxAttempts?: number;
    retryDelay?: number;
  };
  excludeTools?: string[];
}

export interface RunCallbacks {
  onStepFinish?: (step: any) => Promise<void>;
  onRetry?: (attempt: number, maxAttempts: number, delay: number) => void;
}