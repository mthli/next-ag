import {
  streamText,
  type AsyncIterableStream,
  type LanguageModel,
  type TextPart,
  type TextStreamPart,
  type ToolCallPart,
  type ToolResultPart,
  type UserModelMessage,
  type AssistantModelMessage,
  type ToolModelMessage,
  type ToolSet,
} from "ai";
import { nanoid } from "nanoid";
import { serializeError } from "serialize-error";
import { z } from "zod";

import {
  AgentEventType,
  type AgentEvent,
  type AgentEventListener,
  type AgentMessage,
  type AgentPrompt,
  type AgentProps,
  type UpdateAgentProps,
  type AgentTool,
  type JSONObject,
  type Logger,
} from "./types";

// Avoid outter code calling abort() with this reason.
const ABORT_REASON_STEER = "__steer__";

enum LogLevel {
  TRACE = "trace",
  DEBUG = "debug",
  INFO = "info",
  WARN = "warn",
  ERROR = "error",
}

class Agent {
  private id: string;
  private name: string;
  private model: LanguageModel;
  private providerOptions?: Record<string, JSONObject>;
  private systemPrompt?: string;
  private tools?: AgentTool[];
  private temperature?: number;
  private topP?: number;
  private topK?: number;
  private logger?: Logger;

  private steeringPrompts: AgentPrompt[] = [];
  private followUpPrompts: AgentPrompt[] = [];
  private context: AgentMessage[] = [];

  private abortController = new AbortController();
  private listeners = new Set<AgentEventListener>();
  private currentStage?: AgentEventType;
  private pendingProps?: UpdateAgentProps;
  private runningPromise?: Promise<void>;
  private runningResolver?: () => void;

  constructor(props: AgentProps) {
    const { id, name, model, logger } = props;
    this.id = id ?? nanoid(10);
    this.name = name ?? "anonymous";
    this.model = model;
    this.logger = logger;
    this.updateProps(props);
  }

  // Incremental update.
  public updateProps(props: UpdateAgentProps) {
    const validStages = [
      undefined, // initial stage, no event emitted yet.
      AgentEventType.AGENT_START,
      AgentEventType.AGENT_END,
      AgentEventType.TURN_FINISH,
      AgentEventType.TURN_ERROR,
      AgentEventType.TURN_ABORT,
      AgentEventType.TURN_STEER,
    ];

    if (this.isRunning() && !validStages.includes(this.currentStage)) {
      this.logger?.info(this.id, this.name, "updateProps, pending until next turn");
      this.pendingProps = {
        ...(this.pendingProps ?? {}),
        ...props,
      }; // merge + copy.
      return;
    }

    if (props.hasOwnProperty("providerOptions")) {
      const str = JSON.stringify(props.providerOptions);
      this.logger?.info(this.id, this.name, `updateProps, providerOptions=${str}`);
      this.providerOptions = props.providerOptions ? { ...props.providerOptions } : undefined; // copy.
    }

    if (props.hasOwnProperty("systemPrompt")) {
      this.logger?.info(this.id, this.name, `updateProps, systemPrompt=${props.systemPrompt}`);
      this.systemPrompt = props.systemPrompt;
    }

    if (props.hasOwnProperty("tools")) {
      const str = JSON.stringify(props.tools);
      this.logger?.info(this.id, this.name, `updateProps, tools=${str}`);
      this.tools = props.tools ? [...props.tools] : undefined; // copy.
    }

    if (props.hasOwnProperty("temperature")) {
      this.logger?.info(this.id, this.name, `updateProps, temperature=${props.temperature}`);
      this.temperature = props.temperature;
    }

    if (props.hasOwnProperty("topP")) {
      this.logger?.info(this.id, this.name, `updateProps, topP=${props.topP}`);
      this.topP = props.topP;
    }

    if (props.hasOwnProperty("topK")) {
      this.logger?.info(this.id, this.name, `updateProps, topK=${props.topK}`);
      this.topK = props.topK;
    }

    if (props.hasOwnProperty("logger")) {
      this.logger?.info(this.id, this.name, `updateProps, logger=${props.logger}`);
      this.logger = props.logger;
    }

    this.pendingProps = undefined; // clear.
  }

