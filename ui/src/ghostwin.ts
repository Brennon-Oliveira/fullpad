import { listen } from "@tauri-apps/api/event";
import "./style.css";

/** A "sombra" que acompanha o mouse enquanto uma aba é arrastada: só uma abinha translúcida com o nome. */
document.body.classList.add("ghost-only");
const tab = document.createElement("div");
tab.className = "ghost-tab";
document.body.append(tab);
void listen<string>("ghost-title", (e) => (tab.textContent = e.payload || "Nova nota"));
