import pino from "pino";

import type { Logger } from "@next-ag/core";

const p = pino({
  level: "trace",
});

const logger: Logger = {
  trace: ({ agentId: name, message: msg }) => {
    p.trace({ name, msg });
  },

  debug: ({ agentId: name, message: msg }) => {
    p.debug({ name, msg });
  },

  info: ({ agentId: name, message: msg }) => {
    p.info({ name, msg });
  },

  warn: ({ agentId: name, message: msg }) => {
    p.warn({ name, msg });
  },

  error: ({ agentId: name, message: msg, error }) => {
    p.error({ name, msg, error });
  },
};

export default logger;
