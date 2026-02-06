# mcp-git-reviewer

Context-aware, AI-powered code review at the commit level. Works with local git history — no PRs required.

## Tech Stack

### Core Technologies

| Technology | Version | Purpose |
|------------|---------|---------|
| **TypeScript** | 5.x | Primary language — type safety for MCP protocol handling |
| **Node.js** | 20+ LTS | Runtime environment |
| **MCP SDK** | `@modelcontextprotocol/sdk` | MCP host and server implementation |
| **Anthropic SDK** | `@anthropic-ai/sdk` | Claude API integration for LLM calls |

### CLI & User Interface

| Package | Purpose |
|---------|---------|
| `commander` | CLI argument parsing and command structure |
| `chalk` | Terminal output coloring |
| `ora` | Spinner for progress indication |
| `boxen` | Box drawing for formatted output |

### Git Integration

| Package | Purpose |
|---------|---------|
| `simple-git` | Programmatic git operations (diff, log, blame) |
| `parse-diff` | Parse unified diff output into structured data |

### Configuration & Validation

| Package | Purpose |
|---------|---------|
| `yaml` | Parse `.mcp-review.yml` config files |
| `zod` | Runtime validation for config and LLM output |
| `dotenv` | Environment variable management |

### Development & Testing

| Package | Purpose |
|---------|---------|
| `vitest` | Test runner with TypeScript support |
| `tsx` | TypeScript execution for development |
| `@biomejs/biome` | Linting and formatting |
| `@types/node` | Node.js type definitions |

---

## Architecture Overview

This tool is an **MCP Host** that orchestrates multiple MCP tool servers:

```
CLI → MCP Host Runtime → Tool Servers → Git Repo & File System
                ↓
           Claude API
```

### Key Components

1. **CLI Entry Point** (`src/cli.ts`) — Parses args, resolves commit ranges
2. **MCP Host Runtime** (`src/host/`) — Manages tool server lifecycles, routes LLM tool calls
3. **Tool Servers** (`src/tools/`) — Git Diff, File Context, Conventions, Related Files
4. **Git Resolver** (`src/git/`) — Translates user input to git revision ranges
5. **Output Renderer** (`src/output.ts`) — Formats review results for terminal

---

## Development Phases

### Phase 1: Foundation (Week 1)

**Goal:** End-to-end flow producing a basic review

#### Tasks

- [x] Project scaffolding
  - [x] Directory structure
  - [x] TypeScript configuration
  - [x] Package.json with dependencies
  - [x] ~~ESLint + Prettier setup~~ → Using Biome for linting & formatting
  - [x] Vitest configuration

- [x] Git Resolver (`src/git/resolver.ts`)
  - [x] Parse `HEAD~N..HEAD` range syntax
  - [x] Handle single commit input (`abc123` → `abc123~1..abc123`)
  - [x] Implement `--last N` translation
  - [x] Implement `--since <date>` translation
  - [x] Handle `--staged` mode (diff index vs HEAD)

- [x] Basic CLI (`src/cli.ts`)
  - [x] Argument parsing with commander
  - [x] Help text and version info
  - [x] Route to appropriate review mode

- [x] Git Diff Tool Server (`src/tools/git-diff/`)
  - [x] MCP server setup with stdio transport
  - [x] `get_diff` — full diff for revision range
  - [x] `get_diff_stats` — file change summary
  - [x] `get_commit_messages` — commit messages in range

- [x] File Context Tool Server (`src/tools/file-context/`)
  - [x] MCP server setup
  - [x] `read_file` — full file contents with line numbers
  - [x] `read_lines` — specific line range from file
  - [x] `list_directory` — directory structure

- [x] MCP Host Runtime (`src/host/`)
  - [x] Spawn tool server processes via stdio
  - [x] Capability negotiation on startup
  - [x] Tool registry mapping names to servers
  - [x] Forward tool calls from LLM to servers
  - [x] Basic conversation state management

- [x] Basic Review Flow (`src/reviewer.ts`)
  - [x] Construct initial prompt with diff
  - [x] Send to Claude API with tool descriptions
  - [x] Handle tool call responses
  - [x] Parse structured review output
  - [x] Basic terminal output

#### Deliverable
`mcp-review HEAD~1..HEAD` produces a basic review

---

### Phase 2: Context Intelligence (Week 2)

**Goal:** Project-aware reviews that reference existing patterns

#### Tasks

