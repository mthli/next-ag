import {
  streamText,
  type AsyncIterableStream,
  type LanguageModel,
  type TextPart,
  type TextStreamPart,
  type ToolCallPart,
  type ToolResultPart,
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
  type AgentPrompt,
  type AgentProps,
  type UpdateAgentProps,
  type AgentTool,
  type JSONObject,
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
  private debug?: boolean;

  private steeringPrompts: AgentPrompt[] = [];
  private followUpPrompts: AgentPrompt[] = [];

  private abortController = new AbortController();
  private listeners = new Set<AgentEventListener>();
  private currentStage?: AgentEventType;
  private pendingProps?: UpdateAgentProps;
  private runningPromise?: Promise<void>;
  private runningResolver?: () => void;

  constructor(props: AgentProps) {
    const { id, name, model } = props;
    this.id = id ?? nanoid(10);
    this.name = name ?? "anonymous";
    this.model = model;
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
      this.log(LogLevel.INFO, `updateProps, pending until next turn`);
      this.pendingProps = {
        ...(this.pendingProps ?? {}),
        ...props,
      }; // merge + copy.
      return;
    }

    if (props.hasOwnProperty("providerOptions")) {
      const str = JSON.stringify(props.providerOptions);
      this.log(LogLevel.INFO, `updateProps, providerOptions=${str}`);
      this.providerOptions = props.providerOptions ? { ...props.providerOptions } : undefined; // copy.
    }

    if (props.hasOwnProperty("systemPrompt")) {
      this.log(LogLevel.INFO, `updateProps, systemPrompt=${props.systemPrompt}`);
      this.systemPrompt = props.systemPrompt;
    }

    if (props.hasOwnProperty("tools")) {
      const str = JSON.stringify(props.tools);
      this.log(LogLevel.INFO, `updateProps, tools=${str}`);
      this.tools = props.tools ? [...props.tools] : undefined; // copy.
    }

    if (props.hasOwnProperty("temperature")) {
      this.log(LogLevel.INFO, `updateProps, temperature=${props.temperature}`);
      this.temperature = props.temperature;
    }

    if (props.hasOwnProperty("topP")) {
      this.log(LogLevel.INFO, `updateProps, topP=${props.topP}`);
      this.topP = props.topP;
    }

    if (props.hasOwnProperty("topK")) {
      this.log(LogLevel.INFO, `updateProps, topK=${props.topK}`);
      this.topK = props.topK;
    }

    if (props.hasOwnProperty("debug")) {
      this.log(LogLevel.INFO, `updateProps, debug=${props.debug}`);
      this.debug = props.debug;
    }

    this.pendingProps = undefined; // clear.
  }

  public start(prompt: AgentPrompt): boolean {
    this.log(LogLevel.INFO, `start, prompt=${JSON.stringify(prompt)}`);

    if (this.isRunning()) {
      this.log(LogLevel.WARN, "start, skipped, waitForIdle() or abort() first");
      return false;
    }

    this.abortController = new AbortController();
    this.runningPromise = new Promise((resolve) => (this.runningResolver = resolve));
    this.loop(prompt);

    return true;
  }

  public steer(prompt: AgentPrompt): boolean {
    this.log(LogLevel.INFO, `steer, prompt=${JSON.stringify(prompt)}`);

    if (!this.isRunning()) {
      this.log(LogLevel.WARN, "steer, skipped, use start() instead");
      return false;
    }

    this.steeringPrompts.push({ ...prompt }); // copy.
    return true;
  }

  public followUp(prompt: AgentPrompt): boolean {
    this.log(LogLevel.INFO, `followUp, prompt=${JSON.stringify(prompt)}`);

    if (!this.isRunning()) {
      this.log(LogLevel.WARN, "followUp, skipped, use start() instead");
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

    this.log(LogLevel.INFO, `abort, reason=${reason}`);
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

      const stream = await this.run(pendingPrompt);
      for await (const part of stream) {
        const partStr = JSON.stringify(part);
        this.log(LogLevel.DEBUG, `stream, part=${partStr}`);

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
            }

            if (Array.isArray(turnMessage?.content)) {
              turnMessage.content.push({
                type: "reasoning",
                text: "",
              });
            } else {
              // Should not happen.
              throw new Error("reasoning-start received, but content is not array");
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
                throw new Error("reasoning-delta received, but no reasoning found in content");
              }
            } else {
              // Should not happen.
              throw new Error("reasoning-delta received, but content is not array");
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
              throw new Error("reasoning-end received, but turnMessage not exists");
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
            }

            if (Array.isArray(turnMessage?.content)) {
              turnMessage.content.push({
                type: "text",
                text: "",
              });
            } else {
              // Should not happen.
              throw new Error("text-start received, but content is not array");
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
                throw new Error(`text-delta received, but no text found in content`);
              }
            } else {
              // Should not happen.
              throw new Error(`text-delta received, but content is not array`);
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
              throw new Error("text-end received, but turnMessage not exists");
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
              throw new Error("tool-call received, but content is not array");
            }

            this.emit({
              agentId: this.id,
              type: AgentEventType.TOOL_CALL,
              message: turnMessage,
            });

            break;
          }

          case "tool-result": {
            this.emit({
              agentId: this.id,
              type: AgentEventType.TOOL_RESULT,
              message: {
                role: "tool",
                content: [
                  {
                    type: "tool-result",
                    toolCallId: part.toolCallId,
                    toolName: part.toolName,
                    output: part.output,
                  } as ToolResultPart,
                ],
              } as ToolModelMessage,
            });
            break;
          }

          case "tool-error": {
            this.emit({
              agentId: this.id,
              type: AgentEventType.TOOL_ERROR,
              message: {
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
              } as ToolModelMessage,
            });
            break;
          }

          case "finish-step": {
            if (this.steeringPrompts.length > 0) {
              this.log(LogLevel.INFO, "finish-step, abort for steering");
              this.abortController.abort(ABORT_REASON_STEER);
            }
            break;
          }

          case "finish": {
            if (!turnMessage) {
              // Should not happen.
              throw new Error("finish received, but turnMessage not exists");
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
              throw new Error("error received, but turnMessage not exists");
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
              throw new Error("abort received, but turnMessage not exists");
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
            this.log(LogLevel.WARN, `stream, unsupported part type=${part.type}`);
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

  // TODO (matthew) carry context.
  private async run(prompt: AgentPrompt): Promise<AsyncIterableStream<TextStreamPart<ToolSet>>> {
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

  private log(level: LogLevel, msg: string) {
    if (!this.debug) {
      return;
    }

    msg = `[${Date.now()}][${this.id}][${this.name}] ${msg}`;
    switch (level) {
      case LogLevel.TRACE:
        console.trace(msg);
        break;
      case LogLevel.DEBUG:
        console.debug(msg);
        break;
      case LogLevel.INFO:
        console.info(msg);
        break;
      case LogLevel.WARN:
        console.warn(msg);
        break;
      case LogLevel.ERROR:
        console.error(msg);
        break;
      default:
        console.log(msg);
        break;
    }
  }
}

export default Agent;
