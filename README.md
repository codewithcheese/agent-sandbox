# Agent Sandbox

Sandbox for developing knowledge agents in Obsidian.

## Development

This project uses pnpm as the package manager.

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Build the project
pnpm build

# Run tests
pnpm test:unit
```

## GitHub Workflows

This project includes two GitHub workflows:

1. **CI Workflow**: Runs on every push to the main branch and on pull requests. It builds the project and runs tests to ensure everything is working correctly.

2. **Release Workflow**: Triggered when a new tag with the format `v*` (e.g., `v1.0.0`) is pushed. It builds the project, creates a zip file with the necessary files, and publishes a GitHub release with the zip file attached.

### Creating a Release

This project includes a version bumping script that automates the release process. To create a new release:

1. Use the standard version command to create a new release:
   ```bash
   # Choose one based on the type of change:
   pnpm version patch  # For bug fixes (0.1.0 -> 0.1.1)
   pnpm version minor  # For new features (0.1.0 -> 0.2.0)
   pnpm version major  # For breaking changes (0.1.0 -> 1.0.0)
   ```

   This will automatically:
   - Update the version in `package.json`
   - Update the version in `manifest.json`
   - Update `versions.json` with the new version
   - Commit all changes
   - Create a git tag for the new version
   - Push the changes and tag to GitHub

   The GitHub release workflow will then automatically create a release with the built plugin.

## Todo

- [x] Fix 429 handling
- [x] Show loading indicator
- [x] Markdown message rendering
- [ ] Allow selection in message content
- [ ] Remove front matter from system
- [x] Fix reasoning details handling
- [x] Display error responses
- [ ] Refresh chatbot list when chatbots path modified
- [ ] Token counting
- [ ] Context optimization (forget old messages)
- [ ] Display tokens used in tool call
- [ ] Pass abort signal to tools
