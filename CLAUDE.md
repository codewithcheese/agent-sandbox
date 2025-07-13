# CLAUDE.md

## Tools

- Do not use Task unless asked to do so.

## Docs

### Dev docs

Reference the `docs/dev/` directory for developer documentation.

Document only what cannot be easily inferred from the codebase.

The following can be easily inferred from the codebase, and does not need to be documented:
- Trivial tech stack details (Svelte 5 component, Tailwind CSS utility etc.) 
- Listing event handlers
- Listing CSS classes

Include examples when documenting specific patterns.

Always include a path reference when mentioning a symbol.

### Markdown formatting

- Do not use numbered lists in markdown files.

### Writing style

- Do not use evaluative, subjective, and promotional language
  - e.g. "sophisticated architecture", "advanced implementation", "state of the art"


## File naming

- Avoid redundant filename parts (e.g., "utils/backlinks.ts" instead of "utils/backlink-utils.ts")

## Typechecking

Run `pnpm run sveltecheck` to check for type errors before announcing a task as completed.
