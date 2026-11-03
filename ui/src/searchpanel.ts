import { EditorState } from "@codemirror/state";
import { EditorView, type Panel, type ViewUpdate } from "@codemirror/view";
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  setSearchQuery,
} from "@codemirror/search";

/** Passou disso, o contador mostra "5000+" em vez de varrer o documento inteiro a cada tecla. */
export const MAX_COUNT = 5000;

export interface MatchCount {
  total: number;
  /** Posição (1..total) do resultado que está selecionado; 0 se a seleção não é um resultado. */
  index: number;
  truncated: boolean;
}

/** Conta os resultados da busca e acha qual deles é o selecionado. */
export function countMatches(query: SearchQuery, state: EditorState, limit = MAX_COUNT): MatchCount {
  const out: MatchCount = { total: 0, index: 0, truncated: false };
  if (!query.valid) return out;
  const sel = state.selection.main;
  const cursor = query.getCursor(state);
  for (let r = cursor.next(); !r.done; r = cursor.next()) {
    out.total++;
    if (r.value.from === sel.from && r.value.to === sel.to) out.index = out.total;
    if (out.total >= limit) {
      out.truncated = true;
      break;
    }
  }
  return out;
}

/** Texto do contador: "3 de 12", "Nenhum resultado"… */
export function countLabel(query: SearchQuery, c: MatchCount): { text: string; kind: "idle" | "ok" | "none" | "error" } {
  if (!query.search) return { text: "", kind: "idle" };
  if (!query.valid) return { text: "Expressão inválida", kind: "error" };
  if (c.total === 0) return { text: "Nenhum resultado", kind: "none" };
  const total = `${c.total}${c.truncated ? "+" : ""}`;
  return { text: c.index > 0 ? `${c.index} de ${total}` : `${total} resultados`, kind: "ok" };
}

let wantReplace = false;

/** Abre a busca; `withReplace` já mostra o campo de substituir. */
export function openSearch(view: EditorView, withReplace = false) {
  wantReplace = withReplace;
  openSearchPanel(view);
}

/** Extensão da busca do Fullpad: o painel de localizar/substituir no estilo do app. */
export const fullpadSearch = search({ top: true, createPanel: (view) => createSearchPanel(view) });

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string, title?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (title) e.title = title;
  return e;
}

function createSearchPanel(view: EditorView): Panel {
  let query = getSearchQuery(view.state);

  const dom = el("div", "fp-find");
  const toggleReplace = el("button", "fp-btn fp-chevron", "▸", "Mostrar/ocultar substituir");
  const input = el("input", "fp-input");
  input.placeholder = "Localizar";
  input.value = query.search;
  input.setAttribute("main-field", "true");
  const count = el("span", "fp-count");
  const prev = el("button", "fp-btn", "▲", "Anterior (Shift+Enter)");
  const next = el("button", "fp-btn", "▼", "Próximo (Enter)");
  const caseBtn = el("button", "fp-btn fp-toggle", "Aa", "Diferenciar maiúsculas de minúsculas");
  const wordBtn = el("button", "fp-btn fp-toggle", "ab", "Palavra inteira");
  const reBtn = el("button", "fp-btn fp-toggle", ".*", "Expressão regular");
  const close = el("button", "fp-btn fp-close", "×", "Fechar (Esc)");
  const row1 = el("div", "fp-row");
  row1.append(toggleReplace, input, count, prev, next, caseBtn, wordBtn, reBtn, close);

  const rep = el("input", "fp-input");
  rep.placeholder = "Substituir por";
  rep.value = query.replace;
  const repOne = el("button", "fp-btn fp-text", "Substituir");
  const repAll = el("button", "fp-btn fp-text", "Todos");
  const row2 = el("div", "fp-row fp-replace");
  row2.append(el("span", "fp-spacer"), rep, repOne, repAll);
  dom.append(row1, row2);
  dom.addEventListener("keydown", (e) => e.stopPropagation()); // o editor não trata as teclas daqui

  for (const b of [prev, next, caseBtn, wordBtn, reBtn, close, toggleReplace, repOne, repAll]) b.type = "button";

  const setReplaceOpen = (open: boolean) => {
    row2.hidden = !open;
    toggleReplace.textContent = open ? "▾" : "▸";
    if (!open) return;
  };
  setReplaceOpen(wantReplace || query.replace !== "");
  wantReplace = false;

  const commit = () => {
    const q = new SearchQuery({
      search: input.value,
      replace: rep.value,
      caseSensitive: caseBtn.classList.contains("on"),
      wholeWord: wordBtn.classList.contains("on"),
      regexp: reBtn.classList.contains("on"),
    });
    if (!q.eq(query)) {
      query = q;
      view.dispatch({ effects: setSearchQuery.of(q) });
    }
  };
  const syncFromQuery = () => {
    input.value = query.search;
    rep.value = query.replace;
    caseBtn.classList.toggle("on", query.caseSensitive);
    wordBtn.classList.toggle("on", query.wholeWord);
    reBtn.classList.toggle("on", query.regexp);
  };
  const refreshCount = () => {
    const l = countLabel(query, countMatches(query, view.state));
    count.textContent = l.text;
    count.dataset.kind = l.kind;
    input.classList.toggle("bad", l.kind === "error" || l.kind === "none");
  };
  syncFromQuery();
  refreshCount();

  const toggle = (b: HTMLElement) => () => {
    b.classList.toggle("on");
    commit();
    input.focus();
  };
  caseBtn.addEventListener("click", toggle(caseBtn));
  wordBtn.addEventListener("click", toggle(wordBtn));
  reBtn.addEventListener("click", toggle(reBtn));
  toggleReplace.addEventListener("click", () => {
    setReplaceOpen(!!row2.hidden);
    (row2.hidden ? input : rep).focus();
  });
  input.addEventListener("input", commit);
  rep.addEventListener("input", commit);
  const step = (back: boolean) => {
    commit();
    (back ? findPrevious : findNext)(view);
  };
  prev.addEventListener("click", () => step(true));
  next.addEventListener("click", () => step(false));
  repOne.addEventListener("click", () => (commit(), replaceNext(view)));
  repAll.addEventListener("click", () => (commit(), replaceAll(view)));
  close.addEventListener("click", () => (closeSearchPanel(view), view.focus()));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") (e.preventDefault(), step(e.shiftKey));
    else if (e.key === "Escape") (e.preventDefault(), closeSearchPanel(view), view.focus());
  });
  rep.addEventListener("keydown", (e) => {
    if (e.key === "Enter") (e.preventDefault(), commit(), e.ctrlKey || e.metaKey ? replaceAll(view) : replaceNext(view));
    else if (e.key === "Escape") (e.preventDefault(), closeSearchPanel(view), view.focus());
  });

  return {
    dom,
    top: true,
    mount() {
      input.focus();
      input.select();
    },
    update(u: ViewUpdate) {
      for (const tr of u.transactions)
        for (const e of tr.effects)
          if (e.is(setSearchQuery) && !e.value.eq(query)) {
            query = e.value;
            syncFromQuery();
          }
      if (u.docChanged || u.selectionSet || u.transactions.some((t) => t.effects.some((e) => e.is(setSearchQuery)))) refreshCount();
    },
  };
}
