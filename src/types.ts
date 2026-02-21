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
  AGENT_START = "agent-start",
  AGENT_END = "agent-end",

  TURN_START = "turn-start",
  TURN_FINISH = "turn-finish",
  TURN_ERROR = "turn-error",
  TURN_ABORT = "turn-abort",

  REASONING_START = "reasoning-start",
  REASONING_DELTA = "reasoning-delta",
  REASONING_END = "reasoning-end",

  TEXT_START = "text-start",
  TEXT_DELTA = "text-delta",
  TEXT_END = "text-end",

  TOOL_CALL = "tool-call",
  TOOL_RESULT = "tool-result",
  TOOL_ERROR = "tool-error",
}

export interface AgentEvent {
  type: AgentEventType;
  part?: TextStreamPart<ToolSet>;
}

export type AgentEventListener = (e: AgentEvent) => void;
