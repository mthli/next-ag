# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository

next-ag is a tiny AI agents framework built on the Vercel AI SDK, inspired by [pi-agent-core](https://github.com/badlogic/pi-mono/tree/main/packages/agent). It exists because `ToolLoopAgent` from the AI SDK lacks steer/follow-up control and has unstable lifecycle callbacks across minor versions.

Bun monorepo with two workspaces under `packages/`:

- `@next-ag/core` — the published runtime (`packages/core`)
- `@next-ag/test` — private integration runner, not a unit-test suite (`packages/test`)

## Commands

```bash
bun install                            # install all workspaces

# Build the published package (emits ./packages/core/dist via bun build + tsc for .d.ts)
bun --filter @next-ag/core run build
bun --filter @next-ag/core run clean   # rimraf dist

# Run the integration example (requires GEMINI_API_KEY in env)
GEMINI_API_KEY=... bun packages/test/src/index.ts
```

There is **no test framework** — `@next-ag/test` is a manual smoke script that drives a real Gemini call. Don't add `bun test` invocations expecting it to find suites.

Lint/format runs through husky + lint-staged on commit (`prettier --write` on staged files). ESLint config is at `eslint.config.ts` but is not wired to a script — run via `bunx eslint .` if needed.

## Architecture

The whole framework is essentially one class: `packages/core/src/Agent.ts` (~900 lines). Read it together with `types.ts` — the event/prompt/mode enums there define the public surface.

### Session → turn → stream

A **session** runs from `start()`/`recover()` until all pending prompts and tool-call follow-ups drain. Inside a session, each call to `streamText` is a **turn**. The `loop()` method owns the outer iteration; `run()` builds the AI SDK call.

Context is a single `AgentMessage[]` mutated in place as stream parts arrive. The assistant message for the current turn (`turnMessage`) is appended once on the first relevant part (`reasoning-start` / `text-start` / `tool-call`) and then mutated by subsequent deltas — every other branch must check `Array.isArray(turnMessage.content)` before pushing.

### Three input queues

- `start(prompt)` — only valid when idle. Clears both queues, seeds the loop.
- `steer(prompt)` — valid only while running. Pushed onto `steeringPrompts`. On the next `finish-step`, the loop calls `abortController.abort(ABORT_REASON_STEER)` to cut the current stream short. The `abort` stream part recognizes that reserved reason and dequeues steering prompts for the next turn instead of treating it as a user abort. **Never pass `ABORT_REASON_STEER` to `abort()`** — it throws.
- `followUp(prompt)` — queued for after the current turn finishes normally.

`SteeringMode` / `FollowUpMode` (FIFO vs ALL) control whether `dequeue*Prompts()` returns one or all queued prompts per turn.

### Tool-call follow-through

When a turn finishes with `finishReason === "tool-calls"`, `loop()` sets `forceToNextTurn = true` and re-enters with the tool-result message already pushed into context. This is what `61c881f fix: send tool result back to model in next turn` patched — don't regress it. The corresponding `TurnStartReason` is `TOOL_CALLS`.

### Recovery rules (`recover()`)

The branching in `recover()` depends on `lastTurnFinishReason` and the last context message:

- last role isn't `assistant` OR last reason was `tool-calls` → retry as-is.
- last reason wasn't `stop` (e.g. `length`, `content-filter`) → pop the last assistant message and retry.
- otherwise drain steering, then follow-up.

If you change the recovery branches, update the comment block at lines ~233–290 — the logic is subtle enough that the inline reasoning is load-bearing.

### updateProps mid-flight

`updateProps()` mutates fields directly only at safe stages (idle, session boundaries, turn boundaries). At any other stage it stashes into `pendingProps` and the loop applies it at the top of the next iteration. Use `props.hasOwnProperty(key)` checks so callers can explicitly set a field to `undefined` to clear it — don't switch to truthy checks.

### Tools

`AgentTool` is the user-facing shape; `createAgentTool` is just an identity helper for inference. At `run()` time the array is converted to an AI SDK `ToolSet` keyed by `name`, with `execute` wrapped to forward the agent's abort signal when the SDK doesn't supply one.

### Events

`subscribe(listener)` returns an unsubscribe function. Every emit goes through `emit()`, which also stamps `currentStage` — that field gates `updateProps` and the post-loop tool-call check, so any new event type must be emitted via `emit()`, never directly.

The full event order is documented in `packages/core/README.md` ("Event Flow" section). Keep that in sync with `AgentEventType` if you add events.

## Conventions

- ESM only (`"type": "module"`), Bun-style imports without `.js` extensions in source — the `bun build` step resolves them.
- Strict TS with `noUncheckedIndexedAccess` and `verbatimModuleSyntax` — use `import type` for type-only imports.
- The codebase uses `// FIXME (matthew) ...` markers for known AI SDK quirks (e.g. unexported `ReasoningPart`, Gemini 3 tool-call bug). Leave them in place when touching nearby code unless the upstream issue is resolved.
