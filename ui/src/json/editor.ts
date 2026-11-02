import { bracketMatching, foldGutter, foldKeymap } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate, keymap } from "@codemirror/view";
import { api } from "../api";
import { jsonErrorMark } from "../editor";

const CHECK_MS = 400;
/** Acima disso a verificação em segundo plano desliga (o painel avisa por conta própria). */
const MAX_CHECK_CHARS = 8_000_000;

/**
 * Verifica o JSON no Rust enquanto se digita e sublinha o primeiro erro, com qualquer visão aberta
 * (a árvore só existe na visão lado a lado).
 */
const checker = ViewPlugin.fromClass(
  class {
    timer: number | undefined;
    seq = 0;
    constructor(readonly view: EditorView) {
      this.schedule(0);
    }
    update(u: ViewUpdate) {
      if (u.docChanged) this.schedule(CHECK_MS);
    }
    schedule(ms: number) {
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => void this.check(), ms);
    }
    async check() {
      const doc = this.view.state.doc;
      if (doc.length > MAX_CHECK_CHARS) return;
      const mine = ++this.seq;
      const text = doc.toString();
      let err = null;
      try {
        err = await api.jsonCheck(text);
      } catch {
        return; // sem o Rust (testes, janela fechando): só não sublinha
      }
      if (mine !== this.seq || this.view.state.doc !== doc) return; // o texto mudou: vale a próxima verificação
      this.view.dispatch({ effects: jsonErrorMark(err ? { from: err.from, to: err.to, message: `${err.message} (linha ${err.line}, coluna ${err.col})` } : null) });
    }
    destroy() {
      window.clearTimeout(this.timer);
      this.seq++;
    }
  },
);

/** Linguagem JSON, dobrar blocos, pares de chaves e verificação de sintaxe. Carregado sob demanda. */
export async function jsonEditorSupport(): Promise<Extension> {
  const { json } = await import("@codemirror/lang-json");
  return [json(), foldGutter({ openText: "▾", closedText: "▸" }), keymap.of(foldKeymap), bracketMatching(), checker];
}
