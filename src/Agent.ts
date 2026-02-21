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
  private pendingProps?: Partial<AgentProps>;
  private isRunning = false;

  constructor({
    id,
    name,
    model,
    providerOptions,
    systemPrompt,
    tools,
    debug,
  }: AgentProps) {
    this.id = id ?? nanoid(10);
    this.name = name ?? "anonymous";
    this.model = model;
    this.providerOptions = { ...(providerOptions ?? {}) }; // copy.
    this.systemPrompt = systemPrompt ?? "";
    this.tools = [...(tools ?? [])]; // copy.
    this.debug = Boolean(debug);
  }

  public updateProps(props: Omit<AgentProps, "id" | "name">) {
    if (this.isRunning) {
      this.log(`updateProps, pending, props=${JSON.stringify(props)}`);
      this.pendingProps = { ...props };
      return;
    }

    if (props.model) {
      this.log(`updateProps, model=${props.model}`);
      this.model = props.model;
    }

    if (props.providerOptions) {
      this.log(`updateProps, providerOptions=${props.providerOptions}`);
      this.providerOptions = { ...props.providerOptions }; // copy.
    }

    if (props.systemPrompt) {
      this.log(`updateProps, systemPrompt=${props.systemPrompt}`);
      this.systemPrompt = props.systemPrompt;
    }

    if (props.tools) {
      this.log(`updateProps, tools=${props.tools}`);
      this.tools = [...props.tools]; // copy.
    }

    this.pendingProps = undefined; // clear.
  }

  public start(prompt: AgentPrompt) {
    this.log(`start, prompt=${JSON.stringify(prompt)}`);
    // TODO (matthew)
  }

  public steer(prompt: AgentPrompt) {
    this.log(`steer, prompt=${JSON.stringify(prompt)}`);
    // TODO (matthew)
  }

  public abort(reason?: string) {
    this.log(`abort, reason=${reason}`);
    this.abortController.abort(reason);
    this.abortController = new AbortController();
  }

  public subscribe(l: AgentEventListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private log(msg: string) {
    if (this.debug) {
      console.log(`[${Date.now()}][${this.id}][${this.name}] ${msg}`);
    }
  }
}

export default Agent;
