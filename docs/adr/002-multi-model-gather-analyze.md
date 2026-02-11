# ADR-002: Multi-Model Gather/Analyze Strategy

**Status:** Accepted
**Date:** 2026-02-10
**Author:** Ethan Smith

## Context

The initial implementation of `mcp-git-reviewer` used a single LLM for the entire review conversation — context gathering and analysis in one continuous loop. This produced acceptable results for small commits but had critical performance and cost issues at scale:

- **Performance:** A 3-round review on a larger commit took 5–8 minutes, which is unacceptable for a CLI tool meant to fit into a developer's natural workflow. The target is under 30 seconds for typical commits.
- **Cost:** Running a high-quality model for every round is expensive. Most of the token budget is spent on gathering rounds where the model is making simple decisions ("read this file," "find importers of X") — work that doesn't require frontier-level intelligence.
- **Coupling:** The single-model approach made it impossible to optimize gathering and analysis independently. Capping `MAX_TOOL_ROUNDS` at 2 to control latency artificially limited the agent's ability to gather sufficient context.

Profiling with the existing `timer()` utility confirmed that 80%+ of wall time was spent in LLM API calls, and that input token count grew significantly each round as tool results accumulated in the message history.

---

## Decisions

### Decision 1: Two-Phase Gather/Analyze with Separate Models

**Split the conversation into a gather phase and an analysis phase, each with its own model and system prompt. The gather model never writes the review.**

The conversation loop is split into two structurally distinct phases:

| Phase | Default Model | Upgrade Path | Optimized For |
|-------|---------------|--------------|---------------|
| Gather | Qwen3-Coder (via OpenAI-compatible API) | DeepSeek V3.2 if tool-call quality is insufficient | Tool-call decisions, low latency |
| Analyze | Claude Haiku 4.5 ($1/$5 per M tokens) | Claude Sonnet 4.5 if review quality is insufficient | Code understanding, structured output |

This is a structural boundary, not just a model swap. The gather model's system prompt explicitly prohibits producing review output:

```
You are a code review context gatherer. Your job is to examine the diff 
and use tools to collect all context needed for a thorough review.

When you have sufficient context, respond with exactly:
<gather_complete>
Brief summary of what you found and why you believe you have enough context.
</gather_complete>

Do NOT write the review yourself. Only gather context.
```

The analysis model receives a **flattened prompt** containing the diff and all gathered tool results — not the raw conversation history from the gather phase.

**Why these defaults:**
- Qwen3-Coder is free via the OpenAI-compatible API, making it the most cost-effective option for gathering rounds where the model mostly decides which tools to invoke. It doesn't need to produce brilliant prose — just good tool-call decisions. If tool-call quality proves insufficient, DeepSeek V3.2 ($0.25/$0.38 per M tokens) is the planned fallback.
- Haiku 4.5 delivers near-Sonnet quality at 1/3 the cost. The analysis phase is a single call, so even upgrading to Sonnet 4.5 ($3/$15 per M tokens) has minimal impact on total cost if review quality needs improvement.
- Kimi K2.5 was considered for gathering but rejected: reports indicate it uses ~3x the tokens of comparable models for equivalent tasks, which compounds latency rather than reducing it.

**Why flatten at the handoff:**
- The analysis model didn't generate the gather model's assistant messages. Passing foreign conversation history can confuse models or cause format mismatches.
- Tool call/result message formats differ between providers. Flattening normalizes this.
- Decouples the two models completely — they can be from different providers with different APIs.
- Enables testing: snapshot the flattened prompt, run different analysis models against identical inputs.

**Why not let the gather model write the review if it has enough context:**
- The gather model is selected for speed and cost, not review quality. Letting it produce the review defeats the purpose.
- Separating concerns makes the system easier to reason about. The gather model has one job; the analysis model has one job.

**Alternatives considered:**
- *Single model, fewer rounds:* This is the status quo (`MAX_TOOL_ROUNDS = 2`). It controls latency but artificially limits context quality.
- *Single cheap model for everything:* Gathering quality is fine, but review quality drops noticeably. The analysis phase is where model capability matters most.
- *Compress tool results between rounds:* Rejected. Compressing with an LLM call adds latency to reduce latency. Compressing with heuristics risks removing context the analysis model needs. The right place to control context size is at the tool response level.

### Decision 2: Semantic Termination with Safety Ceiling

**The gather model signals completion explicitly. `MAX_TOOL_ROUNDS` is a safety net, not the expected exit path.**

The previous implementation capped `MAX_TOOL_ROUNDS` at 2 and dropped tools at the limit to force a response. This was a blunt instrument — some reviews need 1 round, others need 4.

New termination strategy (in priority order):

1. **Semantic termination** — the gather model emits `<gather_complete>` when it decides it has sufficient context. This is the primary and expected exit path.
2. **Implicit completion** — the gather model returns `end_turn` without requesting tools or signaling. Treated as implicit completion.
3. **Safety ceiling** — `MAX_TOOL_ROUNDS` (increased from 2 to 5) is reached. The loop exits with a warning that the review may be based on incomplete context.

