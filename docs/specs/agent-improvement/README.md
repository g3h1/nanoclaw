# Agent Improvement Loops — Design Spec

This folder captures a design discussion about how a NanoClaw agent could improve over time. It is a **future-project spec**, not an implementation. None of the loops described here are built yet.

## The Question

Can NanoClaw learn and optimise itself?

## The Honest Answer

It is **self-modifiable**, not **self-improving**.

Agents already have several real ways to change themselves:

- **Persistent memory.** Every agent freely writes to `/workspace/agent/CLAUDE.local.md` and the surrounding workspace files. No approval needed. This is the only fully autonomous channel.
- **Container customisation with admin approval.** `install_packages` (apt/npm) and `add_mcp_server` are MCP tools an agent can invoke; on admin approval the image rebuilds (for packages) and the container restarts. See [`container/skills/self-customize/SKILL.md`](../../../container/skills/self-customize/SKILL.md).
- **Source-code edits via builder agents.** Agents do not edit `/app/src` directly. They `create_agent` a builder sub-agent with constrained instructions (200-line diff caps), the builder makes the change, the operator reviews.
- **Spawning specialists.** `create_agent` makes new long-lived agent groups with their own workspace, memory, and CLAUDE.md, wired bidirectionally to the parent via `agent_destinations`. See [`docs/isolation-model.md`](../../isolation-model.md) and [`src/modules/agent-to-agent/`](../../../src/modules/agent-to-agent/).

What it **cannot** do today: fine-tune the underlying model, run automatic A/B prompt rewrites, evaluate its own past responses on a schedule, or close any improvement loop without a human approver.

The three specs in this folder describe three complementary ways to close that gap — each with a human still in the loop, but with the *signal* and the *proposals* generated automatically.

## The Three Loops

### #2 — Outcome Tracking → [`outcome-tracking.feature`](outcome-tracking.feature)

**Cheapest, smallest surface, recommended starting point.** The agent labels corrections as they happen — "I tried X, the operator said do Y, topic = formatting" — into a structured workspace log. A periodic distillation pass groups recurring entries into candidate rules and surfaces them for approval. Only catches what the agent recognises live, but adds almost no overhead because the events are labelled at write time.

### #1 — Scheduled Introspection → [`scheduled-introspection.feature`](scheduled-introspection.feature)

A scheduled introspector sub-agent re-reads the subject's `conversations/` folder, looks for recurring patterns the subject did not flag in flight, and proposes CLAUDE.md additions. Heavier — it re-reads transcripts inside a token/time budget — but catches subtleties the agent missed in the moment.

### #3 — Eval Harness → [`eval-harness.feature`](eval-harness.feature)

A judge sub-agent grades the subject against a held-out task corpus on a schedule (or on demand). Produces a numeric pass rate, surfaces regressions against a baseline, and clusters failures into themes that drive proposed CLAUDE.md edits. The only loop that gives you a quantitative quality signal — but needs a corpus you trust, and judge bias is a real concern (same model grading itself is a known weak signal; mitigations include a different model, multi-judge quorum, or operator spot-checks).

## Comparison

| | Trigger | Reads | Produces | Cost | Catches |
|---|---|---|---|---|---|
| **#2 Outcome tracking** | In the moment + scheduled distillation | A structured log the agent maintains | Candidate rules | Low (events already labelled) | Recurring corrections the agent did notice |
| **#1 Scheduled introspection** | Scheduled | Full transcripts in the review window | CLAUDE.md proposals | High (re-reads transcripts) | Subtle patterns the agent missed live |
| **#3 Eval harness** | Scheduled + on-demand | A held-out task corpus | Pass rate, regressions, themed proposals | Medium-to-high (full agent runs) | Quality drift and regressions |

These are complementary, not alternatives.

## Recommended Sequencing

1. **Start with #2.** Smallest delta. A workspace file convention, an in-the-moment classification heuristic, one MCP tool for distillation, and the existing approval primitive. Surfaces real value within a handful of conversations.
2. **Layer #1 once transcripts accumulate.** Once the `conversations/` folder has weeks of material, a scheduled re-read starts paying off.
3. **Add #3 once a trusted task corpus exists.** Without a corpus the operator believes in, the harness produces noise. Build the corpus by hand from real failures captured by #2.

## Primitives These Loops Compose On

Every "operator approves" step in every scenario maps onto **existing** approval routing — do not reinvent it.

| Primitive | File | Role |
|-----------|------|------|
| `create_agent` MCP tool | [`container/agent-runner/src/mcp-tools/agents.ts`](../../../container/agent-runner/src/mcp-tools/agents.ts) | Spawns the introspector / judge / distiller sub-agents |
| Agent-to-agent module | [`src/modules/agent-to-agent/`](../../../src/modules/agent-to-agent/) | Routing + ACLs between subject and sub-agents |
| Builder-agent pattern | [`container/skills/self-customize/SKILL.md`](../../../container/skills/self-customize/SKILL.md) | Applies approved CLAUDE.md edits with diff-size caps |
| Approval primitive | [`src/modules/approvals/primitive.ts`](../../../src/modules/approvals/primitive.ts) | Routes every approve/reject step to the right human |
| Self-mod tier 1 | [`src/modules/self-mod/`](../../../src/modules/self-mod/) | Existing approved-change pipeline these loops would extend |
| `/schedule` skill | host-side scheduling | Drives recurring passes (introspection, distillation, eval) |
| `/loop` skill | host-side scheduling | Alternative scheduler for tighter cadences |

## Out of Scope / Open Questions

These are deliberately not addressed in the scenarios — they are judgment calls a future implementer must make:

- **Cost caps.** A nightly eval over hundreds of tasks adds up. Per-pass token and time budgets need real numbers.
- **Judge bias.** Same model grading itself is a known weak signal. Mitigations (different model, quorum, periodic operator spot-checks) are design choices.
- **Corpus rot.** Tasks the agent has effectively memorised stop being held-out. Detection (response-length plateau? perfect scores for N passes? human spot-check?) is not specified.
- **Pre-approved rule categories.** Whether the operator can pre-approve narrow categories (e.g., formatting preferences) for auto-application, or whether every rule always requires explicit approval, is left open. The default in the scenarios is "always approve" — by design.
- **Settled-rule retirement.** When a rule has been in effect a long time with no supporting or contradicting evidence, should it be archived? Reverified? Just left in place? `outcome-tracking.feature` settles on "marked settled and excluded from review" but does not specify retirement.
- **Cross-agent learning.** Whether rules learned in one agent group can be promoted to others (carefully, given the privacy boundary) is not addressed. Probably should not be, but worth a future spec.

## What This Spec Is Not

- Not a roadmap. No commitment that any of these will ship.
- Not a complete design. The Gherkin scenarios describe intended behaviour; an implementing project still needs to choose data formats, file paths, MCP tool names, and concrete thresholds.
- Not a substitute for reading the source. The primitives this design composes on (`create_agent`, agent-to-agent routing, builder agents, approvals) are real and worth understanding before implementing.
