# mcp-git-reviewer

Context-aware, AI-powered code review at the commit level. Works with local git history — no PRs required.

Built as an MCP Host that orchestrates tool servers to gather context from your codebase and feeds it to Claude for intelligent, project-specific reviews.

## What's in the box

```
src/
  cli.ts                  CLI entry point (commander)
  config.ts               YAML/JSON config loader (zod validated)
  reviewer.ts             Review orchestration + watch mode
  output.ts               Terminal rendering (chalk, boxen)
  cache.ts                Hash-based review caching
  usage.ts                Token usage tracking and cost estimation
  errors.ts               Typed error hierarchy (ToolServerError, ApiError, etc.)
  git/
    resolver.ts           Translates user input to git revision ranges
    commands.ts           simple-git wrappers (diff, blame, log)
  host/
    mcp-host.ts           MCP host lifecycle — spawns tool servers
    transport.ts          Stdio JSON-RPC transport
    tool-registry.ts      Tool capability discovery and call routing
    conversation.ts       Anthropic SDK conversation loop with usage tracking
  tools/
    git-diff/             Diff, stats, commit messages
    file-context/         File reading with line numbers, directory listing
    conventions/          Lint config scanning, pattern search, project conventions
    related-files/        Import graph, exports, test file discovery, type references
  prompts/
    system.ts             System prompt with review instructions
    templates.ts          Security and performance review templates
```

## Tech stack

| Category | Tool |
|----------|------|
| Language | TypeScript 5 (strict) |
| Runtime | Node.js 20+ / Bun |
| Package manager | Bun |
| AI | Anthropic SDK + MCP SDK |
| Git | simple-git |
| CLI | commander, chalk, boxen |
| Config | zod, yaml, dotenv |
| Lint & format | Biome |
| Test | Vitest |
| CI | GitHub Actions, SonarCloud |

## Setup

```bash
# Install bun (if not already installed)
curl -fsSL https://bun.sh/install | bash

# Install dependencies
bun install

# Copy environment template and add your API key
cp .env.example .env
```

Required in `.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

## Development

```bash
# Run in dev mode
bun run dev

# Type check
bun run typecheck

# Lint and format
bun run lint
bun run format

# Run tests
bun run test
bun run test:watch
bun run test:coverage
```

## Verify

Run the full CI pipeline locally:

```bash
bun run verify
```

This runs lint, format check, typecheck, build, and tests — with a pass/fail summary at the end.

## Usage

```bash
# Review the last commit
mcp-review HEAD~1..HEAD

# Review staged changes (pre-commit)
mcp-review --staged

# Review a specific commit
mcp-review abc123

# Review last N commits
mcp-review --last 3

# Review everything since yesterday
mcp-review --since yesterday

# Focus on specific areas
mcp-review --staged --focus security,performance

# Watch mode — auto-review each new commit
mcp-review --watch

# Skip cache for a fresh review
mcp-review HEAD~1..HEAD --no-cache

# JSON output for CI pipelines (exit code 1 on critical findings)
mcp-review HEAD~1..HEAD --output json

# Verbose mode — show token usage and cost
mcp-review HEAD~1..HEAD --verbose
```

## Configuration

Create a `.mcp-review.yml` in your project root (see `.mcp-review.yml.example`):

```yaml
model: claude-sonnet-4-20250514
focus:
  - security
  - performance
ignore:
  - "*.test.ts"
  - dist
conventions:
  - "Use named exports"
  - "Error messages should be user-facing"
```

## CI Integration

The repo includes GitHub Actions workflows:

- **`.github/workflows/ci.yml`** — Runs lint, typecheck, build, and tests on push/PR
- **`.github/workflows/review.yml`** — Example: runs mcp-review on PRs and posts results as a comment
- **`.github/workflows/sonarqube.yml`** — Uploads coverage to SonarCloud

Exit codes for CI:
- `0` — Review passed (no critical findings)
- `1` — Critical findings detected
- `2` — Runtime error

## Architecture

mcp-review is an **MCP Host** that spawns tool servers as child processes:

```
CLI → MCPHost.initialize()
        ├── git-diff server      (diff, stats, commit messages)
        ├── file-context server  (read files, list directories)
        ├── conventions server   (lint configs, pattern search)
        └── related-files server (imports, exports, test files, types)
              ↓
         Claude API (tool use loop)
              ↓
         Structured ReviewResult → terminal output
```

Each tool server is a standalone MCP server using stdio transport. The host discovers tools via `tools/list` and routes LLM tool calls to the correct server via `tools/call`.

Reviews are cached by content hash. Repeated reviews of the same diff skip the API call entirely.

## License

MIT
