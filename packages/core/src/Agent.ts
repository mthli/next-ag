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
  type FinishReason,
} from "ai";
import { nanoid } from "nanoid";
import { serializeError } from "serialize-error";
import { z } from "zod";

import {
  AgentEventType,
  SteeringMode,
  FollowUpMode,
  TurnStartReason,
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

class Agent {
  private _id: string;
  private model: LanguageModel;
  private providerOptions?: Record<string, JSONObject>;
  private systemPrompt?: string;
  private tools?: AgentTool[];
  private temperature?: number;
  private topP?: number;
  private topK?: number;
  private steeringMode: SteeringMode;
  private followUpMode: FollowUpMode;
  private logger?: Logger;

  private steeringPrompts: AgentPrompt[] = [];
  private followUpPrompts: AgentPrompt[] = [];
  private context: AgentMessage[] = [];

  private abortController = new AbortController();
  private listeners = new Set<AgentEventListener>();
  private runningPromise?: Promise<void>;
  private runningResolver?: () => void;

  private currentStage?: AgentEventType;
  private pendingProps?: UpdateAgentProps;
  private lastTurnFinishReason?: FinishReason;

  constructor(props: AgentProps) {
    const { id, model, steeringMode, followUpMode, logger } = props;
    this._id = id ?? nanoid(10);
    this.model = model;
    this.steeringMode = steeringMode ?? SteeringMode.FIFO;
    this.followUpMode = followUpMode ?? FollowUpMode.FIFO;
    this.logger = logger;
    this.updateProps(props);
  }

  public get id(): string {
    return this._id;
  }

  // Is agent running, i.e. in a session.
  public get isRunning(): boolean {
    return Boolean(this.runningPromise);
  }

  // Incremental update agent props.
  // If agent is running, the update will be pending until next turn.
  public updateProps(props: UpdateAgentProps) {
    const validStages = [
      undefined, // initial stage, no event emitted yet.
      AgentEventType.SESSION_START,
      AgentEventType.SESSION_END,
      AgentEventType.TURN_FINISH,
      AgentEventType.TURN_ERROR,
      AgentEventType.TURN_ABORT,
      AgentEventType.TURN_STEER,
    ];

    if (this.isRunning && !validStages.includes(this.currentStage)) {
      this.logger?.info({
        agentId: this.id,
        message: "updateProps, pending until next turn",
      });

      // merge + copy.
      this.pendingProps = {
        ...(this.pendingProps ?? {}),
        ...props,
      };

      return;
    }

    if (props.hasOwnProperty("providerOptions")) {
      this.providerOptions = props.providerOptions ? { ...props.providerOptions } : undefined; // copy.
      this.logger?.info({
        agentId: this.id,
        message: `updateProps, providerOptions=${JSON.stringify(this.providerOptions)}`,
      });
    }

    if (props.hasOwnProperty("systemPrompt")) {
      this.systemPrompt = props.systemPrompt;
      this.logger?.info({
        agentId: this.id,
        message: `updateProps, systemPrompt=${this.systemPrompt}`,
      });
    }

    if (props.hasOwnProperty("tools")) {
      this.tools = props.tools ? [...props.tools] : undefined; // copy.
      this.logger?.info({
        agentId: this.id,
        message: `updateProps, tools=${JSON.stringify(this.tools)}`,
      });
    }

    if (props.hasOwnProperty("temperature")) {
      this.temperature = props.temperature;
      this.logger?.info({
        agentId: this.id,
        message: `updateProps, temperature=${this.temperature}`,
      });
    }

    if (props.hasOwnProperty("topP")) {
      this.topP = props.topP;
      this.logger?.info({
        agentId: this.id,
        message: `updateProps, topP=${this.topP}`,
      });
    }

    if (props.hasOwnProperty("topK")) {
      this.topK = props.topK;
      this.logger?.info({
        agentId: this.id,
        message: `updateProps, topK=${this.topK}`,
      });
    }

    if (props.steeringMode) {
      this.steeringMode = props.steeringMode;
      this.logger?.info({
        agentId: this.id,
        message: `updateProps, steeringMode=${this.steeringMode}`,
      });
    }

    if (props.followUpMode) {
      this.followUpMode = props.followUpMode;
      this.logger?.info({
        agentId: this.id,
        message: `updateProps, followUpMode=${this.followUpMode}`,
      });
    }

    this.pendingProps = undefined; // reset.
  }

  // Start a new session with given prompt.
  // Return false if agent is running, caller should waitForIdle() or abort() first.
  public start(prompt: AgentPrompt): boolean {
    this.logger?.info({
      agentId: this.id,
      message: `start, prompt=${JSON.stringify(prompt)}`,
    });

    if (this.isRunning) {
      this.logger?.warn({
        agentId: this.id,
        message: "start, skipped, waitForIdle() or abort() first",
      });
      return false;
    }

    this.steeringPrompts = []; // clear.
    this.followUpPrompts = []; // clear.
    this.loop([prompt], false);

    return true;
  }

  // Try to recover after an error or an abort using current context and pending prompts.
  // Return false if agent is running, or no context and no pending prompts to recover.
  public recover(): boolean {
    this.logger?.info({
      agentId: this.id,
      message: "recover",
    });

    if (this.isRunning) {
      this.logger?.warn({
        agentId: this.id,
        message: "recover, skipped, waitForIdle() or abort() first",
      });
      return false;
    }

    if (this.context.length === 0) {
      this.logger?.warn({
        agentId: this.id,
        message: "recover, skipped, no context to recover",
      });
      return false;
    }

    const last = this.context.at(-1);

    // If last message is not from assistant,
    // it's likely that agent is failed in the middle of user or tool message,
    // so we can just retry with current context.
    if (last?.role !== "assistant") {
      this.logger?.debug({
        agentId: this.id,
        message: "recover, retry with current context",
      });
      this.loop([], true);
      return true;
    }

    if (this.lastTurnFinishReason !== "stop" && this.lastTurnFinishReason !== "tool-calls") {
      this.logger?.debug({
        agentId: this.id,
        message: [
          `recover, lastTurnFinishReason=${this.lastTurnFinishReason},`,
          "re-generate last turn with current context",
        ].join(" "),
      });
      this.context.pop(); // remove last turn message.
      this.loop([], true);
      return true;
    }

    let prompts = this.dequeueSteeringPrompts();
    if (prompts.length > 0) {
      this.logger?.debug({
        agentId: this.id,
        message: "recover, recover with pending steering prompts",
      });
      this.loop(prompts, true);
      return true;
    }

    prompts = this.dequeueFollowUpPrompts();
    if (prompts.length > 0) {
      this.logger?.debug({
        agentId: this.id,
        message: "recover, recover with pending follow-up prompts",
      });
      this.loop(prompts, true);
      return true;
    }

    this.logger?.warn({
      agentId: this.id,
      message: "recover, no pending prompts to recover",
    });

    return false;
  }

  // Steer current session with given prompt.
  // Return false if agent is not running, caller should use start() instead.
  public steer(prompt: AgentPrompt): boolean {
    this.logger?.info({
      agentId: this.id,
      message: `steer, prompt=${JSON.stringify(prompt)}`,
    });

    if (!this.isRunning) {
      this.logger?.warn({
        agentId: this.id,
        message: "steer, skipped, use start() instead",
      });
      return false;
    }

    this.steeringPrompts.push({ ...prompt }); // copy.
    return true;
  }

  // Add follow-up prompt for next turn.
  // Return false if agent is not running, caller should use start() instead.
  public followUp(prompt: AgentPrompt): boolean {
    this.logger?.info({
      agentId: this.id,
      message: `followUp, prompt=${JSON.stringify(prompt)}`,
    });

    if (!this.isRunning) {
      this.logger?.warn({
        agentId: this.id,
        message: "followUp, skipped, use start() instead",
      });
      return false;
    }

    this.followUpPrompts.push({ ...prompt }); // copy.
    return true;
  }

  // Abort current session immediately.
  public abort(reason?: string) {
    if (reason === ABORT_REASON_STEER) {
      throw new Error(
        `abort reason can't be "${ABORT_REASON_STEER}", which is reserved for steer()`,
      );
    }

    this.logger?.info({
      agentId: this.id,
      message: `abort, reason=${reason}`,
    });

    this.abortController.abort(reason);
    this.runningResolver?.();
    this.runningResolver = undefined;
    this.runningPromise = undefined;
  }

  // Reset agent state, including context and pending prompts.
  // Return false if agent is running, caller should waitForIdle() or abort() first.
  public reset(): boolean {
    this.logger?.info({
      agentId: this.id,
      message: "reset",
    });

    if (this.isRunning) {
      this.logger?.warn({
        agentId: this.id,
        message: "reset, skipped, waitForIdle() or abort() first",
      });
      return false;
    }

    this.currentStage = undefined;
    this.lastTurnFinishReason = undefined;
    this.steeringPrompts = [];
    this.followUpPrompts = [];
    this.context = [];

    return true;
  }

  // Subscribe to agent events.
  // Return an unsubscribe function.
  public subscribe(l: AgentEventListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  // Wait until current session is finished, including all turns and pending prompts.
  public waitForIdle(): Promise<void> {
    return this.runningPromise ?? Promise.resolve();
  }

  private async loop(prompts: AgentPrompt[], recover: boolean) {
    this.runningPromise = new Promise((resolve) => (this.runningResolver = resolve));
    const sessionId = nanoid(10);

    this.emit({
      agentId: this.id,
      sessionId,
      type: AgentEventType.SESSION_START,
      message: undefined,
    });

    let pendingPrompts: AgentPrompt[] = [...prompts]; // copy.
    let turnStartReason = recover ? TurnStartReason.RECOVER : TurnStartReason.START;

    // Try to recover once in the beginning of loop.
    while (recover || pendingPrompts.length > 0) {
      recover = false;

      if (this.pendingProps) {
        this.updateProps(this.pendingProps);
        this.pendingProps = undefined;
      }

      for (const pending of pendingPrompts) {
        if (pending.messages) {
          this.context.push(...pending.messages);
        } else if (Array.isArray(pending.prompt)) {
          this.context.push(...pending.prompt);
        } else {
          this.context.push({
            role: "user",
            content: pending.prompt, // string.
          } as UserModelMessage);
        }
      }

      if (this.context.length === 0) {
        this.logger?.warn({
          agentId: this.id,
          message: "loop, skipped, no context to run",
        });
        break;
      }

      const turnId = nanoid(10);
      const stream = await this.run({
        messages: this.context,
      });

      let turnMessage: AssistantModelMessage | undefined;
      for await (const part of stream) {
        this.logger?.debug({
          agentId: this.id,
          message: `stream, part=${JSON.stringify(part)}`,
        });

        // https://ai-sdk.dev/docs/ai-sdk-core/generating-text#fullstream-property
        switch (part.type) {
          case "start": {
            this.lastTurnFinishReason = undefined;
            this.emit({
              agentId: this.id,
              sessionId,
              turnId,
              type: AgentEventType.TURN_START,
              message: undefined,
              startReason: turnStartReason,
              prompts: [...pendingPrompts], // copy.
            });
            pendingPrompts = []; // clear.
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

              this.context.push(turnMessage);
              this.logger?.debug({
                agentId: this.id,
                message: "stream, reasoning-start, new turnMessage",
              });
            }

            if (Array.isArray(turnMessage?.content)) {
              turnMessage.content.push({
                type: "reasoning",
                text: "",
              });
            } else {
              throw new Error("reasoning-start, but content is not array");
            }

            this.emit({
              agentId: this.id,
              sessionId,
              turnId,
              type: AgentEventType.REASONING_START,
              message: turnMessage,
            });

            break;
          }

          case "reasoning-delta": {
            if (Array.isArray(turnMessage?.content)) {
              const index = turnMessage.content.findLastIndex((c) => c.type === "reasoning");
              if (index >= 0) {
                // FIXME (matthew) AI SDK is not export ReasoningPart, so we use any.
                (turnMessage.content[index] as /* ReasoningPart */ any).text += part.text;
              } else {
                throw new Error("reasoning-delta, but no reasoning found in content");
              }
            } else {
              throw new Error("reasoning-delta, but content is not array");
            }

            this.emit({
              agentId: this.id,
              sessionId,
              turnId,
              type: AgentEventType.REASONING_UPDATE,
              message: turnMessage,
            });

            break;
          }

          case "reasoning-end": {
            if (!turnMessage) {
              throw new Error("reasoning-end, but turnMessage not exists");
            }

            this.emit({
              agentId: this.id,
              sessionId,
              turnId,
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

              this.context.push(turnMessage);
              this.logger?.debug({
                agentId: this.id,
                message: "stream, text-start, new turnMessage",
              });
            }

            if (Array.isArray(turnMessage?.content)) {
              turnMessage.content.push({
                type: "text",
                text: "",
              });
            } else {
              throw new Error("text-start, but content is not array");
            }

            this.emit({
              agentId: this.id,
              sessionId,
              turnId,
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
                throw new Error("text-delta, but no text found in content");
              }
            } else {
              throw new Error("text-delta, but content is not array");
            }

            this.emit({
              agentId: this.id,
              sessionId,
              turnId,
              type: AgentEventType.TEXT_UPDATE,
              message: turnMessage,
            });

            break;
          }

          case "text-end": {
            if (!turnMessage) {
              throw new Error("text-end, but turnMessage not exists");
            }

            this.emit({
              agentId: this.id,
              sessionId,
              turnId,
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

              this.context.push(turnMessage);
              this.logger?.debug({
                agentId: this.id,
                message: "stream, tool-call, new turnMessage",
              });
            }

            if (Array.isArray(turnMessage?.content)) {
              turnMessage.content.push({
                type: "tool-call",
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                input: part.input,
              } as ToolCallPart);
            } else {
              throw new Error("tool-call, but content is not array");
            }

            this.emit({
              agentId: this.id,
              sessionId,
              turnId,
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
                  output: {
                    type: "json", // FIXME (matthew) should support "content"?
                    value: part.output,
                  },
                } as ToolResultPart,
              ],
            } as ToolModelMessage;

            this.context.push(message);
            this.emit({
              agentId: this.id,
              sessionId,
              turnId,
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
              sessionId,
              turnId,
              type: AgentEventType.TOOL_ERROR,
              message,
            });

            break;
          }

          case "finish-step": {
            if (this.steeringPrompts.length > 0) {
              this.logger?.debug({
                agentId: this.id,
                message: "stream, finish-step, abort for steering",
              });
              this.abortController.abort(ABORT_REASON_STEER);
            }
            break;
          }

          case "finish": {
            if (!turnMessage) {
              throw new Error("finish, but turnMessage not exists");
            }

            this.lastTurnFinishReason = part.finishReason;
            this.emit({
              agentId: this.id,
              sessionId,
              turnId,
              type: AgentEventType.TURN_FINISH,
              message: turnMessage,
              finishReason: part.finishReason,
              totalUsage: part.totalUsage,
            });

            break;
          }

          case "error": {
            this.emit({
              agentId: this.id,
              sessionId,
              turnId,
              type: AgentEventType.TURN_ERROR,
              message: turnMessage,
              error: part.error,
            });
            break;
          }

          case "abort": {
            if (part.reason === ABORT_REASON_STEER) {
              if (!turnMessage) {
                throw new Error("abort for steering, but turnMessage not exists");
              } else if (this.steeringPrompts.length === 0) {
                throw new Error("abort for steering, but no pending steering prompts");
              }

              pendingPrompts = this.dequeueSteeringPrompts();
              turnStartReason = TurnStartReason.STEER;

              this.emit({
                agentId: this.id,
                sessionId,
                turnId,
                type: AgentEventType.TURN_STEER,
                message: turnMessage,
              });

              break;
            }

            this.emit({
              agentId: this.id,
              sessionId,
              turnId,
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
            this.logger?.warn({
              agentId: this.id,
              message: `stream, unsupported part type=${part.type}`,
            });
            break;
          }
        }
      }

      if (pendingPrompts.length === 0) {
        pendingPrompts = this.dequeueFollowUpPrompts();
        turnStartReason = TurnStartReason.FOLLOW_UP;
      }
    }

    this.emit({
      agentId: this.id,
      sessionId,
      type: AgentEventType.SESSION_END,
      message: undefined,
    });

    this.runningResolver?.();
    this.runningResolver = undefined;
    this.runningPromise = undefined;
  }

  private async run(prompt: AgentPrompt): Promise<AsyncIterableStream<TextStreamPart<ToolSet>>> {
    this.logger?.info({
      agentId: this.id,
      message: `run, prompt=${JSON.stringify(prompt)}`,
    });

    this.abortController = new AbortController();

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

  private dequeueSteeringPrompts(): AgentPrompt[] {
    if (this.steeringMode === SteeringMode.FIFO) {
      const first = this.steeringPrompts.shift();
      return first ? [first] : [];
    } else {
      const promps = [...this.steeringPrompts];
      this.steeringPrompts = []; // clear.
      return promps;
    }
  }

  private dequeueFollowUpPrompts(): AgentPrompt[] {
    if (this.followUpMode === FollowUpMode.FIFO) {
      const first = this.followUpPrompts.shift();
      return first ? [first] : [];
    } else {
      const prompts = [...this.followUpPrompts];
      this.followUpPrompts = []; // clear.
      return prompts;
    }
  }

  private emit(e: AgentEvent) {
    this.currentStage = e.type;
    this.listeners.forEach((l) => l(e));
  }
}

export default Agent;
