import type {
  LanguageModel,
  JSONValue,
  UserModelMessage,
  AssistantModelMessage,
  ToolModelMessage,
} from "ai";
import { z } from "zod";

// Copy from ai sdk since it doesn't export these types but we need them.
export type JSONObject = { [key: string]: JSONValue | undefined };
export type JSONArray = JSONValue[];

export type AgentMessage =
  | UserModelMessage
  | AssistantModelMessage
  | ToolModelMessage;

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
  title: string;
  description: string;
  inputSchema?: I;
  outputSchema?: O;
  execute: (
    input: I extends z.ZodTypeAny ? z.infer<I> : unknown,
    abortSignal: AbortSignal,
  ) => Promise<O extends z.ZodTypeAny ? z.infer<O> : unknown>;
}

export type AgentEventListener = (e: AgentEvent) => void;
export enum AgentEvent {
  // Agent lifecycle.
  AGENT_START = "agent_start",
  AGENT_END = "agent_end",

  // Turn lifecycle - a turn is one assistant response + any tool calls/results.
  TURN_START = "turn_start",
  TURN_END = "turn_end",

  // Message lifecycle - emitted for user, assistant, and tool messages.
  MESSAGE = "message_start",
  // Only emitted for assistant messages during streaming.
  MESSAGE_UPDATE = "message_update",
  MESSAGE_END = "message_end",

  // Tool execution lifecycle.
  TOOL_EXECUTION_START = "tool_execution_start",
  // Only emitted when there are more than 1 tool calls in a turn.
  TOOL_EXECUTION_UPDATE = "tool_execution_update",
  TOOL_EXECUTION_END = "tool_execution_end",
}
