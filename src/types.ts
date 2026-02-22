import type {
  LanguageModel,
  LanguageModelUsage,
  JSONValue,
  UserModelMessage,
  AssistantModelMessage,
  ToolModelMessage,
  FinishReason,
} from "ai";
import { z } from "zod";

// Copy from ai sdk since it doesn't export these types but we need them.
export type JSONObject = { [key: string]: JSONValue | undefined };
export type JSONArray = JSONValue[];

export interface Logger {
  trace: (id: string, name: string, msg: string) => void;
  debug: (id: string, name: string, msg: string) => void;
  info: (id: string, name: string, msg: string) => void;
  warn: (id: string, name: string, msg: string) => void;
  error: (id: string, name: string, msg: string, error?: unknown) => void;
}

export type AgentMessage = UserModelMessage | AssistantModelMessage | ToolModelMessage;

// You can either use `prompt` or `messages` but not both.
// prettier-ignore
export type AgentPrompt =
  | {
    prompt: string | AgentMessage[];
    messages?: never;
  }
  | {
    messages: AgentMessage[];
    prompt?: never;
  };

export type UpdateAgentProps = Omit<AgentProps, "id" | "name" | "model" | "logger">;
export interface AgentProps {
  id?: string;
  name?: string;
  model: LanguageModel;
  providerOptions?: Record<string, JSONObject>;
  systemPrompt?: string;
  tools?: AgentTool[];
  temperature?: number;
  topP?: number;
  topK?: number;
  logger?: Logger;
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
  TURN_STEER = "turn-steer",

  REASONING_START = "reasoning-start",
  REASONING_UPDATE = "reasoning-update",
  REASONING_END = "reasoning-end",

  TEXT_START = "text-start",
  TEXT_UPDATE = "text-update",
  TEXT_END = "text-end",

  TOOL_CALL = "tool-call",
  TOOL_RESULT = "tool-result",
  TOOL_ERROR = "tool-error",
}

export interface AgentEventMessageMap {
  [AgentEventType.AGENT_START]: undefined;
  [AgentEventType.AGENT_END]: undefined;

  [AgentEventType.TURN_START]: undefined;
  [AgentEventType.TURN_FINISH]: AssistantModelMessage;
  [AgentEventType.TURN_ERROR]: AssistantModelMessage;
  [AgentEventType.TURN_ABORT]: AssistantModelMessage;
  [AgentEventType.TURN_STEER]: AssistantModelMessage;

  [AgentEventType.REASONING_START]: AssistantModelMessage;
  [AgentEventType.REASONING_UPDATE]: AssistantModelMessage;
  [AgentEventType.REASONING_END]: AssistantModelMessage;

  [AgentEventType.TEXT_START]: AssistantModelMessage;
  [AgentEventType.TEXT_UPDATE]: AssistantModelMessage;
  [AgentEventType.TEXT_END]: AssistantModelMessage;

  [AgentEventType.TOOL_CALL]: AssistantModelMessage;
  [AgentEventType.TOOL_RESULT]: ToolModelMessage;
  [AgentEventType.TOOL_ERROR]: ToolModelMessage;
}

export type BaseAgentEvent<T extends AgentEventType> = {
  agentId: string;
  type: T;
  message: AgentEventMessageMap[T];
};

export type TurnFinishEvent = BaseAgentEvent<AgentEventType.TURN_FINISH> & {
  finishReason?: FinishReason;
  totalUsage?: LanguageModelUsage;
};

export type TurnErrorEvent = BaseAgentEvent<AgentEventType.TURN_ERROR> & {
  error: unknown;
};

export type TurnAbortEvent = BaseAgentEvent<AgentEventType.TURN_ABORT> & {
  reason?: string;
};

export type TurnSteerEvent = BaseAgentEvent<AgentEventType.TURN_STEER> & {
  prompt: AgentPrompt;
};

// prettier-ignore
export type AgentEvent<T extends AgentEventType = AgentEventType> =
  T extends AgentEventType.TURN_FINISH
  ? TurnFinishEvent
  : T extends AgentEventType.TURN_ERROR
  ? TurnErrorEvent
  : T extends AgentEventType.TURN_ABORT
  ? TurnAbortEvent
  : T extends AgentEventType.TURN_STEER
  ? TurnSteerEvent
  : BaseAgentEvent<T>;

export type AgentEventListener = (e: AgentEvent) => void;
