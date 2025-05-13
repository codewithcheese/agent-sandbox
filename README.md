# Agent Sandbox

Agent Sandbox is a development environment for building and testing "knowledge agents" within Obsidian. Knowledge 
agents are automated tools or bots that can process, analyze, and interact with your notes, providing intelligent 
features such as answering questions, summarizing content, or automating workflows. This sandbox enables developers 
to rapidly prototype, iterate, and refine such agents, seamlessly integrating them into the Obsidian ecosystem.


## Installation

This plugin that can be installed using the [BRAT (Beta Reviewer's Auto-update Tool)](https://github.com/TfTHacker/obsidian42-brat) plugin for Obsidian.

1. Install the BRAT plugin from Obsidian's Community Plugins.
2. Add this plugin to BRAT:
   - In BRAT settings, click "Add Beta Plugin".
   - Enter the repository URL: `https://github.com/Companioai/companio-sandbox`
   - Click "Add Plugin".
3. Enable the plugin in Obsidian's Community Plugins settings.
4. BRAT will automatically update the plugin when new releases are published.

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

- [ ] Chat: Token counting
- [ ] Tools: Tool builder agent for generating tool schemas and implementations
- [ ] Recorder: Reposition recorder with drag
- [ ] Recorder: Save recording history in local storage
- [ ] Chat: Chat homepage with previous chats and agent selection
- [ ] Chat: Add tool request for create, trash, delete
- [ ] Chat: Disconnect realtime after idle period
- [ ] Chat: Context optimization (forget old messages)
- [ ] Chat: Display tokens used in tool call
- [ ] Chat: Pass abort signal to tools
- [ ] Chat: Read file image support
- [ ] Merge: Merge view undo
- [ ] Merge: Merge view use Obsidian semantic colors
- [ ] Merge: Close merge view when complete
- [ ] Chat: Delete chat if empty when closed
- [ ] Schema editor: Align design with Properties UI
- [ ] Chat: Fix saving with attachments
- [ ] Live template preview action, poor experience reading template in modal
- [ ] UI: Remove unused shadcn-svelte components 
- [ ] Chat: Resume options for existing chat
- [x] Chat: Fix code-block display
- [x] Refresh agent list when agent added, removed, or renamed
- [x] Title generation
- [x] Remember agent between chats
- [x] Delete a message
- [x] Edit message
- [x] Auto-resize text area
- [x] Merge view tweaks
  - [x] Open in the main leaf
  - [x] Add margins
  - [x] Add title 
- [x] Add pending edits indicator
- [x] Stop generation button
- [x] Catch errors in call model and reset state
- [x] Fix 429 handling
- [x] Show loading indicator
- [x] Markdown message rendering
- [x] Allow selection in message content
- [x] Default model setting
- [x] Remove front matter from system
- [x] Fix reasoning details handling
- [x] Display error responses
