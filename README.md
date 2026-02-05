# mcp-git-reviewer

Context-aware, AI-powered code review at the commit level. Works with local git history — no PRs required.

Built as an MCP Host that orchestrates tool servers to gather context from your codebase and feeds it to Claude for intelligent, project-specific reviews.

## What's in the box

```
src/
  cli.ts                  CLI entry point (commander)
  config.ts               YAML/JSON config loader (zod validated)
  reviewer.ts             Review orchestration
  output.ts               Terminal rendering (chalk, boxen)
  git/
    resolver.ts           Translates user input to git revision ranges
    commands.ts           simple-git wrappers (diff, blame, log)
  host/
    mcp-host.ts           MCP host lifecycle management
    transport.ts          Stdio JSON-RPC transport
    tool-registry.ts      Tool capability registry and routing
    conversation.ts       Anthropic SDK conversation loop
  prompts/
    system.ts             System prompt with review instructions
    templates.ts          Specialized review templates
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

## License

MIT
