import { createGoogleGenerativeAI } from "@ai-sdk/google";

import Agent from "@/Agent";
import logger from "./logger";

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const agent = new Agent({
  name: "test",
  model: google("gemini-3-flash-preview"),
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
  prompt: "Does a list of all lists that do not contain themselves contain itself?",
});

await agent.waitForIdle();
unsubscribe();