- [x] Convention Scanner Tool (`src/tools/conventions/`)
  - [x] `scan_lint_config` — read Biome, ESLint, Prettier, tsconfig (scans any project's config)
  - [x] `find_similar_patterns` — search codebase for similar code
  - [x] `get_project_conventions` — read .mcp-review.yml conventions

- [x] Related Files Tool (`src/tools/related-files/`)
  - [x] `find_importers` — files that import changed file
  - [x] `find_exports` — exports from changed file
  - [x] `find_test_files` — corresponding test files
  - [x] `find_type_references` — TypeScript type usage

- [x] Context Budget Management
  - [x] Track cumulative token usage
  - [x] Signal LLM when approaching limit
  - [x] Implement file content caching

- [x] Improved Prompts (`src/prompts/`)
  - [x] System prompt with convention awareness
  - [x] Templates for different review modes
  - [x] Structured JSON output instructions

- [x] `--staged` Mode
  - [x] Diff staged index vs HEAD
  - [x] Pre-commit hook integration docs

- [x] Output Formatting (`src/output.ts`)
  - [x] Severity-based grouping (critical, suggestions, positive)
  - [x] Line number references with file paths
  - [x] Confidence indicator
  - [x] Summary statistics

#### Deliverable
Reviews reference existing project patterns and conventions

---

### Phase 3: Polish & UX (Week 3)

**Goal:** Production-ready CLI experience

#### Tasks

- [x] Configuration System (`src/config.ts`)
  - [x] Load `.mcp-review.yml` from project root
  - [x] Merge with defaults
  - [x] Validate with zod schema
  - [x] Support ignore patterns
  - [x] Custom conventions list

- [x] Additional CLI Options
  - [x] `--focus <areas>` — security, performance, consistency
  - [x] `--since <date>` — time-based review ranges
  - [x] `--model <model>` — select Claude model
  - [x] `--verbose` — detailed output mode

- [x] Streaming Progress
  - [x] Spinner during analysis
  - [x] Show which files being analyzed
  - [x] Display context gathering progress
  - [x] Replace spinner with final output

- [x] Error Handling
  - [x] Graceful degradation on tool failures
  - [x] Clear error messages for common issues
  - [x] Timeout handling for long operations
  - [x] API error handling with retry logic

- [x] Test Suite
  - [x] Unit tests for git resolver
  - [x] Unit tests for tool operations
  - [x] Integration tests for MCP protocol
  - [x] Fixture repos with known issues

#### Deliverable
Polished CLI ready for real-world usage

---

### Phase 4: Advanced Features (Week 4, Stretch)

**Goal:** Power user features and CI integration

#### Tasks

- [x] Watch Mode (`--watch`)
  - [x] Monitor for new commits
  - [x] Auto-review on commit
  - [x] Debounce rapid commits

- [x] Review Caching
  - [x] Hash-based cache keys
  - [x] Skip unchanged files
  - [x] Cache invalidation on config change

- [x] CI Integration
  - [x] `--output json` for machine-readable output
  - [x] Exit codes based on severity
  - [x] GitHub Actions example workflow

- [x] Cost & Usage Tracking
  - [x] Token usage reporting
  - [x] Cost estimation per review
  - [x] Usage history logging

- [ ] Multi-Provider Support
  - [ ] Abstract LLM interface
  - [ ] OpenAI provider option
  - [ ] Local model support (future)

#### Deliverable
Full-featured tool with CI/CD integration

---

## Commands Reference

```bash
# Review staged changes (pre-commit)
mcp-review --staged

# Review the last commit
mcp-review HEAD~1..HEAD

# Review a specific commit
mcp-review abc123

# Review last N commits
mcp-review --last 3

# Review everything since yesterday
mcp-review --since yesterday

# Review with specific focus areas
mcp-review --staged --focus security,performance

# Watch mode — review each commit as it happens
mcp-review --watch

# View usage history and cost summary
mcp-review --usage-report
```

---

## Project Structure

```
mcp-git-reviewer/
├── package.json
├── tsconfig.json
├── CLAUDE.md              # This file
├── README.md
├── .mcp-review.yml.example
│
├── src/
│   ├── cli.ts             # Entry point, arg parsing
│   ├── config.ts          # Config file loading
│   ├── reviewer.ts        # Review orchestration
│   ├── output.ts          # Terminal formatting
│   │
│   ├── host/
│   │   ├── mcp-host.ts    # MCP host runtime
│   │   ├── transport.ts   # stdio transport
│   │   ├── tool-registry.ts
│   │   └── conversation.ts
│   │
│   ├── tools/
│   │   ├── git-diff/
│   │   ├── file-context/
│   │   ├── conventions/
│   │   └── related-files/
│   │
│   ├── git/
│   │   ├── resolver.ts    # Input → git ranges
│   │   └── commands.ts    # Git CLI wrapper
│   │
│   └── prompts/
│       ├── system.ts
│       └── templates.ts
│
├── tests/
│   ├── host/
│   ├── tools/
│   ├── git/
│   └── fixtures/
│
└── bin/
    └── mcp-review
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `MCP_REVIEW_MODEL` | No | Default model (default: `claude-sonnet-4-20250514`) |
| `MCP_REVIEW_DEBUG` | No | Enable debug logging |

---

## Key Design Decisions

1. **MCP Host Architecture** — Separation of concerns; LLM decides what context it needs, tools provide it
2. **LLM-Driven Context Gathering** — Let the model request files rather than pre-loading everything
3. **Context Budget System** — Track tokens, signal limits, prioritize critical files
4. **Structured JSON Output** — Reliable parsing of LLM responses
5. **Streaming Progress** — Keep users informed during 10-30s review cycles

---

## Testing

```bash
# Run all tests
npm test

# Run specific test file
npm test -- tests/git/resolver.test.ts

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch
```

---

## Contributing

1. Check the phase tasks above for current priorities
2. Each tool server should be testable in isolation
3. Follow existing TypeScript patterns
4. Add tests for new functionality
5. Update this CLAUDE.md when adding major features
