# next-ag

Next Tiny AI Agents Framework 🪩

Based on [Vercel AI SDK](https://ai-sdk.dev/), inspired by the implementation of [pi-agent-core](https://github.com/badlogic/pi-mono/tree/main/packages/agent).

## Package

TODO

## Motivation

There are some reasons why Pi's author Mario Zechner doesn't build Pi on top of the Vercel AI SDK, [read this blog](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/) if you're interested.

But for someone who wants to implement a tiny agent framework, the Vercel AI SDK is still a good start, as it provides a unified LLM API with multi-provider support, has excellent documentation, and integrates effortlessly with the Vercel ecosystem, such as [Next.js](https://nextjs.org/).

And why not use the Vercel AI SDK's [ToolLoopAgent](https://ai-sdk.dev/docs/agents/building-agents#why-use-the-toolloopagent-class)? Because it lacks control methods such as steer and follow-up, and its lifecycle callbacks are subject to breaking changes in incremental package releases.

We can see how far we can push this before running into the same issues Mario Zechner did 🏃

## License

```text
MIT License

Copyright (c) 2026 Matthew Lee
```
