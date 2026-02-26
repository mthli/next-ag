import path from "path";

import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "DS-160 Assistant",
    permissions: ["activeTab", "scripting", "sidePanel", "storage", "tabs"],
    host_permissions: ["<all_urls>"],
    action: {
      default_icon: {
        32: "icon/32.png",
      },
    },
    vite: () => ({
      plugins: [tailwindcss()],
      resolve: {
        alias: {
          "@": path.resolve(__dirname, "./entrypoints"),
        },
      },
    }),
  },
});
