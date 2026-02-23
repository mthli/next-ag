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

// Copy from AI SDK since it doesn't export these types but we need them.
export type JSONObject = { [key: string]: JSONValue | undefined };
export type JSONArray = JSONValue[];

export interface Logger {
  trace: (log: Log) => void;
  debug: (log: Log) => void;
  info: (log: Log) => void;
  warn: (log: Log) => void;
  error: (log: Log) => void;
}

export interface Log {
  agentId: string;
  agentName: string;
  message: string;
  error?: unknown;
}

export type AgentMessage = UserModelMessage | AssistantModelMessage | ToolModelMessage;

// You can either use `prompt` or `messages` but not both.
// prettier-ignore
export type AgentPrompt =
  | {
    prompt: string;
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

  /**
   * Additional provider-specific options.
   *
   * They are passed through to the provider from the AI SDK and
   * enable provider-specific functionality that can be fully encapsulated in the provider.
   */
  providerOptions?: Record<string, JSONObject>;

  systemPrompt?: string;
  tools?: AgentTool[];

  /**
   * Temperature setting.
   * The range depends on the provider and model.
   *
   * It is recommended to set either `temperature` or `topP`, but not both.
   */
  temperature?: number;

  /**
   * Nucleus sampling.
   * This is a number between 0 and 1.
   *
   * E.g. 0.1 would mean that only tokens with the top 10% probability mass are considered.
   *
   * It is recommended to set either `temperature` or `topP`, but not both.
   */
  topP?: number;

  /**
   * Only sample from the top K options for each subsequent token.
   * Used to remove "long tail" low probability responses.
   *
   * Recommended for advanced use cases only.
   * You usually only need to use `temperature`.
   */
  topK?: number;

  // Default is "fifo", which means the agent will only process one steering message per turn.
  steeringMode?: SteeringMode;

  // Default is "fifo", which means the agent will only process one follow-up message per turn.
  followUpMode?: FollowUpMode;

  // Optional logger to log agent events and messages.
  logger?: Logger;
}

export interface AgentTool<
  I extends z.ZodTypeAny = z.ZodTypeAny,
  O extends z.ZodTypeAny = z.ZodTypeAny,
> {
  // Unique name of the tool, used to call the tool by the language model.
  name: string;

  // Will be used by the language model to decide whether to use the tool.
  description: string;

  /**
   * Strict mode setting for the tool.
   * Providers that support strict mode will use this setting to determine how the input should be generated.
   * Strict mode will always produce valid inputs, but it might limit what input schemas are supported.
   */
  strict?: boolean;

  inputSchema?: I;
  outputSchema?: O;
  execute: (
    input: z.infer<I>,
    abortSignal: AbortSignal,
  ) => AsyncIterable<z.infer<O>> | PromiseLike<z.infer<O>> | z.infer<O>;
}

// This is a helper function to create an AgentTool with proper typings.
export const createAgentTool = <
  I extends z.ZodTypeAny = z.ZodTypeAny,
  O extends z.ZodTypeAny = z.ZodTypeAny,
>(
  tool: AgentTool<I, O>,
): AgentTool<I, O> => tool;

export enum SteeringMode {
  FIFO = "fifo", // one per turn (default).
  ALL = "all", // send all steering messages at once.
}

export enum FollowUpMode {
  FIFO = "fifo", // one per turn (default).
  ALL = "all", // send all follow-up messages at once.
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

export type BaseAgentEvent<T extends AgentEventType> = {
  agentId: string;
  agentName: string;
  type: T;
  message: AgentEventMessageMap[T];
};

export interface AgentEventMessageMap {
  [AgentEventType.AGENT_START]: undefined;
  [AgentEventType.AGENT_END]: undefined;

  [AgentEventType.TURN_START]: undefined;
  [AgentEventType.TURN_FINISH]: AssistantModelMessage;
  [AgentEventType.TURN_ERROR]: AssistantModelMessage | undefined;
  [AgentEventType.TURN_ABORT]: AssistantModelMessage | undefined;
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

export type TurnStartEvent = BaseAgentEvent<AgentEventType.TURN_START> & {
  startReason: TurnStartReason;
  prompts: AgentPrompt[];
};

export enum TurnStartReason {
  START = "start",
  RECOVER = "recover",
  STEER = "steer",
  FOLLOW_UP = "follow-up",
}

export type TurnFinishEvent = BaseAgentEvent<AgentEventType.TURN_FINISH> & {
  finishReason: FinishReason;
  totalUsage: LanguageModelUsage;
};

export type TurnErrorEvent = BaseAgentEvent<AgentEventType.TURN_ERROR> & {
  error: unknown;
};

export type TurnAbortEvent = BaseAgentEvent<AgentEventType.TURN_ABORT> & {
  reason?: string;
};

// prettier-ignore
export type AgentEvent<T extends AgentEventType = AgentEventType> =
  T extends AgentEventType.TURN_START
  ? TurnStartEvent
  : T extends AgentEventType.TURN_FINISH
  ? TurnFinishEvent
  : T extends AgentEventType.TURN_ERROR
  ? TurnErrorEvent
  : T extends AgentEventType.TURN_ABORT
  ? TurnAbortEvent
  : BaseAgentEvent<T>;

export type AgentEventListener = (e: AgentEvent) => void;
