import { createGoogleGenerativeAI } from "@ai-sdk/google";

import Agent from "@/Agent";
import logger from "./logger";

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const agent = new Agent({
  model: google("gemini-3-flash-preview"),
  logger,
});

const unsubscribe = agent.subscribe((message) => {
  logger.info(agent.id, agent.name, `subscribe, message=${JSON.stringify(message)}`);
});

agent.start({
  prompt: "Does a list of all lists that do not contain themselves contain itself?",
});

await agent.waitForIdle();
unsubscribe();
