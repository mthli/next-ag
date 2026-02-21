import { streamText, type LanguageModel } from "ai";

import {
  AgentEvent,
  type AgentEventListener,
  type AgentProps,
  type AgentTool,
  type JSONObject,
} from "./types";

import log from "./log";
const TAG = "Agent";

class Agent {
  private model: LanguageModel;
  private providerOptions: Record<string, JSONObject>;
  private systemPrompt: string;
  private tools: AgentTool[];

  private abortController = new AbortController();
  private listeners = new Set<AgentEventListener>();
  private pendingProps?: Partial<AgentProps>;
  private isRunning = false;

  constructor({ model, providerOptions, systemPrompt, tools }: AgentProps) {
    this.model = model;
    this.providerOptions = { ...(providerOptions ?? {}) };
    this.systemPrompt = systemPrompt ?? "";
    this.tools = [...(tools ?? [])];
  }

  public updateProps(props: Partial<AgentProps>) {
    log(TAG, `updateProps, props=${JSON.stringify(props)}`);
    this.pendingProps = { ...props };
    // TODO (matthew)
  }

  public start(prompt: string) {
    log(TAG, `start, prompt=${prompt}`);
    // TODO (matthew)
  }

  public steer(prompt: string) {
    log(TAG, `steer, prompt=${prompt}`);
    // TODO (matthew)
  }

  public abort(reason?: string) {
    log(TAG, `abort, reason=${reason}`);
    this.abortController.abort(reason);
    this.abortController = new AbortController();
  }

  public subscribe(l: AgentEventListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

export default Agent;
