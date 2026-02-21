import type {
  LanguageModel,
  JSONValue,
  UserModelMessage,
  AssistantModelMessage,
  ToolModelMessage,
  TextStreamPart,
  ToolSet,
} from "ai";
import { z } from "zod";

// Copy from ai sdk since it doesn't export these types but we need them.
export type JSONObject = { [key: string]: JSONValue | undefined };
export type JSONArray = JSONValue[];

export type AgentMessage = UserModelMessage | AssistantModelMessage | ToolModelMessage;

// You can either use `prompt` or `messages` but not both.
// prettier-ignore
export type AgentPrompt =
  | {
    prompt: string | Array<AgentMessage>;
    messages?: never;
  }
  | {
    messages: Array<AgentMessage>;
    prompt?: never;
  };

export interface AgentProps {
  id?: string;
  name?: string;
  model: LanguageModel;
  providerOptions?: Record<string, JSONObject>;
  systemPrompt?: string;
  tools?: AgentTool[];
  debug?: boolean;
}

export interface AgentTool<
  I extends z.ZodTypeAny | undefined = undefined,
  O extends z.ZodTypeAny | undefined = undefined,
> {
  name: string;
  description: string;
  strict?: boolean;
  inputSchema?: I;
  outputSchema?: O;
  execute: (
    input: I extends z.ZodTypeAny ? z.infer<I> : unknown,
    abortSignal: AbortSignal,
  ) => Promise<O extends z.ZodTypeAny ? z.infer<O> : unknown>;
}

export enum AgentEventType {
  // Agent lifecycle.
  AGENT_START = "agent-start",
  AGENT_END = "agent-end",

  // Turn lifecycle - a turn is one assistant response + any tool calls/results.
  TURN_START = "turn-start",
  TURN_END = "turn-end",

  // Message lifecycle - emitted for user, assistant.
  MESSAGE_START = "message-start",
  // Only emitted for assistant messages during streaming.
  MESSAGE_DELTA = "message-delta",
  MESSAGE_END = "message-end",

  // Tool execution lifecycle.
  TOOL_EXECUTION_START = "tool-execution-start",
  TOOL_EXECUTION_END = "tool-execution-end",
}

export interface AgentEvent {
  type: AgentEventType;
  part?: TextStreamPart<ToolSet>;
}

export type AgentEventListener = (e: AgentEvent) => void;
