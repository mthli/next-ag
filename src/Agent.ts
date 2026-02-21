import { streamText, type LanguageModel } from "ai";

import {
  AgentEvent,
  type AgentEventListener,
  type AgentPrompt,
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
    this.providerOptions = { ...(providerOptions ?? {}) }; // copy.
    this.systemPrompt = systemPrompt ?? "";
    this.tools = [...(tools ?? [])]; // copy.
  }

  public updateProps(props: Partial<AgentProps>) {
    if (this.isRunning) {
      log(TAG, `updateProps, pending, props=${JSON.stringify(props)}`);
      this.pendingProps = { ...props };
      return;
    }

    if (props.model) {
      log(TAG, `updateProps, model=${props.model}`);
      this.model = props.model;
    }

    if (props.providerOptions) {
      log(TAG, `updateProps, providerOptions=${props.providerOptions}`);
      this.providerOptions = { ...props.providerOptions }; // copy.
    }

    if (props.systemPrompt) {
      log(TAG, `updateProps, systemPrompt=${props.systemPrompt}`);
      this.systemPrompt = props.systemPrompt;
    }

    if (props.tools) {
      log(TAG, `updateProps, tools=${props.tools}`);
      this.tools = [...props.tools]; // copy.
    }

    this.pendingProps = undefined; // clear.
  }

  public start(prompt: AgentPrompt) {
    log(TAG, `start, prompt=${JSON.stringify(prompt)}`);
    // TODO (matthew)
  }

  public steer(prompt: AgentPrompt) {
    log(TAG, `steer, prompt=${JSON.stringify(prompt)}`);
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