  public start(prompt: AgentPrompt): boolean {
    this.logger?.info(this.id, this.name, `start, prompt=${JSON.stringify(prompt)}`);

    if (this.isRunning()) {
      this.logger?.warn(this.id, this.name, "start, skipped, waitForIdle() or abort() first");
      return false;
    }

    this.abortController = new AbortController();
    this.runningPromise = new Promise((resolve) => (this.runningResolver = resolve));
    this.loop(prompt);

    return true;
  }

  public steer(prompt: AgentPrompt): boolean {
    this.logger?.info(this.id, this.name, `steer, prompt=${JSON.stringify(prompt)}`);

    if (!this.isRunning()) {
      this.logger?.warn(this.id, this.name, "steer, skipped, use start() instead");
      return false;
    }

    this.steeringPrompts.push({ ...prompt }); // copy.
    return true;
  }

  public followUp(prompt: AgentPrompt): boolean {
    this.logger?.info(this.id, this.name, `followUp, prompt=${JSON.stringify(prompt)}`);

    if (!this.isRunning()) {
      this.logger?.warn(this.id, this.name, "followUp, skipped, use start() instead");
      return false;
    }

    this.followUpPrompts.push({ ...prompt }); // copy.
    return true;
  }

  public abort(reason?: string) {
    if (reason === ABORT_REASON_STEER) {
      // prettier-ignore
      throw new Error(`abort reason can't be "${ABORT_REASON_STEER}", which is reserved for steer()`);
    }

    this.logger?.info(this.id, this.name, `abort, reason=${reason}`);
    this.abortController.abort(reason);
    this.runningResolver?.();
    this.runningResolver = undefined;
    this.runningPromise = undefined;
  }

