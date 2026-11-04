import { type Parsed, type Symbol, parseQuery, rank } from "./palettecore";

/** O que a paleta precisa do app; o `main.ts` entrega. */
export interface PaletteHost {
  /** Abas abertas desta janela (as fixadas primeiro). */
  tabs(): { id: string; title: string; path: string | null; pinned: boolean; active: boolean }[];
  /** Abas fechadas (histórico), a mais recente primeiro. */
  closed(): { id: string; title: string; path: string | null }[];
  /** Arquivos abertos recentemente (caminhos), o mais recente primeiro. */
  recents(): string[];
  /** Itens dos menus: `path` é o caminho do menu ("Editar › Substituir…"). */
  commands(): { title: string; path: string; shortcut?: string; run: () => void }[];
  /** Títulos/símbolos do arquivo atual; `null` se o tipo de arquivo não tem. */
  symbols(): Promise<Symbol[] | null>;
  /** Linhas do arquivo atual, ou `null` se não há texto (PDF/EPUB). */
  lineCount(): number | null;
  gotoLine(line: number, col?: number): void;
  gotoPos(pos: number): void;
  openTab(id: string, line?: number, col?: number): void;
  reopen(id: string, line?: number, col?: number): void;
  openPath(path: string, line?: number, col?: number): void;
  /** Devolve o foco ao editor (ao fechar sem escolher nada). */
  refocus(): void;
}

interface Row {
  name: string;
  detail?: string;
  /** Fonte do arquivo (aberta, fechada, recente) ou o atalho/tipo, à direita. */
  badge?: string;
  indent?: number;
  run: () => void;
  /** Campos da busca aproximada. */
  keys: string[];
}

const PLACEHOLDER: Record<string, string> = {
  files: "Arquivo… (: linha, @ título, > comandos)",
  line: "Número da linha (linha:coluna)",
  symbols: "Título ou símbolo deste arquivo…",
  commands: "Comando…",
};

const baseName = (p: string) => p.replace(/^.*[\\/]/, "");

