import React from "react";
import ReactDOM from "react-dom/client";

import { ThemeProvider } from "@/components/theme-provider";

import "@/styles/options.css";

const root = document.getElementById("root");
ReactDOM.createRoot(root as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <div />
    </ThemeProvider>
  </React.StrictMode>,
);