**Why increase MAX_TOOL_ROUNDS to 5:**
- With a cheap/free gather model, each round has minimal cost impact. The constraint that justified limiting to 2 rounds (single expensive model) no longer applies.
- Real reviews often benefit from 3–4 rounds: round 1 reads conventions, round 2 traces dependencies, round 3 checks test coverage, round 4 follows up on something unexpected.
- The semantic termination signal means most reviews self-exit in 2–3 rounds naturally. The ceiling of 5 exists for complex commits that genuinely need more exploration.

### Decision 3: ReAct-Style Reasoning Trace

**Extract and log the gather model's reasoning alongside its tool calls.**

Most LLMs emit text content alongside tool_use blocks — this text represents the model's reasoning about what context it needs and why. The system captures this as a structured trace:

```typescript
interface AgentTurn {
  round: number;
  thought: string;       // extracted text blocks (best-effort)
  toolsCalled: string[];
  timestamp: number;
  durationMs: number;
}
```

The system prompt includes a nudge to encourage reasoning output: "Before each tool request, briefly state what you're looking for and why." This works across most models.

**Why this matters:**
- `--verbose` mode shows users *why* the agent is gathering specific context, not just which tools it's calling.
- Debugging: when the agent makes poor tool choices or gathers irrelevant context, the reasoning trace explains why.
- The `<gather_complete>` summary becomes the final trace entry, documenting the agent's confidence in its gathered context.
- Demonstrates understanding of agentic patterns (relevant for portfolio/interview context).

**Limitation:** This is best-effort. Some models (particularly in thinking mode) put reasoning in separate `<think>` tags rather than inline text blocks. The system degrades gracefully — if no text is found, the trace simply logs the tool calls without a thought.

### Decision 4: Graceful Tool Failure with `Promise.allSettled`

**Individual tool failures should not abort the entire gathering round.**

The previous implementation used `Promise.all` for parallel tool execution, meaning one failing tool (e.g., a deleted file, a permission error) would reject the entire batch.

Switching to `Promise.allSettled` means:
- Successful tools return their results normally.
- Failed tools return an error message as the tool result.
- The gather model sees both successes and failures, and can reason about what to do — retry with different parameters, skip the failed context, or proceed with partial information.

This is the standard pattern in production agentic systems and reflects how real developer tools need to handle messy environments (files that don't exist, git operations that fail, permissions issues).

### Decision 5: Preloading Expansion

**Pre-execute predictable tool calls before the conversation loop begins.**

The existing preloading of changed file contents already eliminates the most common first-round tool call. This decision extends the pattern:

- Continue preloading changed file contents (existing behavior)
- Consider preloading conventions/lint config, since the gather model almost always requests these in round 1
- Skip all preloading when the diff is truncated (existing behavior, prevents exceeding context limits)

**What we explicitly do not do:**
- Preload *everything* — the point of the gather phase is to let the model decide what's relevant. Over-preloading wastes tokens on context the model doesn't need.
- Predict tool calls based on diff analysis — this adds complexity and is fragile. The LLM is better at deciding what context it needs than our heuristics would be.

---

## Consequences

### Positive
- **Performance:** Separating gather and analysis phases allows the gather model to run more rounds without the latency penalty of a heavy analysis model, targeting typical reviews under 60 seconds.
- **Cost:** Qwen3-Coder is free for gathering. Even if upgrading to DeepSeek V3.2, estimated cost is ~$0.44 per review (3 gather rounds + 1 Haiku analysis) vs. ~$4–5 per review running everything on Sonnet.
- **Quality:** The analysis model gets more context (5 rounds of gathering vs. 2) and is a model selected for review quality rather than speed.
- **Flexibility:** Users can configure their own model preferences via CLI flags or config file.
- **Observability:** Structured reasoning traces make the system debuggable and demonstrate understanding of agentic patterns.

### Negative
- **Complexity:** Two models, two system prompts, a flattening layer, and a provider abstraction add architectural complexity.
- **Provider dependency:** Requires API access to two different providers (or two models from the same provider). Users need API keys for both.
- **Message format normalization:** Different providers format tool calls differently. The flattening approach mitigates this but may lose some structural information.

### Risks
- **Gather model quality:** If Qwen3-Coder makes poor tool-call decisions, the analysis model gets bad context and produces a bad review. Mitigation: DeepSeek V3.2 is the planned fallback, the reasoning trace makes bad decisions visible, and the model is configurable.
- **Format drift:** Provider APIs evolve. The provider abstraction layer needs maintenance. Mitigation: Qwen, DeepSeek, and Claude all support OpenAI-compatible API formats.
- **Semantic termination reliability:** The gather model might signal `<gather_complete>` too early or fail to signal at all. Mitigation: the safety ceiling catches runaway loops, and implicit completion handles models that don't follow the signal format.

---

## Implementation Priority

1. **Performance instrumentation** — Add per-round timing and token count logging to validate assumptions before investing in the full refactor.
2. **Provider abstraction** — Build the multi-provider interface. Qwen, DeepSeek, and Claude all support OpenAI-compatible APIs, so this should be thin.
3. **Multi-model conversation loop** — Implement the gather/analyze split with model switching.
4. **Semantic termination** — Update the gather system prompt and add `<gather_complete>` parsing.
5. **ReAct trace** — Extract thoughts, build structured trace, wire up `--verbose`.
6. **Error handling** — Switch to `Promise.allSettled`.
7. **Preloading expansion** — Add conventions/lint config preloading.
8. **Documentation** — Update ARCHITECTURE.md and README with the new strategy.
