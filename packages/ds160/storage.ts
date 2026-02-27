import { Settings } from "@/types";

export const getGeminiApiKey = async (): Promise<string> => {
  const key = await storage.getItem(Settings.GEMINI_API_KEY);
  return key instanceof String ? key.trim() : "";
};

export const setGeminiApiKey = async (key?: string) => {
  await storage.setItem(Settings.GEMINI_API_KEY, key?.trim() || null);
};
