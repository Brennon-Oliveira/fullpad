import { getCurrentWindow } from "@tauri-apps/api/window";

// Janelas de preview (`preview-*`) só mostram a visão renderizada de uma aba de outra janela; as
// demais são janelas de abas. Cada uma carrega só o código de que precisa.
const label = getCurrentWindow().label;
if (label === "ghost") void import("./ghostwin");
else if (label.startsWith("preview-")) void import("./previewwin");
else void import("./main");
