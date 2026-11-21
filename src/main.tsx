import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// 首帧之前就套上主题，避免闪白
try {
  const theme = localStorage.getItem("moxu:theme") || "paper";
  document.documentElement.dataset.theme = theme;
} catch {
  document.documentElement.dataset.theme = "paper";
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
