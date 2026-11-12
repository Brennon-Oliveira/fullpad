import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState, Transaction } from "@codemirror/state";
import { EditorView, drawSelection, keymap, lineNumbers } from "@codemirror/view";
import { isDark, jsonErrorField, syntaxColors } from "../editor";
import { jsonEditorSupport } from "../json/editor";

/** Quanto esperar depois da última tecla para gravar o layout. */
export const SAVE_MS = 800;
/** Pausa curta depois da qual o diagrama já mostra o que foi digitado. */
export const LIVE_MS = 250;

/** O que se mostra no "Ver layout" de um arquivo que ainda não tem layout gravado. */
export const EMPTY_LAYOUT = '{\n  "tables": {},\n  "version": 1\n}\n';

export interface LayoutViewHooks {
  /** O texto foi editado (já passou o tempo de espera, ou `flush`): quem recebe grava o arquivo. */
  onChange(tabId: string, text: string): void;
  /** O texto está sendo editado (logo depois de cada pausa curta): o diagrama ao lado acompanha, sem gravar. */
  onLive?(tabId: string, text: string): void;
}

/**
 * "Ver layout": o JSON do layout do diagrama como texto, no lugar do código DBML (editor próprio, com
 * o desfazer próprio; o diagrama continua ao lado e acompanha). O documento da aba continua sendo o
 * DBML. Edições são gravadas sozinhas, pouco depois de parar de digitar (como o resto do Fullpad).
 */
export function createLayoutView(host: HTMLElement, hooks: LayoutViewHooks) {
  const head = document.createElement("div");
  head.className = "layoutview-head";
  const title = document.createElement("span");
  title.className = "layoutview-title";
  const state = document.createElement("span");
  state.className = "layoutview-state";
  head.append(title, state);
  const editorEl = document.createElement("div");
  editorEl.className = "layoutview-editor";
  host.replaceChildren(head, editorEl);

  let tabId: string | null = null;
  let dirty = false;
  let timer: number | undefined;
  let liveTimer: number | undefined;
  let support: Awaited<ReturnType<typeof jsonEditorSupport>> | undefined;

  const view = new EditorView({ parent: editorEl, state: EditorState.create({ doc: "" }) });

  const pending = () => (tabId !== null && dirty ? { id: tabId, text: view.state.doc.toString() } : null);
  const flush = () => {
    window.clearTimeout(timer);
    const p = pending();
    if (!p) return;
    dirty = false;
    state.textContent = "Gravando…";
    hooks.onChange(p.id, p.text);
  };

  const makeState = (doc: string) =>
    EditorState.create({
      doc,
      extensions: [
        history(),
        drawSelection(),
        lineNumbers(),
        EditorView.lineWrapping,
        EditorView.darkTheme.of(isDark()),
        syntaxColors,
        jsonErrorField,
        support ?? [],
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return;
          dirty = true;
          state.textContent = "Alterado";
          window.clearTimeout(liveTimer);
          liveTimer = window.setTimeout(() => tabId && hooks.onLive?.(tabId, view.state.doc.toString()), LIVE_MS);
          window.clearTimeout(timer);
          timer = window.setTimeout(flush, SAVE_MS);
        }),
      ],
    });

  async function ensureParts() {
    support ??= await jsonEditorSupport();
  }

  return {
    /** Mostra o layout da aba `id` (texto do arquivo, ou o vazio se ele ainda não existe). */
    async show(id: string, text: string, fileName: string) {
      await ensureParts();
      flush(); // o que ficou pendente da aba anterior
      tabId = id;
      dirty = false;
      title.textContent = fileName;
      state.textContent = "";
      title.title = "Layout do diagrama: posições das tabelas e enquadramento da vista (formato da extensão dbmlx)";
      view.setState(makeState(text)); // desfazer novo: o histórico é desta visão
    },
    /** O arquivo mudou por outro caminho (o diagrama gravou posições): traz o texto novo, se não há nada pendente. */
    setText(id: string, text: string) {
      if (tabId !== id || dirty || view.state.doc.toString() === text) return;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, annotations: Transaction.addToHistory.of(false) });
      dirty = false; // a troca não é edição da pessoa
      window.clearTimeout(timer);
      window.clearTimeout(liveTimer);
      state.textContent = "";
    },
    /** Há texto digitado que ainda não foi gravado. */
    get dirty() {
      return dirty;
    },
    /** Grava já o que está pendente (ao sair da visão ou trocar de aba). */
    flush,
    /** O resultado da gravação: "Gravado" ou o motivo de não ter gravado. */
    setState(text: string) {
      state.textContent = text;
    },
    hide() {
      flush();
      tabId = null;
    },
    focus: () => view.focus(),
    /** Aba a que o texto da tela pertence. */
    get tab() {
      return tabId;
    },
    destroy() {
      flush();
      view.destroy();
    },
  };
}

export type LayoutView = ReturnType<typeof createLayoutView>;
