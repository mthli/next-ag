import pino from "pino";

import type { Logger } from "@/types";

const p = pino({
  level: "trace",
});

const logger: Logger = {
  trace: (_id, name, msg) => {
    p.trace({ name, msg });
  },

  debug: (_id, name, msg) => {
    p.debug({ name, msg });
  },

  info: (_id, name, msg) => {
    p.info({ name, msg });
  },

  warn: (_id, name, msg) => {
    p.warn({ name, msg });
  },

  error: (_id, name, msg, error) => {
    p.error({ name, msg, error });
  },
};

export default logger;
