# ADR-001: Performance Tuning for Review Pipeline

**Status:** Accepted
**Date:** 2025-06-01
**Context:** The initial implementation of `mcp-review` took an unacceptably long time to complete reviews, often hanging or running for several minutes on even small commits.

## Problem

Running `mcp-review` on a single commit would hang at "Generating review..." for extended periods. Investigation revealed multiple bottlenecks across the pipeline: server initialization, tool execution, network overhead, and unbounded LLM conversation loops.

## Decisions

### 1. Parallel Server Initialization

**Before:** Tool servers (git-diff, file-context, conventions, related-files) were started sequentially in a for-loop, each taking ~500ms.
**After:** All servers are started in parallel using `Promise.allSettled()`.
**Rationale:** Server initialization is I/O-bound (process spawning) with no interdependencies. `Promise.allSettled` allows graceful degradation — if one server fails, the others still work.
**Impact:** ~2s saved on startup (4 servers x ~500ms each, now overlapped).

**Files:** `src/host/mcp-host.ts`

### 2. Parallel Tool Call Execution

**Before:** When the LLM requested multiple tools in a single response, they were executed sequentially in a for-loop.
**After:** All tool calls within a turn are dispatched with `Promise.all()`.
**Rationale:** Tool calls are independent reads against the filesystem or git. Running them in parallel eliminates unnecessary sequential wait time.
**Impact:** Proportional to number of parallel tool calls per turn (typically 3-5).

**Files:** `src/host/conversation.ts`

### 3. Eliminate Redundant Diff Fetching

**Before:** The diff and stats were fetched in `reviewer.ts` for cache key computation, then fetched again inside `conversation.ts` for the LLM prompt.
**After:** Diff and stats are fetched once in `reviewer.ts` and passed as `prefetched` data through `MCPHost.runReview()` to `ConversationManager.runReview()`.
**Rationale:** Git diff is deterministic for the same range within a session. No reason to compute it twice.
**Impact:** Eliminates one redundant `git diff` and `git diff --stat` invocation.

**Files:** `src/reviewer.ts`, `src/host/mcp-host.ts`, `src/host/conversation.ts`

### 4. Use Local tsx Instead of npx

**Before:** Servers were spawned via `npx tsx <server-path>`, which incurs npm registry resolution overhead (~1-2s per invocation).
**After:** Servers are spawned directly via `node_modules/.bin/tsx`, which is already installed as a devDependency.
**Rationale:** `npx` adds unnecessary overhead for a locally-installed package. Direct invocation is instant.
**Impact:** Saves ~1-2s per server spawn (4 servers).

**Files:** `src/host/mcp-host.ts`, `package.json`

### 5. Replace setTimeout with Process Spawn Event

**Before:** `StdioTransport.start()` used `setTimeout(resolve, 100)` to wait for the child process to be ready.
**After:** Uses `process.once('spawn', () => resolve())` for an event-driven startup signal.
**Rationale:** The 100ms timeout was arbitrary and either too long (wasted time) or too short (race condition). Event-driven is both faster and more reliable.
**Impact:** Eliminates 100ms fixed delay per server (400ms total).

**Files:** `src/host/transport.ts`

### 6. Parallel Init + Diff Fetch

**Before:** Server initialization completed first, then diff was fetched.
**After:** `host.initialize()`, `getDiff()`, and `getDiffStats()` are all dispatched with `Promise.all()`.
**Rationale:** These three operations are completely independent. The diff fetch can happen while servers are starting.
**Impact:** Overlaps server init time with diff computation.

**Files:** `src/reviewer.ts`

### 7. Performance Timing Instrumentation

**Added:** `src/logger.ts` module providing `timer()`, `debug()`, `setVerbose()`, and `timeAsync()` utilities.
**Rationale:** Without timing data, performance regressions are invisible. The logger writes to stderr so it doesn't interfere with JSON output mode. Enabled via `--verbose` flag or `MCP_REVIEW_DEBUG=true`.

**Files:** `src/logger.ts` (new), integrated across `src/host/`, `src/reviewer.ts`

### 8. Descriptive Spinner Progress

**Before:** Spinner showed a static "Generating review..." message for the entire duration.
**After:** Spinner text updates dynamically based on what's happening: which files are being read, which tools are running, round numbers, and final "Writing review..." phase.
**Rationale:** Long-running operations need user feedback to maintain confidence the tool isn't frozen.
**Implementation:** `TOOL_LABELS` map translates internal tool names to user-friendly descriptions. `describeToolCalls()` builds a spinner message from the current tool use blocks.

**Files:** `src/host/conversation.ts`

### 9. Cap LLM Tool-Call Rounds (MAX_TOOL_ROUNDS)

