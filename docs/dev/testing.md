# Testing

## Overview

This project uses Vitest for unit and integration testing with two distinct test environments:

- **JSdom environment**: For standard unit/integration tests
- **Browser environment**: For tests requiring real browser functionality (Pyodide, PGlite, etc.)

## Test Configuration

### Vite Configuration

Tests are configured in `vite.config.ts` using Vitest's workspace feature:

- **Setup file**: `tests/setup.ts` - Loads Obsidian mocks and configures global test environment
- **Workspace projects**: Two separate test projects for different environments
- **Test patterns**: Uses `.test.ts` and `.spec.ts` extensions, with `.browser.test.ts` for browser-specific tests

### Test Scripts

Available npm scripts:

- `npm test` - Run all tests
- `npm run test:browser` - Run browser-specific tests only  
- `npm run test:jsdom` - Run JSdom tests only

## Test Environments

### JSdom Tests (Default)

Standard unit tests run in JSdom environment with mocked dependencies:

- **Pattern**: `**/*.{test,spec}.{js,ts,jsx,tsx}` (excluding `.browser.test.ts`)
- **Environment**: JSdom with Node.js APIs
- **Mocks**: Obsidian API, file system operations via `@zenfs/core`

### Browser Tests

Tests requiring real browser APIs run in Playwright:

- **Pattern**: `**/*.browser.{test,spec}.{js,ts,jsx,tsx}`
- **Environment**: Real Chromium browser via Playwright
- **Use cases**: Pyodide Python execution, PGlite database operations, WebAssembly modules

## Test Structure

### Directory Layout

```
tests/
├── ai/                     # AI provider tests with HTTP recording
├── mocks/                  # Mock implementations
│   ├── obsidian.ts        # Complete Obsidian API mock
│   ├── normalize-path.ts  # Path normalization utilities
│   └── ai-sdk.ts          # AI SDK mocks
├── pyodide/               # Python execution tests (browser)
├── tools/                 # Tool implementation tests
│   ├── files/            # File operation tools
│   └── todo/             # Todo management tools
├── vault-overlay/         # Vault overlay system tests
├── setup.ts              # Global test setup
└── use-recording.ts      # HTTP recording utilities
```

### Mock System

#### Obsidian Mock (`tests/mocks/obsidian.ts`)

Comprehensive mock of Obsidian APIs using `@zenfs/core` for file system operations:

- **File operations**: Create, read, modify, delete files and folders
- **Vault interface**: Complete vault API implementation
- **Metadata cache**: Mock metadata and frontmatter parsing
- **Memory filesystem**: In-memory file system for test isolation

#### HTTP Recording (`tests/use-recording.ts`)

Uses Polly.js for recording and replaying HTTP requests:

- **Recording mode**: Records missing requests, replays existing ones
- **Security**: Automatically strips API keys and authorization headers
- **Storage**: Saves recordings in `__recordings__/` directories next to test files

## Writing Tests

### JSdom Tests

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { vault, helpers } from "../mocks/obsidian";

describe("MyFeature", () => {
  beforeEach(() => {
    helpers.reset(); // Clear mock file system
  });

  it("should work with files", async () => {
    const file = helpers.addFile("/test.md", "content");
    const content = await vault.read(file);
    expect(content).toBe("content");
  });
});
```

### Browser Tests

```typescript
import { describe, it, expect, beforeAll } from "vitest";

describe.skip("Browser Feature", () => {
  beforeAll(() => {
    // Set up browser-specific globals
    (window as any).MODULE_URL = `${location.origin}/node_modules/module/`;
  });

  it("should work in browser", async () => {
    // Browser-specific test logic
  });
});
```

### HTTP Recording Tests

```typescript
import { describe, it, expect } from "vitest";
import { useRecording } from "../use-recording";

describe("API Tests", () => {
  useRecording(); // Enables HTTP recording/replay

  it("should call external API", async () => {
    // HTTP requests will be recorded/replayed
  });
});
```

## Test Patterns

### File Operations

Tests for file tools use the vault overlay system (`src/chat/vault-overlay.svelte.ts`) which provides:

- **Staging area**: File modifications without affecting real vault
- **Change tracking**: Track creates, modifications, deletes, and renames
- **Path validation**: Ensure paths stay within vault boundaries

### Tool Testing

Tool tests follow a standard pattern:

```typescript
const toolExecOptions: ToolExecutionOptionsWithContext = {
  toolCallId: "test-call-id",
  messages: [],
  getContext: () => ({
    vault: mockVault,
    sessionStore: {},
    config: {}
  }),
  abortSignal: new AbortController().signal
};

const result = await toolExecute(params, toolExecOptions);
```

### Browser Module Loading

Browser tests that require external modules set up CDN URLs:

```typescript
beforeAll(() => {
  (window as any).PYODIDE_BASE_URL = `${location.origin}/node_modules/pyodide/`;
  (window as any).PGLITE_URL = `${location.origin}/node_modules/@electric-sql/pglite/dist/index.js`;
});
```

## Running Tests

### Development

```bash
# Run all tests
npm test

# Run specific environment
npm run test:jsdom
npm run test:browser

# Run with watch mode
npx vitest

# Run specific test file
npx vitest tests/tools/files/read.test.ts
```

### CI/CD

Browser tests run in headless mode when `CI=true` environment variable is set.

## Best Practices

- Use `helpers.reset()` in `beforeEach` to ensure test isolation
- Mock external dependencies at the module level in `tests/setup.ts`
- Use `.browser.test.ts` suffix only when real browser APIs are required
- Strip sensitive data from HTTP recordings using Polly.js configuration
- Validate both success and error cases for tool implementations
- Test file operations with various edge cases (empty files, large files, special characters)

## Common Issues

- **Timeout errors**: Increase timeout for browser tests loading large modules (Pyodide, PGlite)
- **Mock conflicts**: Ensure mocks are properly isolated between test files
- **Path issues**: Use `normalizePath` for consistent path handling across platforms
- **Memory leaks**: Always call cleanup methods (`destroy()`, `terminate()`) in `afterAll`