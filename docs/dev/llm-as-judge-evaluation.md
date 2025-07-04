# LLM as Judge Evaluation System

The Thoughtforms plugin includes a comprehensive LLM as Judge evaluation system that enables objective measurement of text quality against specific criteria. This system is designed to support iterative instruction development and quality assurance workflows.

## Overview

The evaluation system uses one language model (the "judge") to evaluate outputs from another model or process against specific criteria. Instead of relying on manual assessment or traditional metrics, the judge model provides structured feedback with pass/fail decisions and reasoning.

## Key Components

### 1. Judge Agent Files

Judge agents are markdown files that contain evaluation instructions and criteria. They follow the same structure as regular agent files but are specifically designed for evaluation tasks.

**Example Judge Agent (`judges/clarity-judge.md`):**

```markdown
---
version: 1
model_id: claude-3-5-sonnet-20241022
---

Evaluate whether the provided text demonstrates clear, direct communication.

Criteria:
- Uses simple, straightforward language
- Avoids unnecessary complexity
- Communicates the main point effectively

{% if criteria_context %}
Additional evaluation context: {{ criteria_context }}
{% endif %}

Analyze the text against these criteria. Respond with valid JSON containing:
- "reasoning": your detailed analysis of the text
- "result": either "PASS" or "FAIL"
```

**Judge Agent Properties:**
- `version`: Version number (auto-incremented when modified)
- `model_id`: Optional specific model to use for evaluation (defaults to plugin default)
- Template variables: `{{ criteria_context }}`

**Note:** The text to be evaluated is now passed as a separate user message for improved caching efficiency, rather than being embedded in the judge template.

### 2. Test Set Files

Test set files are markdown documents containing Field|Value tables for each test example. They track evaluation history and results with compact results tables.

**Example Test Set (`test-sets/internal-notes-style.md`):**

```markdown
---
judge: "[[clarity-judge]]"
---

## Results (Judge v3) - 2/2 (100%)

**Evaluation Details:**
- Model: claude-3-5-sonnet-20241022
- Account: Anthropic

| Test | Expected | Judge | Reasoning |
|------|----------|-------|-----------|
| [[#clear-direction]] | ✅ | ✅ | Clear identification of concrete next steps and decision points. |
| [[#abstract-language]] | ❌ | ❌ | Uses abstract business language rather than focusing on actionable directions. |

# Test Set

### Clear Direction

| Field | Value |
|-------|-------|
| Expected | PASS |
| Input | Document onboarding approach |
| Output | Need to explore three approaches for user onboarding: progressive disclosure vs full tutorial vs contextual hints. |

### Abstract Language

| Field | Value |
|-------|-------|
| Expected | FAIL |
| Input | Document onboarding approach |
| Output | User onboarding represents a critical touchpoint in the customer journey where organizations must balance comprehensive guidance with cognitive load management. |
```

