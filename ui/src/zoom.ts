import { getCurrentWebview } from "@tauri-apps/api/webview";

/** Zoom da janela inteira (menus, abas e editor), em porcentagem. 100 é o tamanho de sempre. */
export const ZOOM_MIN = 25;
export const ZOOM_MAX = 500;
export const ZOOM_PRESETS = [50, 75, 100, 125, 150, 200, 300];
/** Passo do Ctrl+= / Ctrl+-; a roda (Ctrl+scroll) anda de 5 em 5 por clique. */
export const ZOOM_KEY_STEP = 10;
export const ZOOM_WHEEL_STEP = 5;

export const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(Number.isFinite(z) ? z : 100)));

/** Novo zoom depois de girar a roda: `deltaY` de um clique (100) vale um passo; o touchpad anda em fração. */
export const wheelZoom = (zoom: number, deltaY: number) => clampZoom(zoom - (deltaY / 100) * ZOOM_WHEEL_STEP);

/** Próximo valor "redondo" na direção `dir`, para o teclado cair em 90, 100, 110… */
export const stepZoom = (zoom: number, dir: 1 | -1) =>
  clampZoom(dir > 0 ? (Math.floor(zoom / ZOOM_KEY_STEP) + 1) * ZOOM_KEY_STEP : (Math.ceil(zoom / ZOOM_KEY_STEP) - 1) * ZOOM_KEY_STEP);

const KEY = "fullpad.zoom";
const listeners: ((z: number) => void)[] = [];
/** Avisa quando o zoom muda (a barra de status mostra o valor). */
export const onZoomChange = (fn: (z: number) => void) => void listeners.push(fn);
let zoom = 100;

export const currentZoom = () => zoom;

export function loadZoom(): number {
  try {
    zoom = clampZoom(Number(localStorage.getItem(KEY) ?? 100));
  } catch {
    zoom = 100;
  }
  return zoom;
}

/** Aplica e lembra o zoom (vale também para as próximas aberturas). */
export function setZoom(z: number) {
  zoom = clampZoom(z);
  try {
    localStorage.setItem(KEY, String(zoom));
  } catch {
    /* sem storage: só não lembra */
  }
  void getCurrentWebview().setZoom(zoom / 100).catch(() => {});
  for (const fn of listeners) fn(zoom);
}