**Before:** The conversation loop was unbounded — the LLM could request tools indefinitely, leading to 5+ round trips.
**After:** `MAX_TOOL_ROUNDS = 2`. After this limit, the `tools` parameter is dropped from the API call, forcing the LLM to produce a text response.
**Rationale:** With pre-loaded file contents, the LLM rarely needs more than 1-2 rounds of tool calls. Unbounded loops waste tokens and time on diminishing-return context gathering.
**Trade-off:** In rare cases with very large diffs, the LLM may have slightly less context. This is acceptable because the most critical context (changed files) is already pre-loaded.

**Files:** `src/host/conversation.ts`

### 10. Pre-load Changed File Contents in Initial Prompt

**Before:** The LLM's first action was always to call `read_file` on every changed file, consuming an entire tool-call round.
**After:** `ConversationManager.preloadFileContents()` reads all changed files (up to `max_files`, capped at 10KB each) and includes them in the initial user prompt. The prompt explicitly notes "You do NOT need to call read_file for these."
**Rationale:** The most common first tool round is predictable and can be eliminated entirely. Files are filtered through ignore patterns and truncated for size safety.
**Impact:** Eliminates the most common first tool-call round entirely.

**Files:** `src/host/conversation.ts`, `src/prompts/system.ts`

### 11. Remove project_root Boilerplate from Tool Schemas

**Before:** Most tools required `project_root` as a mandatory string parameter, which the LLM had to provide on every call.
**After:** `project_root` is optional with a `process.cwd()` default in all tool handlers and schemas.
**Rationale:** Reduces token overhead in tool call arguments and simplifies the LLM's decision-making. The MCP servers typically run in the correct working directory already.

**Files:** `src/tools/conventions/server.ts`, `src/tools/conventions/handlers.ts`, `src/tools/related-files/server.ts`, `src/tools/related-files/handlers.ts`

### 12. Composite get_file_context Tool

**Before:** Getting full context about a file required 3 separate tool calls: `read_file` + `find_exports` + `find_importers`.
**After:** A single `get_file_context` tool returns file contents (with line numbers), extracted exports, and optionally importers in one call.
**Rationale:** Reduces the number of tool-call rounds needed. The LLM can get comprehensive file context in a single invocation instead of three.
**Trade-off:** Slightly larger response payload, but well within token limits for typical source files.

**Files:** `src/tools/file-context/handlers.ts`, `src/tools/file-context/server.ts`

### 13. Tool Result Caching Within a Session

**Before:** If the LLM called the same tool with the same arguments twice (e.g., `read_file` on the same path), both calls hit the server.
**After:** `ToolRegistry` maintains an in-memory cache keyed by `toolName:JSON(arguments)`. Cacheable tools (read-only, deterministic operations) return cached results on subsequent identical calls. The cache is cleared on `shutdown()`.
**Rationale:** Within a single review session, file contents and git state don't change. Caching avoids redundant IPC round-trips to tool servers.
**Cacheable tools:** `read_file`, `read_lines`, `get_file_context`, `find_importers`, `find_exports`, `find_test_files`, `find_type_references`, `scan_lint_config`, `get_project_conventions`, `get_diff`, `get_diff_stats`, `get_commit_messages`.
**Non-cacheable:** `find_similar_patterns` (pattern search results may vary in relevance across contexts), `list_directory`.

**Files:** `src/host/tool-registry.ts`

### 14. Efficient System Prompt

**Before:** System prompt encouraged broad context gathering: "start by using tools to understand the codebase."
**After:** System prompt emphasizes efficiency: "Call ALL the tools you need in a SINGLE round", "at most 1-2 rounds", "If the diff gives you enough context, skip tool calls entirely."
**Rationale:** Prompt engineering is the cheapest way to reduce round trips. Clear efficiency guidelines prevent the LLM from speculative exploration.

**Files:** `src/prompts/system.ts`

## Cumulative Impact

| Metric | Before | After |
|--------|--------|-------|
| Server startup | ~2s sequential | ~500ms parallel |
| Typical tool rounds | 3-5 | 0-2 |
| Common first round (read_file) | Always needed | Eliminated |
| Redundant diff fetch | 2x | 1x |
| Per-server spawn overhead | ~1-2s (npx) | ~0ms (direct) |
| Process ready wait | 100ms fixed | Event-driven |
| Total review time (typical) | 30-60s+ | 8-15s |

## Consequences

- Faster reviews improve developer experience and make the tool practical for pre-commit hooks
- `MAX_TOOL_ROUNDS` cap means the LLM cannot do deep exploration; this is intentional for speed
- Pre-loaded file contents increase the initial prompt size but eliminate a round trip
- Tool result cache has no TTL — this is fine because each review session is short-lived
- The caching strategy assumes file content doesn't change during a review (valid for commit-based reviews)
