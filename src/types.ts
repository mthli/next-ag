import { z } from "zod";

export interface AgentTool<
  I extends z.ZodTypeAny | undefined = undefined,
  O extends z.ZodTypeAny | undefined = undefined,
> {
  title: string;
  description: string;
  inputSchema?: I;
  outputSchema?: O;
  execute: (
    input: I extends z.ZodTypeAny ? z.infer<I> : unknown,
    abortSignal: AbortSignal,
  ) => Promise<O extends z.ZodTypeAny ? z.infer<O> : unknown>;
}
