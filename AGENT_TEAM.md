# Agent Team Design: mcp-git-reviewer Implementation

## The Squad

| #  | Name       | Role                          | Personality |
|----|------------|-------------------------------|-------------|
| Lead | **Akshay** | Team Lead & Orchestrator | Keeps the trains running, reviews everyone's work, resolves merge conflicts (code and interpersonal). Calm under pressure but will absolutely call you out if you skip writing tests. |
| 1  | **Andres** | tool-servers — MCP Tool Server Builder | The protocol nerd. Lives and breathes JSON-RPC. Will debate the correct way to structure a tool response for 45 minutes but then ship 4 servers in one sitting. |
| 2  | **Alan**   | host-wiring — MCP Host Integration | The systems thinker. Obsessed with process lifecycles and clean shutdowns. Has opinions about file descriptors. Will not let a child process leak on his watch. |
| 3  | **Cisco**  | reviewer-flow — Review Orchestration & CLI | The UX guy. If the spinner doesn't look right, he's rewriting it. Cares deeply about what the user feels when they run the tool. Will sneak in a satisfying checkmark animation when nobody's looking. |
| 4  | **Ethan**  | testing — Test Infrastructure & Quality | The skeptic. Doesn't trust anyone's code, including his own. "Did you test the edge case where the repo has zero commits?" Yes Ethan, we did. "What about negative commits?" ...Ethan please. |
| 5  | **Anthony** | config-errors — Configuration & Production Hardening | The pragmatist. While everyone else is building features, Anthony is thinking about what happens when the API key is expired, the config file has a typo, and the user is on a plane with no wifi. Simultaneously. |

---

## Current State Assessment

The codebase is **~70% complete**. Here's what exists vs what's needed:

### Already Implemented
- CLI entry point (`src/cli.ts`) — fully functional with all flags
- Config system (`src/config.ts`) — Zod validation, YAML/JSON loading, glob ignore
- Error hierarchy (`src/errors.ts`) — full error classes, retryable detection, user formatting
- Output rendering (`src/output.ts`) — terminal + JSON output
- Git resolver (`src/git/resolver.ts`) — all range resolution modes
- Git commands (`src/git/commands.ts`) — diff, stats, blame, commit messages
- Stdio transport (`src/host/transport.ts`) — JSON-RPC over stdio, buffering, timeouts
- Conversation manager (`src/host/conversation.ts`) — Anthropic API loop with tool calls
- All prompts (`src/prompts/`) — system, initial, staged, range, security, performance
- Git-diff tool server (`src/tools/git-diff/`) — server + handlers complete
- File-context tool server (`src/tools/file-context/`) — server + handlers complete
- Conventions tool server (`src/tools/conventions/`) — server + handlers complete
- Unit tests for all of the above

### Gaps to Fill
1. **Related-files tool server** — doesn't exist yet (`src/tools/related-files/`)
2. **MCPHost.initialize()** — needs to actually spawn tool server child processes
3. **ToolRegistry.callTool()** — returns placeholder; needs real MCP routing
4. **Watch mode** — `reviewer.watch()` throws "not yet implemented"
5. **Context budget tracking** — no token counting or limit signaling
6. **Review caching** — no hash-based cache system
7. **Cost/usage tracking** — no token usage reporting
8. **Integration tests** — no MCP protocol round-trip tests
9. **CI integration** — exit codes based on severity, GitHub Actions workflow

---

## Agent Assignments

### Andres — Related Files Tool Server + Convention Enhancements

**Why him:** He already has 3 tool servers to study as patterns. The related-files server is the most architecturally interesting — it needs to traverse import graphs and find test files.

**Deliverables:**
1. `src/tools/related-files/server.ts` — MCP server with 4 tools:
   - `find_importers(file_path, project_root)` — files that import/require a given file
   - `find_exports(file_path)` — list exports from a file
   - `find_test_files(file_path, project_root)` — locate corresponding test files
   - `find_type_references(type_name, project_root)` — TypeScript type usage search
2. `src/tools/related-files/handlers.ts` — handler implementations
3. Unit tests for all handlers

**Approach:**
- `find_importers`: Glob for `.ts/.js` files, regex scan for `import ... from './path'` or `require('./path')`
- `find_exports`: Parse file for `export` statements
- `find_test_files`: Convention-based search (`.test.ts`, `.spec.ts`, `__tests__/`)
- `find_type_references`: Grep for type/interface name across codebase

---

### Alan — MCP Host Wiring

**Why him:** The transport layer exists, the tool servers exist — Alan connects the pipes. Process lifecycle management is his thing.

**Deliverables:**
1. Wire `MCPHost.initialize()` to spawn actual tool server processes via StdioTransport
2. Wire `ToolRegistry.callTool()` to route calls to the correct spawned server
3. Implement context budget tracking (token counting, configurable limits)
4. Graceful server lifecycle — startup health checks, shutdown, crash recovery
5. Register related-files tools alongside existing tools

**Key Design:**
```typescript
// MCPHost.initialize() should:
// 1. Spawn each server: npx tsx src/tools/<name>/server.ts
// 2. Initialize StdioTransport for each
// 3. Call tools/list to discover available tools
// 4. Register discovered tools in ToolRegistry

// ToolRegistry.callTool() should:
// 1. Look up which server owns the requested tool
// 2. Forward via transport.request('tools/call', {name, arguments})
// 3. Return the result
```

