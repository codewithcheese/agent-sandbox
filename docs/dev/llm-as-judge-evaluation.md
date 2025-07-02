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

Test set files are markdown documents containing tables of examples to evaluate. They track evaluation history and results across different judge versions.

**Example Test Set (`test-sets/internal-notes-style.md`):**

```markdown
---
judge_path: "/judges/internal-notes-judge.md"
---

## Current Results (Judge v3)
| Expected | Judge | Example | Reasoning |
|----------|-------|---------|-----------|
| ✅ | ✅ | Need to explore three approaches for user onboarding: progressive disclosure vs full tutorial vs contextual hints. | Clear identification of concrete next steps and decision points. |
| ❌ | ❌ | User onboarding represents a critical touchpoint in the customer journey where organizations must balance comprehensive guidance with cognitive load management. | Uses abstract business language rather than focusing on actionable directions. |

Accuracy: 8/10 (80%)

## Judge v2 Results
| Expected | Judge | Example | Reasoning |
|----------|-------|---------|-----------|
| ✅ | ❌ | Need to explore three approaches... | Previous version was less accurate at identifying direction-focused content. |

Accuracy: 6/10 (60%)

## Examples for Evaluation
| Expected | Judge | Example | Reasoning |
|----------|-------|---------|-----------|
| ✅ | ⏳ | Current API design has two unresolved questions: authentication flow timing and error state handling. | |
| ❌ | ⏳ | The aforementioned temporal designation for the convening has been established. | |
```

**Test Set Properties:**
- `judge_path`: Path to the judge agent file
- Tables with columns: Expected (✅/❌), Judge (✅/❌/⏳), Example (text), Reasoning (judge's explanation)
- Version history showing performance across judge iterations

## Available Tools

### 1. EvaluateExample Tool

Evaluates a single text example during conversation development.

**Parameters:**
- `text`: The text content to evaluate
- `judge_agent_path`: Path to judge agent file
- `criteria_context`: Optional additional context

**Usage in Agent Chat:**
```
Can you evaluate this text using the clarity judge:

EvaluateExample:
- text: "The meeting is scheduled for 3 PM tomorrow."
- judge_agent_path: "/judges/clarity-judge.md"
```

**Returns:**
```json
{
  "result": "PASS",
  "reasoning": "The text is clear and direct, stating the meeting time without unnecessary complexity.",
  "judge_version": 1,
  "judge_model": "claude-3-5-sonnet-20241022",
  "judge_account": "Anthropic"
}
```

### 2. EvaluateTestSet Tool

Evaluates all examples in a test set file and updates the file with results.

**Parameters:**
- `test_set_path`: Path to test set markdown file
- `judge_agent_path`: Path to judge agent file

**Usage in Agent Chat:**
```
EvaluateTestSet:
- test_set_path: "/test-sets/internal-notes-style.md"
- judge_agent_path: "/judges/internal-notes-judge.md"
```

**Returns:**
```json
{
  "tests_run": 10,
  "successes": 8,
  "failures": 2,
  "accuracy_percentage": 80,
  "judge_version": 3
}
```

### 3. Run Test Set Command

Obsidian command that runs test set evaluation from the Command Palette.

**Usage:**
1. Open a test set file (must have `judge_path` in frontmatter)
2. Run command: "Run Test Set Evaluation"
3. View progress and results in notices

## Workflow Integration

### Phase 1: Exploration and Development

During instruction development, use the evaluation system to build understanding:

1. **Create examples** as you iterate with the agent
2. **Use EvaluateExample** for quick feedback during conversation
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
- **Tool Implementations** (`evaluate-example.ts`, `evaluate-test-set.ts`): Tool wrappers for agent interaction
- **Command Integration** (`test-set-command.ts`): Obsidian command for UI interaction

### Error Handling

The system includes comprehensive error handling for:
- Missing or invalid judge agent files
- Malformed test set files
- Model configuration issues
- Network/API failures
- Abort signal support for long-running operations

### Response Parsing

- **Primary**: JSON parsing with structured schema
- **Fallback**: Fuzzy text parsing for PASS/FAIL detection
- **Flexible**: Handles variations in capitalization and phrasing

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
