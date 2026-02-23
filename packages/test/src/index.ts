import { createGoogleGenerativeAI, type GoogleLanguageModelOptions } from "@ai-sdk/google";
import { z } from "zod";

import { Agent, createAgentTool } from "@next-ag/core";
import logger from "./logger";

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
});

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

const agent = new Agent({
  id: "test",
  model: google("gemini-3-flash-preview"),
  providerOptions: {
    google: {
      thinkingConfig: {
        thinkingLevel: "high",
        includeThoughts: true,
      },
    } satisfies GoogleLanguageModelOptions,
  },
  tools: [weather],
  logger,
});

const unsubscribe = agent.subscribe((message) => {
  const { agentId } = message;
  logger.info({
    agentId,
    message: `subscribe, message=${JSON.stringify(message)}`,
  });
});

// First execute.
agent.start({
  prompt: "What is the weather in San Francisco?",
});

// Should be third execute.
agent.followUp({
  prompt: "What about the weather in Los Angeles?",
});

// Should be second execute.
agent.steer({
  prompt: "Actually, I want to know the weather in New York.",
});

await agent.waitForIdle();
unsubscribe();
