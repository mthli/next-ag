import { streamText, type LanguageModel } from "ai";
import { nanoid } from "nanoid";
import { z } from "zod";

import {
  AgentEvent,
  type AgentEventListener,
  type AgentPrompt,
  type AgentProps,
  type AgentTool,
  type JSONObject,
} from "./types";

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
  private providerOptions: Record<string, JSONObject>;
  private systemPrompt: string;
  private tools: AgentTool[];
  private debug: boolean;

  private abortController = new AbortController();
  private listeners = new Set<AgentEventListener>();
  private followUpPrompts: AgentPrompt[] = [];
  private steeringPrompt?: AgentPrompt;
  private runningPromise?: Promise<void>;
  private runningResolver?: () => void;

  constructor({ id, name, model, providerOptions, systemPrompt, tools, debug }: AgentProps) {
    this.id = id ?? nanoid(10);
    this.name = name ?? "anonymous";
    this.model = model;
    this.providerOptions = { ...(providerOptions ?? {}) }; // copy.
    this.systemPrompt = systemPrompt ?? "";
    this.tools = [...(tools ?? [])]; // copy.
    this.debug = Boolean(debug);
  }

  public updateProps(props: Omit<AgentProps, "id" | "name">): boolean {
    if (this.isRunning()) {
      this.log(LogLevel.WARN, `updateProps, skipped because agent is running`);
      return false;
    }

    if (props.model) {
      const str = JSON.stringify(props.model);
      this.log(LogLevel.INFO, `updateProps, model=${str}`);
      this.model = props.model;
    }

    if (props.providerOptions) {
      const str = JSON.stringify(props.providerOptions);
      this.log(LogLevel.INFO, `updateProps, providerOptions=${str}`);
      this.providerOptions = { ...props.providerOptions }; // copy.
    }

    if (props.systemPrompt) {
      this.log(LogLevel.INFO, `updateProps, systemPrompt=${props.systemPrompt}`);
      this.systemPrompt = props.systemPrompt;
    }

    if (props.tools) {
      const str = JSON.stringify(props.tools);
      this.log(LogLevel.INFO, `updateProps, tools=${str}`);
      this.tools = [...props.tools]; // copy.
    }

    return true;
  }

  public start(prompt: AgentPrompt): boolean {
    this.log(LogLevel.INFO, `start, prompt=${JSON.stringify(prompt)}`);

    if (this.isRunning()) {
      this.log(LogLevel.WARN, "start, skipped, waitForIdle() or abort() first");
      return false;
    }

    this.runningPromise = new Promise((resolve) => (this.runningResolver = resolve));
    // TODO (matthew)

    const result = streamText({
      model: this.model,
      providerOptions: this.providerOptions,
      system: this.systemPrompt,
      tools: Object.fromEntries(
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
      ),
      abortSignal: this.abortController.signal,
      ...prompt,
    });

    // https://ai-sdk.dev/docs/ai-sdk-core/generating-text#fullstream-property
    for await (const part of result.fullStream) {
      const partStr = JSON.stringify(part);
      this.log(LogLevel.TRACE, `streamText, part=${partStr}`);

      switch (part.type) {
        case "start": {
          // handle start of stream.
          break;
        }

        case "start-step": {
          // handle start of step.
          break;
        }

        case "text-start": {
          // handle text start.
          break;
        }

        case "text-delta": {
          // handle text delta here.
          break;
        }

        case "text-end": {
          // handle text end.
          break;
        }

        case "reasoning-start": {
          // handle reasoning start.
          break;
        }

        case "reasoning-delta": {
          // handle reasoning delta here.
          break;
        }

        case "reasoning-end": {
          // handle reasoning end.
          break;
        }

        case "tool-call": {
          // handle tool call here.
          break;
        }

        case "tool-result": {
          // handle tool result here.
          break;
        }

        case "tool-error": {
          // handle tool error.
          break;
        }

        case "finish-step": {
          // handle finish step.
          break;
        }

        case "finish": {
          // handle finish here.
          break;
        }

        case "error": {
          // handle error here.
          break;
        }

        case "source":
        case "file":
        case "tool-input-start":
        case "tool-input-delta":
        case "tool-input-end":
        case "raw":
        default: {
          this.log(LogLevel.WARN, `streamText, unsupported part type=${part.type}`);
          break;
        }
      }
    }

    return true;
  }

  public steer(prompt: AgentPrompt): boolean {
    this.log(LogLevel.INFO, `steer, prompt=${JSON.stringify(prompt)}`);

    if (!this.isRunning()) {
      this.log(LogLevel.WARN, "steer, skipped, use start() instead");
      return false;
    }

    // TODO (matthew)
    return true;
  }

  public followUp(prompt: AgentPrompt): boolean {
    this.log(LogLevel.INFO, `followUp, prompt=${JSON.stringify(prompt)}`);

    if (!this.isRunning()) {
      this.log(LogLevel.WARN, "followUp, skipped, use start() instead");
      return false;
    }

    // TODO (matthew)
    return true;
  }

  public abort(reason?: string) {
    this.log(LogLevel.INFO, `abort, reason=${reason}`);
    this.abortController.abort(reason);
    this.abortController = new AbortController();
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

  private emit(e: AgentEvent) {
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
