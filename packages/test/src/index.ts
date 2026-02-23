import { createGoogleGenerativeAI, type GoogleLanguageModelOptions } from "@ai-sdk/google";
import { z } from "zod";

import { Agent, type AgentTool } from "@next-ag/core";
import logger from "./logger";

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const weather: AgentTool = {
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
};

const agent = new Agent({
  name: "test",
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
  const { agentId, agentName } = message;
  logger.info({
    agentId,
    agentName,
    message: `subscribe, message=${JSON.stringify(message)}`,
  });
});

agent.start({
  prompt: "What is the weather in San Francisco?",
});

await agent.waitForIdle();
unsubscribe();
