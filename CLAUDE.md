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
| `eslint` | Linting with TypeScript rules |
| `prettier` | Code formatting |
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

- [ ] Project scaffolding
  - [x] Directory structure
  - [x] TypeScript configuration
  - [x] Package.json with dependencies
  - [ ] ESLint + Prettier setup
  - [ ] Vitest configuration

- [ ] Git Resolver (`src/git/resolver.ts`)
  - [ ] Parse `HEAD~N..HEAD` range syntax
  - [ ] Handle single commit input (`abc123` → `abc123~1..abc123`)
  - [ ] Implement `--last N` translation
  - [ ] Implement `--since <date>` translation
  - [ ] Handle `--staged` mode (diff index vs HEAD)

- [ ] Basic CLI (`src/cli.ts`)
  - [ ] Argument parsing with commander
  - [ ] Help text and version info
  - [ ] Route to appropriate review mode

- [ ] Git Diff Tool Server (`src/tools/git-diff/`)
  - [ ] MCP server setup with stdio transport
  - [ ] `get_diff` — full diff for revision range
  - [ ] `get_diff_stats` — file change summary
  - [ ] `get_commit_messages` — commit messages in range

- [ ] File Context Tool Server (`src/tools/file-context/`)
  - [ ] MCP server setup
  - [ ] `read_file` — full file contents with line numbers
  - [ ] `read_lines` — specific line range from file
  - [ ] `list_directory` — directory structure

- [ ] MCP Host Runtime (`src/host/`)
  - [ ] Spawn tool server processes via stdio
  - [ ] Capability negotiation on startup
  - [ ] Tool registry mapping names to servers
  - [ ] Forward tool calls from LLM to servers
  - [ ] Basic conversation state management

- [ ] Basic Review Flow (`src/reviewer.ts`)
  - [ ] Construct initial prompt with diff
  - [ ] Send to Claude API with tool descriptions
  - [ ] Handle tool call responses
  - [ ] Parse structured review output
  - [ ] Basic terminal output

#### Deliverable
`mcp-review HEAD~1..HEAD` produces a basic review

---

### Phase 2: Context Intelligence (Week 2)

**Goal:** Project-aware reviews that reference existing patterns

#### Tasks

- [ ] Convention Scanner Tool (`src/tools/conventions/`)
  - [ ] `scan_lint_config` — read ESLint, Prettier, tsconfig
  - [ ] `find_similar_patterns` — search codebase for similar code
  - [ ] `get_project_conventions` — read .mcp-review.yml conventions

- [ ] Related Files Tool (`src/tools/related-files/`)
  - [ ] `find_importers` — files that import changed file
  - [ ] `find_exports` — exports from changed file
  - [ ] `find_test_files` — corresponding test files
  - [ ] `find_type_references` — TypeScript type usage

- [ ] Context Budget Management
  - [ ] Track cumulative token usage
  - [ ] Signal LLM when approaching limit
  - [ ] Implement file content caching

- [ ] Improved Prompts (`src/prompts/`)
  - [ ] System prompt with convention awareness
  - [ ] Templates for different review modes
  - [ ] Structured JSON output instructions

- [ ] `--staged` Mode
  - [ ] Diff staged index vs HEAD
  - [ ] Pre-commit hook integration docs

- [ ] Output Formatting (`src/output.ts`)
  - [ ] Severity-based grouping (critical, suggestions, positive)
  - [ ] Line number references with file paths
  - [ ] Confidence indicator
  - [ ] Summary statistics

#### Deliverable
Reviews reference existing project patterns and conventions

---

### Phase 3: Polish & UX (Week 3)

**Goal:** Production-ready CLI experience

#### Tasks

- [ ] Configuration System (`src/config.ts`)
  - [ ] Load `.mcp-review.yml` from project root
  - [ ] Merge with defaults
  - [ ] Validate with zod schema
  - [ ] Support ignore patterns
  - [ ] Custom conventions list

- [ ] Additional CLI Options
  - [ ] `--focus <areas>` — security, performance, consistency
  - [ ] `--since <date>` — time-based review ranges
  - [ ] `--model <model>` — select Claude model
  - [ ] `--verbose` — detailed output mode

- [ ] Streaming Progress
  - [ ] Spinner during analysis
  - [ ] Show which files being analyzed
  - [ ] Display context gathering progress
  - [ ] Replace spinner with final output

- [ ] Error Handling
  - [ ] Graceful degradation on tool failures
  - [ ] Clear error messages for common issues
  - [ ] Timeout handling for long operations
  - [ ] API error handling with retry logic

- [ ] Test Suite
  - [ ] Unit tests for git resolver
  - [ ] Unit tests for tool operations
  - [ ] Integration tests for MCP protocol
  - [ ] Fixture repos with known issues

#### Deliverable
Polished CLI ready for real-world usage

---

### Phase 4: Advanced Features (Week 4, Stretch)

**Goal:** Power user features and CI integration

#### Tasks

- [ ] Watch Mode (`--watch`)
  - [ ] Monitor for new commits
  - [ ] Auto-review on commit
  - [ ] Debounce rapid commits

- [ ] Review Caching
  - [ ] Hash-based cache keys
  - [ ] Skip unchanged files
  - [ ] Cache invalidation on config change

- [ ] CI Integration
  - [ ] `--output json` for machine-readable output
  - [ ] Exit codes based on severity
  - [ ] GitHub Actions example workflow

- [ ] Cost & Usage Tracking
  - [ ] Token usage reporting
  - [ ] Cost estimation per review
  - [ ] Usage history logging

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
