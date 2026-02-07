# mcp-git-reviewer

Context-aware, AI-powered code review at the commit level. Works with local git history — no PRs required.

Built as an MCP Host that orchestrates tool servers to gather context from your codebase and feeds it to an LLM for intelligent, project-specific reviews.

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
    conversation.ts       LLM conversation loop with usage tracking
  llm/
    provider.ts           Shared LLMProvider interface and types
    anthropic.ts          Anthropic SDK provider with rate-limit retry
    openai.ts             OpenAI-compatible provider (OpenRouter, DeepSeek, Kimi, etc.)
    index.ts              Provider factory + model alias resolution
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
| AI | Anthropic SDK, OpenAI-compatible APIs, MCP SDK |
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

# Build the project
bun run build

# Copy environment template and add your API key
cp .env.example .env
```

Required in `.env` (depending on provider):

```
ANTHROPIC_API_KEY=sk-ant-...   # For Anthropic (default)
OPENROUTER_API_KEY=sk-or-...   # For OpenRouter models (qwen3-coder, etc.)
DEEPSEEK_API_KEY=sk-...        # For DeepSeek
MOONSHOT_API_KEY=sk-...        # For Kimi / Moonshot
```

### Global install

Link the CLI so you can run `mcp-review` from any git repository:

```bash
npm link
```

### Using in another project

Navigate to any git repo and run `mcp-review` directly:

```bash
cd /path/to/your-project
mcp-review --staged
```

Optionally, create a `.mcp-review.yml` in that project's root to customize review behavior:

```yaml
model: qwen3-coder
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

See [Configuration](#configuration) for all available options.

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

# Use a specific model
mcp-review HEAD~1 --model qwen3-coder

# Use a custom OpenAI-compatible endpoint
mcp-review HEAD~1 --provider openai --base-url https://openrouter.ai/api/v1 --model qwen/qwen3-coder:free --api-key-env OPENROUTER_API_KEY
```

## Multi-provider support

mcp-review supports multiple LLM providers through an abstract `LLMProvider` interface.

### Model aliases

Short names that auto-configure provider, base URL, and API key:

| Alias | Model | Provider | API Key Env |
|-------|-------|----------|-------------|
| `qwen3-coder` | `qwen/qwen3-coder:free` via OpenRouter | openai | `OPENROUTER_API_KEY` |
| `deepseek` | `deepseek-chat` via DeepSeek API | openai | `DEEPSEEK_API_KEY` |
| `kimi` | `kimi-k2.5` via Moonshot API | openai | `MOONSHOT_API_KEY` |

Use an alias with `--model` or in your config file:

```bash
mcp-review HEAD~1 --model qwen3-coder
```

### Providers

- **Anthropic** (default) — Uses the Anthropic SDK. Models: `claude-sonnet-4-20250514`, `claude-opus-4-20250514`, `claude-haiku-3-5-20241022`
- **OpenAI-compatible** — Works with any endpoint implementing the OpenAI chat completions API: OpenRouter, DeepSeek, Kimi/Moonshot, and others

## Configuration

Create a `.mcp-review.yml` in your project root:

```yaml
model: qwen3-coder
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

All config fields:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `model` | string | `claude-sonnet-4-20250514` | Model name or alias |
| `provider` | `anthropic` \| `openai` | `anthropic` | LLM provider (auto-set by aliases) |
| `base_url` | string | — | Base URL for OpenAI-compatible API |
| `api_key_env` | string | — | Env var name for API key |
| `focus` | string[] | `[]` | Focus areas: security, performance, consistency |
| `ignore` | string[] | `[]` | Glob patterns for files to skip |
| `conventions` | string[] | `[]` | Project conventions to enforce |
| `max_files` | number | `20` | Max files to review |
| `context_lines` | number | `5` | Lines of context around changes |
| `no_cache` | boolean | `false` | Skip review cache |

## CI Integration

The repo includes GitHub Actions workflows:

- **`.github/workflows/ci.yml`** — Runs lint, typecheck, build, and tests on push/PR
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
         LLMProvider (Anthropic or OpenAI-compatible)
              ↓
         Structured ReviewResult → terminal output
```

Each tool server is a standalone MCP server using stdio transport. The host discovers tools via `tools/list` and routes LLM tool calls to the correct server via `tools/call`.

Reviews are cached by content hash. Repeated reviews of the same diff skip the API call entirely.

## License

MIT
