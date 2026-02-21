import { streamText, type LanguageModel } from "ai";
import { nanoid } from "nanoid";

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
  private _isRunning = false;

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
      this.log(LogLevel.WARN, `start, skipped because agent is running`);
      return false;
    }

    // TODO (matthew)
    return true;
  }

  public steer(prompt: AgentPrompt): boolean {
    this.log(LogLevel.INFO, `steer, prompt=${JSON.stringify(prompt)}`);

    if (!this.isRunning()) {
      this.log(LogLevel.WARN, `steer, skipped because agent is not running`);
      return false;
    }

    // TODO (matthew)
    return true;
  }

  public abort(reason?: string) {
    this.log(LogLevel.INFO, `abort, reason=${reason}`);
    this.abortController.abort(reason);
    this.abortController = new AbortController();
  }

  public subscribe(l: AgentEventListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  public isRunning(): boolean {
    return this._isRunning;
  }

  public waitForIdle(): Promise<void> {
    return Promise.resolve(); // TODO (matthew)
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
