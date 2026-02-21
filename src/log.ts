const ENABLED = true; // TODO (matthew)

const log = (tag: string, message: string) => {
  if (ENABLED) {
    console.log(`[${Date.now()}][${tag}] ${message}`);
  }
};

export default log;
