# @next-ag/core

Next Tiny AI Agents Framework 🪩

Based on [Vercel AI SDK](https://ai-sdk.dev/), inspired by the implementation of [pi-agent-core](https://github.com/badlogic/pi-mono/tree/main/packages/agent).

## Installation

First install packages below,

```bash
npm i @next-ag/core
npm i zod
```

If you want to use the [AI Gateway](https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway), then you don't need to install anything else.

If you want to use self API keys, then you need to install the specific provider, e.g. google,

```bash
# https://ai-sdk.dev/docs/getting-started/choosing-a-provider
npm i @ai-sdk/google
```

## Quick Start

```ts
import { Agent, createAgentTool } from "@next-ag/core";
import { google } from "@ai-sdk/google";
import { z } from "zod";

const weather = createAgentTool({
  name: "weather",
  description: "Get the weather in a location.",
  inputSchema: z.object({
    location: z.string().describe("The location to get the weather for."),
  }),
  outputSchema: z.object({
    location: z.string(),
    temperature: z.number(),
  }),
  execute: async ({ location }, _abortSignal) => ({
    location,
    temperature: 72 + Math.floor(Math.random() * 21) - 10,
  }),
});

// The full Agent props and methods can be found in
// https://github.com/mthli/next-ag/blob/master/packages/core/src/Agent.ts
const agent = new Agent({
  model: google("gemini-3-flash-preview"),
  tools: [weather],
  // ...props
});

// Subscribe to agent events.
// https://github.com/mthli/next-ag/blob/master/packages/core/src/types.ts
const unsubscribe = agent.subscribe((event) => {
  console.log(event);
});

// Start a new session with given prompt.
agent.start({
  prompt: "What is the weather in San Francisco?",
});

// Steer current session with given prompt.
agent.steer({
  prompt: "Actually, I want to know the weather in New York.",
});

// Add follow-up prompt for next turn.
agent.followUp({
  prompt: "What about the weather in Los Angeles?",
});

await agent.waitForIdle();
unsubscribe();
```

Fully example can be found in [packages/test/src/index.ts](https://github.com/mthli/next-ag/blob/master/packages/test/src/index.ts)

## Core Concepts

TODO

## License

```text
MIT License

Copyright (c) 2026 Matthew Lee
```
