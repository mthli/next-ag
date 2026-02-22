import pino from "pino";

import type { Logger } from "@/types";

const p = pino({
  level: "trace",
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
    },
  },
});

const logger: Logger = {
  trace: ({ agentName: name, message: msg }) => {
    p.trace({ name, msg });
  },

  debug: ({ agentName: name, message: msg }) => {
    p.debug({ name, msg });
  },

  info: ({ agentName: name, message: msg }) => {
    p.info({ name, msg });
  },

  warn: ({ agentName: name, message: msg }) => {
    p.warn({ name, msg });
  },

  error: ({ agentName: name, message: msg, error }) => {
    p.error({ name, msg, error });
  },
};

export default logger;
