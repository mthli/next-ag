import React from "react";
import ReactDOM from "react-dom/client";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";

import "@/styles/globals.css";

const root = document.getElementById("root");
ReactDOM.createRoot(root as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <div />
      <Toaster richColors position="top-center" />
    </ThemeProvider>
  </React.StrictMode>,
);
