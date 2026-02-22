import { createGoogleGenerativeAI } from "@ai-sdk/google";

import Agent from "@/Agent";

const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const agent = new Agent({
  model: google("gemini-3-flash-preview"),
  debug: true,
});

const unsubscribe = agent.subscribe((message) => {
  // console.log(`onEvent, message=${JSON.stringify(message)}`);
});

agent.start({
  prompt: "What is the capital of France?",
});

await agent.waitForIdle();
unsubscribe();