  public subscribe(l: AgentEventListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  public isRunning(): boolean {
    return Boolean(this.runningPromise);
  }

  public waitForIdle(): Promise<void> {
    return this.runningPromise ?? Promise.resolve();
  }

  private async loop(prompt: AgentPrompt) {
    this.emit({
      agentId: this.id,
      type: AgentEventType.AGENT_START,
      message: undefined,
    });

    let pendingPrompt: AgentPrompt | undefined = prompt;
    let turnMessage: AssistantModelMessage | undefined;

    while (pendingPrompt) {
      if (this.pendingProps) {
        this.updateProps(this.pendingProps);
        this.pendingProps = undefined;
      }

      if (pendingPrompt.messages) {
        this.context.push(...pendingPrompt.messages);
      } else if (Array.isArray(pendingPrompt.prompt)) {
        this.context.push(...pendingPrompt.prompt);
      } else {
        this.context.push({
          role: "user",
          content: pendingPrompt.prompt, // string.
        } as UserModelMessage);
      }

      const stream = await this.run({
        messages: this.context,
      });

      for await (const part of stream) {
        const partStr = JSON.stringify(part);
        this.logger?.debug(this.id, this.name, `stream, part=${partStr}`);

        // https://ai-sdk.dev/docs/ai-sdk-core/generating-text#fullstream-property
        switch (part.type) {
          case "start": {
            turnMessage = undefined;
            this.emit({
              agentId: this.id,
              type: AgentEventType.TURN_START,
              message: undefined,
            });
            break;
          }

          case "start-step": {
            // DO NOTHING.
            break;
          }

          case "reasoning-start": {
            if (!turnMessage) {
              turnMessage = {
                role: "assistant",
                content: [], // always array.
              };

              this.logger?.debug(this.id, this.name, "stream, reasoning-start, new turnMessage");
              this.context.push(turnMessage);
            }

            if (Array.isArray(turnMessage?.content)) {
              turnMessage.content.push({
                type: "reasoning",
                text: "",
              });
            } else {
              // Should not happen.
              throw new Error("reasoning-start, but content is not array");
            }

            this.emit({
              agentId: this.id,
              type: AgentEventType.REASONING_START,
              message: turnMessage,
            });

            break;
          }

          case "reasoning-delta": {
            if (Array.isArray(turnMessage?.content)) {
              const index = turnMessage.content.findLastIndex((c) => c.type === "reasoning");
              if (index >= 0) {
                // FIXME (matthew) ai sdk is not export ReasoningPart, so we use any.
                (turnMessage.content[index] as /* ReasoningPart */ any).text += part.text;
              } else {
                // Should not happen.
                throw new Error("reasoning-delta, but no reasoning found in content");
              }
            } else {
              // Should not happen.
              throw new Error("reasoning-delta, but content is not array");
            }

            this.emit({
              agentId: this.id,
              type: AgentEventType.REASONING_UPDATE,
              message: turnMessage,
            });

            break;
          }

          case "reasoning-end": {
            if (!turnMessage) {
              // Should not happen.
              throw new Error("reasoning-end, but turnMessage not exists");
            }

            this.emit({
              agentId: this.id,
              type: AgentEventType.REASONING_END,
              message: turnMessage,
            });

            break;
          }

          case "text-start": {
            if (!turnMessage) {
              turnMessage = {
                role: "assistant",
                content: [], // always array.
              };

              this.logger?.debug(this.id, this.name, "stream, text-start, new turnMessage");
              this.context.push(turnMessage);
            }

            if (Array.isArray(turnMessage?.content)) {
              turnMessage.content.push({
                type: "text",
                text: "",
              });
            } else {
              // Should not happen.
              throw new Error("text-start, but content is not array");
            }

            this.emit({
              agentId: this.id,
              type: AgentEventType.TEXT_START,
              message: turnMessage,
            });

            break;
          }

          case "text-delta": {
            if (Array.isArray(turnMessage?.content)) {
              const index = turnMessage.content.findLastIndex((c) => c.type === "text");
              if (index >= 0) {
                (turnMessage.content[index] as TextPart).text += part.text;
              } else {
                // Should not happen.
                throw new Error("text-delta, but no text found in content");
              }
            } else {
              // Should not happen.
              throw new Error("text-delta, but content is not array");
            }

            this.emit({
              agentId: this.id,
              type: AgentEventType.TEXT_UPDATE,
              message: turnMessage,
            });

            break;
          }

          case "text-end": {
            if (!turnMessage) {
              // Should not happen.
              throw new Error("text-end, but turnMessage not exists");
            }

            this.emit({
              agentId: this.id,
              type: AgentEventType.TEXT_END,
              message: turnMessage,
            });

            break;
          }

          case "tool-call": {
            if (!turnMessage) {
              turnMessage = {
                role: "assistant",
                content: [], // always array.
              };

              this.logger?.debug(this.id, this.name, "stream, tool-call, new turnMessage");
              this.context.push(turnMessage);
            }

            if (Array.isArray(turnMessage?.content)) {
              turnMessage.content.push({
                type: "tool-call",
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                input: part.input,
              } as ToolCallPart);
            } else {
              // Should not happen.
              throw new Error("tool-call, but content is not array");
            }

            this.emit({
              agentId: this.id,
              type: AgentEventType.TOOL_CALL,
              message: turnMessage,
            });

            break;
          }

          case "tool-result": {
            const message = {
              role: "tool",
              content: [
                {
                  type: "tool-result",
                  toolCallId: part.toolCallId,
                  toolName: part.toolName,
                  output: part.output,
                } as ToolResultPart,
              ],
            } as ToolModelMessage;

            this.context.push(message);
            this.emit({
              agentId: this.id,
              type: AgentEventType.TOOL_RESULT,
              message,
            });

            break;
          }

          case "tool-error": {
            const message = {
              role: "tool",
              content: [
                {
                  type: "tool-result",
                  toolCallId: part.toolCallId,
                  toolName: part.toolName,
                  output: {
                    type: "error-json",
                    value: serializeError(part.error),
                  },
                } as ToolResultPart,
              ],
            } as ToolModelMessage;

            this.context.push(message);
            this.emit({
              agentId: this.id,
              type: AgentEventType.TOOL_ERROR,
              message,
            });

            break;
          }

          case "finish-step": {
            if (this.steeringPrompts.length > 0) {
              this.logger?.debug(this.id, this.name, "stream, finish-step, abort for steering");
              this.abortController.abort(ABORT_REASON_STEER);
            }
            break;
          }

          case "finish": {
            if (!turnMessage) {
              // Should not happen.
              throw new Error("finish, but turnMessage not exists");
            }

            this.emit({
              agentId: this.id,
              type: AgentEventType.TURN_FINISH,
              message: turnMessage,
              finishReason: part.finishReason,
              totalUsage: part.totalUsage,
            });

            break;
          }

          case "error": {
            if (!turnMessage) {
              // Should not happen.
              throw new Error("error, but turnMessage not exists");
            }

            this.emit({
              agentId: this.id,
              type: AgentEventType.TURN_ERROR,
              message: turnMessage,
              error: part.error,
            });

            break;
          }

          case "abort": {
            if (!turnMessage) {
              // Should not happen.
              throw new Error("abort, but turnMessage not exists");
            }

            if (part.reason === ABORT_REASON_STEER) {
              if (this.steeringPrompts.length === 0) {
                throw new Error("abort for steering, but no pending steering prompts");
              }

              // FIFO.
              pendingPrompt = this.steeringPrompts.shift();

              this.emit({
                agentId: this.id,
                type: AgentEventType.TURN_STEER,
                message: turnMessage,
                prompt: pendingPrompt!,
              });

              break;
            }

            this.emit({
              agentId: this.id,
              type: AgentEventType.TURN_ABORT,
              message: turnMessage,
              reason: part.reason,
            });

            break;
          }

          case "source":
          case "file":
          case "tool-input-start":
          case "tool-input-delta":
          case "tool-input-end":
          case "tool-output-denied":
          case "raw":
          default: {
            this.logger?.warn(this.id, this.name, `stream, unsupported part type=${part.type}`);
            break;
          }
        }
      }

      // FIFO.
      pendingPrompt = this.followUpPrompts.shift();
    }

    this.emit({
      agentId: this.id,
      type: AgentEventType.AGENT_END,
      message: undefined,
    });

    this.runningResolver?.();
    this.runningResolver = undefined;
    this.runningPromise = undefined;
  }

  private async run(prompt: AgentPrompt): Promise<AsyncIterableStream<TextStreamPart<ToolSet>>> {
    this.logger?.info(this.id, this.name, `run, prompt=${JSON.stringify(prompt)}`);

    let toolSet: ToolSet | undefined;
    if (this.tools && this.tools.length > 0) {
      toolSet = Object.fromEntries(
        this.tools.map((t) => [
          t.name,
          {
            description: t.description,
            strict: Boolean(t.strict),
            inputSchema: t.inputSchema ?? z.undefined(),
            outputSchema: t.outputSchema ?? z.undefined(),
            execute: (input: unknown, options: { abortSignal?: AbortSignal }) =>
              t.execute(input, options.abortSignal ?? this.abortController.signal),
          },
        ]),
      );
    }

    const result = streamText({
      model: this.model,
      providerOptions: this.providerOptions,
      system: this.systemPrompt,
      tools: toolSet,
      temperature: this.temperature,
      topP: this.topP,
      topK: this.topK,
      abortSignal: this.abortController.signal,
      ...prompt,
    });

    return result.fullStream;
  }

  private emit(e: AgentEvent) {
    this.currentStage = e.type;
    this.listeners.forEach((l) => l(e));
  }
}

export default Agent;
