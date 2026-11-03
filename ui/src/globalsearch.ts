import type { SearchMatch, SearchOptions, TabHits } from "./api";

/** O que o painel pede à janela: as abas, a busca no Rust e as ações sobre o editor. */
export interface GlobalSearchHost {
  /** Abas de texto desta janela (título para o grupo). */
  titleOf(tabId: string): string;
  tabIds(): string[];
  /** Grava o que está só na memória e roda a busca no Rust. */
  search(query: string, options: SearchOptions, replace: string | null): Promise<TabHits[]>;
  /** Vai até o resultado: ativa a aba e seleciona o trecho. */
  open(tabId: string, match: SearchMatch): void;
  /** Troca os resultados de `hits` (já com `replacement`) em cada aba, num passo desfazível por aba. Devolve quantas trocas fez. */
  applyReplace(hits: TabHits[]): Promise<number>;
  confirm(text: string): Promise<boolean>;
  close(): void;
}

/** Quantos arquivos e resultados o painel diz ter: "42 resultados em 5 arquivos". */
export function summary(hits: readonly TabHits[]): string {
  const total = hits.reduce((n, h) => n + h.hits.total, 0);
  if (total === 0) return "Nenhum resultado";
  const files = hits.length;
  return `${total} ${total === 1 ? "resultado" : "resultados"} em ${files} ${files === 1 ? "arquivo" : "arquivos"}`;
}

/** Linha de resultado: o trecho com o achado em destaque (sempre por `textContent`, nunca HTML). */
export function previewNode(m: SearchMatch): HTMLElement {
  const row = document.createElement("span");
  row.className = "gs-preview";
  const mark = document.createElement("mark");
  mark.textContent = m.preview.slice(m.preview_start, m.preview_end);
  row.append(m.preview.slice(0, m.preview_start), mark, m.preview.slice(m.preview_end));
  return row;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string, title?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (title) e.title = title;
  return e;
}

/** Painel lateral de busca em todas as abas da janela (Ctrl+Shift+F). */
export function mountGlobalSearch(root: HTMLElement, host: GlobalSearchHost) {
  const header = el("div", "gs-head");
  const title = el("div", "gs-title", "Buscar em todas as abas");
  const closeBtn = el("button", "fp-btn fp-close", "×", "Fechar (Esc)");
  closeBtn.type = "button";
  title.append(closeBtn);

  const input = el("input", "fp-input gs-input");
  input.placeholder = "Localizar em todas as abas";
  const caseBtn = el("button", "fp-btn fp-toggle", "Aa", "Diferenciar maiúsculas de minúsculas");
  const wordBtn = el("button", "fp-btn fp-toggle", "ab", "Palavra inteira");
  const reBtn = el("button", "fp-btn fp-toggle", ".*", "Expressão regular");
  const row1 = el("div", "fp-row");
  row1.append(input, caseBtn, wordBtn, reBtn);

  const rep = el("input", "fp-input gs-input");
  rep.placeholder = "Substituir por";
  const repAll = el("button", "fp-btn fp-text", "Substituir tudo", "Troca em todos os arquivos listados (cada aba num passo do Ctrl+Z)");
  const row2 = el("div", "fp-row");
  row2.append(rep, repAll);
  for (const b of [caseBtn, wordBtn, reBtn, repAll]) b.type = "button";

  const status = el("div", "gs-status");
  const list = el("div", "gs-list");
  header.append(title, row1, row2, status);
  root.append(header, list);
  root.hidden = true;

  let token = 0;
  let timer = 0;
  let current: TabHits[] = [];
  let error: string | null = null;
  const collapsed = new Set<string>();

  const options = (): SearchOptions => ({
    case_sensitive: caseBtn.classList.contains("on"),
    whole_word: wordBtn.classList.contains("on"),
    regex: reBtn.classList.contains("on"),
  });

  const render = () => {
    input.classList.toggle("bad", error !== null);
    repAll.disabled = current.length === 0;
    if (error) status.textContent = `Expressão inválida: ${error}`;
    else if (!input.value) status.textContent = "";
    else status.textContent = summary(current);
    status.dataset.kind = error || (input.value && current.length === 0) ? "bad" : "";
    list.replaceChildren(
      ...current.map((h) => {
        const group = el("div", "gs-group");
        const head = el("div", "gs-file");
        const open = !collapsed.has(h.id);
        head.append(
          el("span", "gs-chevron", open ? "▾" : "▸"),
          el("span", "gs-name", host.titleOf(h.id)),
          el("span", "gs-count", String(h.hits.total)),
        );
        head.addEventListener("click", () => {
          if (collapsed.has(h.id)) collapsed.delete(h.id);
          else collapsed.add(h.id);
          render();
        });
        group.append(head);
        if (open) {
          for (const m of h.hits.matches) {
            const line = el("div", "gs-match");
            line.append(el("span", "gs-line", `${m.line}`), previewNode(m));
            line.title = `Linha ${m.line}, coluna ${m.col}`;
            line.addEventListener("click", () => host.open(h.id, m));
            group.append(line);
          }
          if (h.hits.total > h.hits.matches.length) group.append(el("div", "gs-more", `… e mais ${h.hits.total - h.hits.matches.length} neste arquivo`));
        }
        return group;
      }),
    );
  };

  const run = async () => {
    const my = ++token;
    const q = input.value;
    if (!q) {
      current = [];
      error = null;
      return render();
    }
    try {
      const found = await host.search(q, options(), null);
      if (my !== token) return;
      current = found;
      error = null;
    } catch (e) {
      if (my !== token) return;
      current = [];
      error = String(e);
    }
    render();
  };
  const later = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void run(), 250);
  };

  input.addEventListener("input", later);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      window.clearTimeout(timer);
      void run();
    }
  });
  for (const b of [caseBtn, wordBtn, reBtn])
    b.addEventListener("click", () => {
      b.classList.toggle("on");
      void run();
      input.focus();
    });
  closeBtn.addEventListener("click", () => host.close());
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      host.close();
    }
  });
  repAll.addEventListener("click", async () => {
    if (!input.value || current.length === 0) return;
    const total = current.reduce((n, h) => n + h.hits.total, 0);
    const ok = await host.confirm(`Trocar ${total} ${total === 1 ? "resultado" : "resultados"} em ${current.length} ${current.length === 1 ? "arquivo" : "arquivos"} por "${rep.value}"?`);
    if (!ok) return;
    try {
      // busca de novo, já pedindo as trocas: as posições vêm do texto de agora, não do da lista
      const fresh = await host.search(input.value, options(), rep.value);
      await host.applyReplace(fresh);
    } catch (e) {
      error = String(e);
    }
    await run();
  });

  render();
  return {
    /** Mostra o painel; com texto selecionado, já o usa como consulta. */
    show(seed?: string) {
      root.hidden = false;
      if (seed) input.value = seed;
      input.focus();
      input.select();
      if (input.value) void run();
    },
    hide() {
      root.hidden = true;
    },
    get visible() {
      return !root.hidden;
    },
    /** Refaz a busca (as abas mudaram). */
    refresh() {
      if (!root.hidden && input.value) later();
    },
  };
}