**Depends on:** Andres (needs related-files server definition)

---

### Cisco — Review Flow & Watch Mode

**Why him:** Cisco obsesses over the user experience. The review flow is where the user actually sees results.

**Deliverables:**
1. Implement `reviewer.watch()` — monitor for new commits, auto-review, debounce
2. Streaming progress — show which files are being analyzed during review
3. Wire `--focus` areas to specialized prompt templates (security, performance)
4. Exit codes based on severity (0 = clean, 1 = critical findings, 2 = error)
5. Improve output formatting — file grouping, clickable line references

**Watch mode design:**
- Poll `git log` every 2 seconds for new commits
- Debounce: wait 5 seconds after last commit before reviewing
- Review each new commit individually
- Display results inline, keep watching
- Ctrl+C for clean exit

**Depends on:** Alan (needs working host to test full flow)

---

### Ethan — Integration Tests & Quality

**Why him:** Ethan doesn't trust anything. He'll make sure the whole pipeline actually works end-to-end.

**Deliverables:**
1. MCP protocol integration tests — spawn a real tool server, send JSON-RPC, verify responses
2. Full review flow integration test — mock Anthropic API, run through entire pipeline
3. Tool server handler tests for related-files (after Andres builds them)
4. Fixture enhancement — repos with specific issues (security vulns, perf problems, style violations)
5. Coverage report — ensure >80% across the project

**Test strategy:**
- Integration tests use real child processes (spawn actual servers)
- Review flow tests mock only the Anthropic API (everything else is real)
- Fixture repos test specific review scenarios

**Depends on:** Andres (for related-files tests), Alan (for integration tests)

---

### Anthony — Caching, Cost Tracking & CI

**Why him:** Anthony thinks about what happens in production. Caching, cost awareness, and CI integration are all about making the tool reliable for daily use.

**Deliverables:**
1. Review caching system:
   - Hash-based cache keys (diff content + config + model)
   - Cache storage in `.mcp-review-cache/`
   - `--no-cache` flag (already in config)
   - Cache invalidation on config change
2. Cost/usage tracking:
   - Token usage extraction from Anthropic API responses
   - Per-review cost estimation (based on model pricing)
   - `--verbose` displays token usage
3. CI integration:
   - GitHub Actions example workflow file
   - Machine-readable JSON output validation
   - Exit code documentation

---

## Execution Waves

### Wave 1 — Parallel Foundation (No dependencies)

| Agent    | Task |
|----------|------|
| **Andres** | Build related-files tool server + handlers + tests |
| **Anthony** | Build review caching system + cost tracking |
| **Ethan** | Enhance test fixtures, write integration test framework |

### Wave 2 — Host Integration (Depends on Wave 1)

| Agent    | Task |
|----------|------|
| **Alan** | Wire MCPHost to spawn servers + route tool calls |
| **Ethan** | Write related-files handler tests |
| **Andres** | Help Alan test server spawning if needed |

### Wave 3 — End-to-End Flow (Depends on Wave 2)

| Agent    | Task |
|----------|------|
| **Cisco** | Implement watch mode, streaming progress, exit codes |
| **Anthony** | Wire cost tracking into ConversationManager |
| **Ethan** | Full integration tests (host ↔ servers ↔ review) |

### Wave 4 — Polish & Validation

| Agent    | Task |
|----------|------|
| **Cisco** | Final UX polish, focus area wiring |
| **Anthony** | GitHub Actions workflow, CI docs |
| **Ethan** | Coverage check, edge case tests |
| **All** | Bug fixes from integration testing |

---

## Inter-Agent Contracts

### ToolServer Interface (Andres → Alan)
```typescript
// Each server must:
// 1. Be runnable via: npx tsx src/tools/<name>/server.ts
// 2. Speak MCP protocol over stdio (StdioServerTransport)
// 3. Register tools with Zod-validated input schemas
// 4. Return {content: [{type: 'text', text: string}], isError?: boolean}
```

### ToolRegistry Contract (Alan → Cisco)
```typescript
// ToolRegistry.callTool() must:
// 1. Accept ToolCallRequest {name: string, arguments: Record<string, unknown>}
// 2. Route to correct server
// 3. Return ToolCallResult {content: string, isError: boolean}
// 4. Throw ToolServerError on failure (not silently fail)
```

### ReviewResult Contract (Cisco → Ethan)
```typescript
// ReviewResult must include:
// {
//   critical: ReviewFinding[]
//   suggestions: ReviewFinding[]
//   positive: ReviewFinding[]
//   confidence: 'high' | 'medium' | 'low'
//   stats: DiffStats
//   tokenUsage?: { input: number, output: number }  // Anthony adds this
// }
```

### Cache Key Contract (Anthony)
```typescript
// Cache key = SHA256(diffContent + JSON.stringify(config) + model)
// Cache location: .mcp-review-cache/<key>.json
// Cache entry: { result: ReviewResult, timestamp: number, version: string }
```

---

## Success Criteria

1. `mcp-review HEAD~1..HEAD` produces a real review using actual MCP tool servers
2. `mcp-review --staged` works for pre-commit review
3. `mcp-review --watch` monitors and reviews new commits
4. `mcp-review --focus security` produces security-focused review
5. Reviews are cached and reused when diff hasn't changed
6. Token usage is reported with `--verbose`
7. Exit codes work for CI integration
8. Test coverage >80%
9. All tool servers can be tested in isolation
