/** Tema do app: escuro por padrão; o usuário escolhe Claro, Escuro ou Sistema (Visualizar > Tema). */
export type ThemePref = "dark" | "light" | "system";

const KEY = "fullpad.theme";
const DEFAULT: ThemePref = "dark";
const listeners: (() => void)[] = [];

export const isThemePref = (v: unknown): v is ThemePref => v === "dark" || v === "light" || v === "system";

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return isThemePref(v) ? v : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

let pref: ThemePref = read();
const system = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;

export const themePref = () => pref;

/** O tema que vale agora (resolve "Sistema"). */
export const isDark = () => (pref === "system" ? !!system?.matches : pref === "dark");

function apply() {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = isDark() ? "dark" : "light";
}

/** Avisa quando o tema efetivo pode ter mudado (escolha do usuário, sistema ou outra janela). */
export function onThemeChange(fn: () => void): () => void {
  listeners.push(fn);
  return () => void listeners.splice(listeners.indexOf(fn) >>> 0, 1);
}

function changed() {
  apply();
  for (const fn of listeners) fn();
}

export function setThemePref(p: ThemePref) {
  pref = p;
  try {
    localStorage.setItem(KEY, p);
  } catch {
    /* sem armazenamento: vale só nesta execução */
  }
  changed();
}

system?.addEventListener?.("change", () => pref === "system" && changed());
// as outras janelas do app acompanham a escolha
if (typeof window !== "undefined") window.addEventListener("storage", (e) => {
  if (e.key !== KEY) return;
  pref = read();
  changed();
});

apply();