**Test Set Properties:**
- `judge`: Wiki link to the judge agent file to use for evaluation (e.g., `"[[clarity-judge]]"`)
- Results include evaluation details (model ID and account name) for traceability
- **Field|Value Format**: Each test is defined with a markdown header and a Field|Value table
- **Compact Results**: Results table shows Test (linked), Expected, Judge, and Reasoning columns
- **Test Names**: Defined by markdown headers (### Test Name) and linked in results

**Field|Value Table Format:**
- **Expected**: PASS or FAIL - what the judge should determine
- **Input**: Optional field for documenting the prompt or context that generated the output
- **Output**: The actual text content that gets evaluated by the judge (required)
- **Judge evaluates only the Output**: The Input field is purely for documentation - only the Output text is sent to the judge for evaluation

### Field|Value Format Details

The Field|Value format provides several advantages over traditional table formats:

**Structure:**
- Each test is defined by a markdown header (### Test Name)
- Followed by a simple two-column table with Field and Value columns
- Test names become anchor links in the results table

**Benefits:**
- **Token Efficiency**: Reduces token usage compared to wide multi-column tables
- **Readability**: Easier to read and write, especially for longer text content
- **Flexibility**: Can easily add new fields without restructuring existing tests
- **Maintainability**: Clear separation between test definition and results

**Example Structure:**
```markdown
### My Test Name

| Field | Value |
|-------|-------|
| Expected | PASS |
| Input | Optional context |
| Output | Text to evaluate |
```

## Available Tools

### 1. EvaluateOutput Tool

Evaluates a single text output against judge criteria.

**Parameters:**
- `text`: The text content to evaluate
- `judge_agent_path`: Absolute path to judge agent file
- `criteria_context`: Optional additional context for evaluation

**Usage in Agent Chat:**
```
EvaluateOutput:
- text: "The meeting is scheduled for 3 PM tomorrow."
- judge_agent_path: "/judges/clarity-judge.md"
- criteria_context: "Focus on directness and clarity"
```

**Returns:**
```json
{
  "result": "PASS",
  "reasoning": "Clear, direct communication with specific time and date.",
  "judge_version": 2
}
```

### 2. Prompt Tool

Generates output from a prompt file and input text using a specified model.

**Parameters:**
- `prompt_path`: Absolute path to prompt file
- `input`: Input text to process with the prompt
- `model_id`: Optional model ID (uses frontmatter or plugin default if not specified)

**Usage in Agent Chat:**
```
Prompt:
- prompt_path: "/prompts/summarize.md"
- input: "Long article text to summarize..."
- model_id: "claude-3-5-sonnet-20241022"
```

**Returns:**
```json
{
  "output": "Generated summary text..."
}
```

**Prompt File Format:**
Prompt files follow the same structure as agent files and support frontmatter for model configuration:

```markdown
---
model_id: claude-3-5-sonnet-20241022
---

Summarize the following text in 2-3 sentences, focusing on key insights and actionable points.
```

### 3. EvaluateTestSet Tool

Evaluates all examples in a test set file and updates the file with results. The test set file must have a `judge` property in its frontmatter specifying which judge to use.

**Parameters:**
- `test_set_path`: Wiki link to test set markdown file (e.g., `[[internal-notes-style]]`)
- `judge_agent_path`: Wiki link to judge agent file (e.g., `[[internal-notes-judge]]`)

**Usage in Agent Chat:**
```
EvaluateTestSet:
- test_set_path: "[[internal-notes-style]]"
- judge_agent_path: "[[internal-notes-judge]]"
```

**Returns:**
```json
{
  "tests_run": 10,
  "successes": 8,
  "failures": 2,
  "accuracy_percentage": 80,
  "judge_version": 3,
  "results": [
    {
      "expected": "PASS",
      "judge_result": "PASS",
      "reasoning": "Clear, direct communication with specific details.",
      "input": "Document meeting time",
      "output": "The meeting is scheduled for 3 PM tomorrow."
    },
    {
      "expected": "FAIL",
      "judge_result": "FAIL",
      "reasoning": "Uses unnecessarily complex language instead of being direct.",
      "input": "Announce meeting time",
      "output": "The aforementioned temporal designation for the convening has been established."
    }
  ]
}
```

## Path Handling Architecture

The system uses a clear separation between tool APIs and content references:

### Tool Parameters (Absolute Paths)
All tools require **absolute paths** as parameters for programmatic access:
```
EvaluateOutput:
- judge_agent_path: "/judges/clarity-judge.md"

Prompt:
- prompt_path: "/prompts/summarize.md"
```

### Markdown Content (Wiki Links)
Markdown files use **wiki links** for human-readable references:
```markdown
---
judge: "[[clarity-judge]]"
---
```

### Internal Resolution
The system automatically converts wiki links to absolute paths during processing:
- **Content Layer**: Humans write `[[clarity-judge]]` in markdown
- **Resolution Layer**: System resolves to `/judges/clarity-judge.md`
- **API Layer**: Tools receive absolute paths for execution

This architecture provides:
- **Human-friendly authoring** with wiki links in content
- **Reliable programmatic access** with absolute paths in tools
- **Obsidian integration** leveraging native link resolution

### 3. Run Test Set Command

Obsidian command that runs test set evaluation from the Command Palette.

**Usage:**
1. Open a test set file (must have `judge` in frontmatter)
2. Run command: "Run Test Set Evaluation"
3. View real-time progress notices showing each example evaluation (✅/❌)
4. Results are automatically written to the test set file with evaluation details

## Workflow Integration

### Phase 1: Exploration and Development

During instruction development, use the evaluation system to build understanding:

1. **Create examples** as you iterate with the agent
2. **Use EvaluateOutput** for quick feedback during conversation
3. **Build test set** by accumulating good/bad examples
4. **Develop judge criteria** based on what you're looking for

### Phase 2: Judge Calibration

Refine the judge to align with your criteria:

1. **Create initial judge** with basic criteria
2. **Run EvaluateTestSet** to see baseline performance
3. **Iterate on judge instructions** based on misaligned examples
4. **Track performance** across judge versions in test set history

### Phase 3: Instruction Validation

Use the calibrated judge to validate new instructions:

1. **Draft instruction changes**
2. **Test with EvaluateTestSet** to measure impact
3. **Compare performance** across versions
4. **Accept changes** only if evaluation improves

## Best Practices

### Judge Agent Design

- **Clear criteria**: Define specific, measurable evaluation criteria
- **Examples**: Include positive and negative examples in judge instructions
- **Context**: Use template variables for flexibility
- **Consistency**: Maintain consistent evaluation standards

### Test Set Management

- **Representative examples**: Include diverse examples that cover edge cases
- **Balanced sets**: Mix of positive and negative examples
- **Regular updates**: Add new examples as you discover edge cases
- **Version tracking**: Keep history to track judge performance over time

### Model Selection

- **Separate models**: Use different models for judge vs. main tasks if needed
- **Consistent judges**: Keep judge model consistent for comparable results
- **Performance testing**: Test different models to find best judge performance

## Technical Architecture

### Core Components

- **Evaluation Engine** (`evaluation-engine.ts`): Core logic for judge resolution, evaluation, and test set processing
- **Tool Implementations** (`evaluate-output.ts`, `evaluate-test-set.ts`, `prompt.ts`): Tool wrappers for agent interaction
- **Command Integration** (`test-set-command.ts`): Obsidian command for UI interaction

### Error Handling

The system includes comprehensive error handling for:
- Missing or invalid judge agent files
- Malformed test set files
- Model configuration issues
- Network/API failures
- Abort signal support for long-running operations

### Response Parsing

The system uses AI SDK's `generateObject` with Zod schema validation for robust, structured LLM output:

- **Schema Validation**: Enforces strict JSON structure with `EvaluationResponseSchema`
- **Type Safety**: Ensures consistent response format with TypeScript types
- **Error Handling**: Graceful fallback for malformed responses
- **Reliable**: Eliminates manual JSON parsing and repair pipelines

### Performance Optimizations

- **Caching**: Uses Anthropic's ephemeral cache control to cache judge instructions
- **Message Structure**: Separates static judge content (system) from dynamic text (user)
- **Token Efficiency**: Reduces token usage in batch evaluations through intelligent caching
- **Progress Feedback**: Real-time notices provide user feedback during long-running evaluations

## Example Workflows

### Developing Internal Notes Style

1. **Create judge** for internal notes criteria
2. **Collect examples** during agent conversations
3. **Build test set** with examples of good/bad internal notes
4. **Calibrate judge** until accuracy is acceptable (>80%)
5. **Use for instruction development** to validate changes

### Quality Assurance Pipeline

1. **Establish test sets** for different content types
2. **Run evaluations** before accepting instruction changes
3. **Track performance** over time
4. **Prevent regressions** by monitoring accuracy scores

## Integration with Thoughtforms

The evaluation system integrates seamlessly with existing Thoughtforms features:

- **Agent Files**: Judge agents use same template system
- **Tool System**: Evaluation tools follow standard patterns
- **Overlay System**: File changes go through approval process
- **Settings**: Uses existing model and account configuration
- **Commands**: Follows singleton class pattern for registration

This creates a complete quality assurance pipeline for instruction development while maintaining consistency with the existing plugin architecture.
