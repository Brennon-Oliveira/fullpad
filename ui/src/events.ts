import type { EventCallback, UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

/**
 * Ouve um evento endereçado a ESTA janela (`emit_to`/`emitTo`). O `listen` global do Tauri recebe
 * também os eventos endereçados a outras janelas: usá-lo para `tab-incoming`, `drag-over`, `pv-text`
 * etc. fazia a aba aparecer em todas as janelas abertas.
 */
export function listenHere<T>(event: string, handler: EventCallback<T>): Promise<UnlistenFn> {
  return getCurrentWebviewWindow().listen<T>(event, handler);
}