/** Janelinha única do Ctrl+P: o prefixo do que se digita troca o modo (arquivos, `:`, `@`, `>`). */
export function openPalette(host: PaletteHost, initial = "") {
  document.querySelector(".palette-backdrop")?.remove();
  const back = document.createElement("div");
  back.className = "modal-backdrop palette-backdrop";
  const box = document.createElement("div");
  box.className = "modal";
  box.role = "dialog";
  const input = document.createElement("input");
  input.className = "modal-search";
  input.spellcheck = false;
  input.value = initial;
  const ul = document.createElement("div");
  ul.className = "modal-list";
  box.append(input, ul);
  back.append(box);
  document.body.append(back);

  let rows: Row[] = [];
  let sel = 0;
  let symbols: Symbol[] | null | undefined; // undefined = ainda não pedidos
  let token = 0;
  let done = false;

  const finish = (refocus: boolean) => {
    if (done) return;
    done = true;
    back.remove();
    document.removeEventListener("keydown", onKey, true);
    if (refocus) host.refocus();
  };
  const choose = (r: Row | undefined) => {
    if (!r) return;
    finish(false);
    r.run();
  };

  const fileRows = (p: Parsed): Row[] => {
    const line = p.line;
    const col = p.col;
    const suffix = line ? ` → linha ${line}${col ? `:${col}` : ""}` : "";
    const seen = new Set<string>();
    const key = (path: string) => path.toLowerCase().replace(/\\/g, "/");
    const out: Row[] = [];
    for (const t of host.tabs()) {
      if (t.path) seen.add(key(t.path));
      out.push({
        name: (t.pinned ? "📌 " : "") + (t.title || "Nova nota"),
        detail: t.path ?? undefined,
        badge: (t.active ? "aberta (atual)" : "aberta") + suffix,
        run: () => host.openTab(t.id, line, col),
        keys: [t.title, t.path ?? ""],
      });
    }
    for (const c of host.closed()) {
      if (c.path) {
        if (seen.has(key(c.path))) continue;
        seen.add(key(c.path));
      }
      out.push({
        name: c.title || "Nova nota",
        detail: c.path ?? undefined,
        badge: "fechada" + suffix,
        run: () => host.reopen(c.id, line, col),
        keys: [c.title, c.path ?? ""],
      });
    }
    for (const path of host.recents()) {
      if (seen.has(key(path))) continue;
      seen.add(key(path));
      out.push({ name: baseName(path), detail: path, badge: "recente" + suffix, run: () => host.openPath(path, line, col), keys: [baseName(path), path] });
    }
    return out;
  };

  const commandRows = (): Row[] =>
    host.commands().map((c) => ({ name: c.title, detail: c.path, badge: c.shortcut, run: c.run, keys: [c.title, c.path] }));

  const symbolRows = (list: Symbol[]): Row[] =>
    list.map((s) => ({ name: s.label, badge: s.meta, indent: s.depth, run: () => host.gotoPos(s.pos), keys: [s.label] }));

  const build = (p: Parsed): Row[] => {
    if (p.mode === "line") {
      const total = host.lineCount();
      if (total === null) return [];
      const line = p.line;
      return [
        {
          name: line === undefined ? `Digite o número da linha (1 a ${total})` : `Ir para a linha ${Math.min(Math.max(line, 1), total)}${p.col ? `, coluna ${p.col}` : ""}`,
          detail: line !== undefined && line > total ? `o arquivo tem ${total} linhas` : undefined,
          run: () => line !== undefined && host.gotoLine(line, p.col),
          keys: [],
        },
      ];
    }
    if (p.mode === "commands") return rank(commandRows(), p.text, (r) => r.keys);
    if (p.mode === "symbols") return rank(symbolRows(symbols ?? []), p.text, (r) => r.keys);
    return rank(fileRows(p), p.text, (r) => r.keys);
  };

  const emptyText = (p: Parsed) => {
    if (p.mode === "line") return "Este arquivo não tem linhas.";
    if (p.mode === "symbols") return symbols === undefined ? "Procurando…" : symbols === null ? "Este tipo de arquivo não tem títulos nem símbolos." : p.text ? "Nada encontrado." : "Nenhum título neste arquivo.";
    return p.text ? "Nada encontrado." : "Nada para mostrar ainda.";
  };

  const render = () => {
    const p = parseQuery(input.value);
    input.placeholder = PLACEHOLDER[p.mode];
    rows = build(p);
    sel = Math.min(sel, Math.max(0, rows.length - 1));
    if (rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "modal-empty";
      empty.textContent = emptyText(p);
      ul.replaceChildren(empty);
      return;
    }
    ul.replaceChildren(
      ...rows.slice(0, 200).map((r, i) => {
        const row = document.createElement("div");
        row.className = "modal-row" + (i === sel ? " sel" : "");
        const name = document.createElement("span");
        name.className = "modal-name";
        name.textContent = r.name;
        if (r.indent) name.style.paddingLeft = `${r.indent * 14}px`;
        row.append(name);
        const meta = document.createElement("span");
        meta.className = "modal-meta";
        if (r.detail) {
          const d = document.createElement("span");
          d.className = "modal-detail";
          d.textContent = r.detail;
          meta.append(d);
        }
        if (r.badge) {
          const b = document.createElement("span");
          b.className = "modal-badge";
          b.textContent = r.badge;
          meta.append(b);
        }
        row.append(meta);
        row.addEventListener("click", () => choose(r));
        return row;
      }),
    );
    ul.querySelector(".sel")?.scrollIntoView({ block: "nearest" });
  };

  /** Os símbolos só são calculados quando o modo `@` aparece (e uma vez por abertura). */
  const ensureSymbols = () => {
    if (symbols !== undefined) return;
    const mine = ++token;
    symbols = undefined;
    void host.symbols().then((s) => {
      if (done || mine !== token) return;
      symbols = s;
      render();
    });
  };
  let asked = false;
  const onInput = () => {
    sel = 0;
    if (!asked && parseQuery(input.value).mode === "symbols") {
      asked = true;
      ensureSymbols();
    }
    render();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") (e.preventDefault(), finish(true));
    else if (e.key === "Enter") (e.preventDefault(), choose(rows[sel]));
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      sel = Math.max(0, Math.min(Math.min(rows.length, 200) - 1, sel + (e.key === "ArrowDown" ? 1 : -1)));
      render();
    }
  };
  input.addEventListener("input", onInput);
  back.addEventListener("mousedown", (e) => e.target === back && finish(true));
  document.addEventListener("keydown", onKey, true);
  onInput();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}
