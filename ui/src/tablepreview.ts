import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import {
  type Align,
  type MdTable,
  cellToText,
  deleteCol,
  deleteRow,
  formatTable,
  hasExcess,
  insertCol,
  insertRow,
  moveCol,
  parseTable,
  setAlign,
  setCell,
  tableToCsv,
  textToCell,
} from "./mdtable";
import { type MenuItem, showMenuAt } from "./popup";

/** Tabelas com mais células que isso não viram grade (o resto do texto continua normal). */
const MAX_CELLS = 20_000;

/** Marcas do markdown dentro da célula, só o essencial e sem HTML solto: código, negrito, itálico, tachado e link. */
export function inlineTo(el: HTMLElement, raw: string): void {
  const parts = cellToText(raw).split("\n");
  parts.forEach((line, i) => {
    if (i > 0) el.append(document.createElement("br"));
    const re = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|~~([^~]+)~~|\[([^\]]+)\]\(([^)\s]+)\)/g;
    let at = 0;
    for (let m = re.exec(line); m; m = re.exec(line)) {
      if (m.index > at) el.append(line.slice(at, m.index));
      const tag = m[1] !== undefined ? "code" : m[2] !== undefined ? "strong" : m[3] !== undefined ? "em" : m[4] !== undefined ? "s" : "span";
      const node = document.createElement(tag);
      node.textContent = m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? "";
      if (tag === "span") node.className = "cm-md-link"; // o link abre no código; aqui só o texto dele
      el.append(node);
      at = m.index + m[0].length;
    }
    if (at < line.length) el.append(line.slice(at));
  });
}

/** Depois de gravar uma célula, a grade nova devolve o foco a ela (a tabela é refeita a cada edição). */
let pendingFocus: { text: string; row: number; col: number } | null = null;

class TableWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly editable: boolean,
  ) {
    super();
  }
  eq(other: WidgetType) {
    return other instanceof TableWidget && other.text === this.text && other.editable === this.editable;
  }
  get estimatedHeight() {
    return (this.text.split("\n").length) * 30;
  }
  ignoreEvent() {
    return true; // cliques e teclas dentro da grade são dela, não do editor
  }

  toDOM(view: EditorView) {
    const model = parseTable(this.text)!;
    const wrap = document.createElement("div");
    wrap.className = "cm-md-table-wrap";
    const table = document.createElement("table");
    table.className = "cm-md-table";
    wrap.append(table);

    const canEdit = this.editable && !view.state.readOnly && !hasExcess(model);
    const apply = (next: MdTable | null, focus?: { row: number; col: number }): boolean => {
      if (!next || !canEdit) return false;
      const from = view.posAtDOM(wrap);
      if (view.state.sliceDoc(from, from + this.text.length) !== this.text) return false; // a tabela mudou por fora
      const out = formatTable(next);
      if (out === this.text) return false;
      if (focus) pendingFocus = { text: out, ...focus };
      view.dispatch({ changes: { from, to: from + this.text.length, insert: out }, userEvent: "input.table" });
      return true;
    };

    const cells: HTMLElement[][] = [];
    const build = (tag: "th" | "td", row: number, col: number, raw: string, tr: HTMLElement) => {
      const c = document.createElement(tag);
      const a: Align = model.aligns[col] ?? "none";
      if (a !== "none") c.style.textAlign = a;
      inlineTo(c, raw);
      c.dataset.row = String(row);
      c.dataset.col = String(col);
      (cells[row + 1] ??= [])[col] = c;
      tr.append(c);
      if (canEdit) this.makeEditable(c, row, col, raw, model, apply, cells);
      c.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        showMenuAt(e.clientX, e.clientY, this.menu(view, wrap, model, row, col, canEdit, apply));
      });
    };

    const thead = table.createTHead().insertRow();
    model.header.forEach((h, i) => build("th", -1, i, h, thead));
    const body = table.createTBody();
    model.rows.forEach((r, ri) => {
      const tr = body.insertRow();
      for (let i = 0; i < model.header.length; i++) build("td", ri, i, r[i] ?? "", tr);
    });

    if (this.editable) {
      const code = document.createElement("button");
      code.type = "button";
      code.className = "cm-md-table-code";
      code.textContent = "</>";
      code.title = "Editar o código da tabela";
      code.addEventListener("mousedown", (e) => e.preventDefault());
      code.addEventListener("click", () => {
        const from = view.posAtDOM(wrap);
        view.dispatch({ selection: { anchor: from }, scrollIntoView: true });
        view.focus();
      });
      wrap.append(code);
    }

    const p = pendingFocus;
    if (p && p.text === this.text) {
      pendingFocus = null;
      requestAnimationFrame(() => cells[p.row + 1]?.[p.col]?.focus());
    }
    return wrap;
  }

  private makeEditable(
    c: HTMLElement,
    row: number,
    col: number,
    raw: string,
    model: MdTable,
    apply: (next: MdTable | null, focus?: { row: number; col: number }) => boolean,
    cells: HTMLElement[][],
  ) {
    c.contentEditable = "plaintext-only";
    c.classList.add("editable");
    let editing = false;
    c.addEventListener("focus", () => {
      editing = true;
      c.textContent = cellToText(raw); // o texto cru, sem as marcas desenhadas
      c.style.whiteSpace = "pre-wrap";
    });
    const done = (next: { row: number; col: number } | null): boolean => {
      if (!editing) return false;
      editing = false;
      const value = textToCell(c.innerText ?? c.textContent ?? "");
      return apply(value === raw ? null : setCell(model, row, col, value), next ?? undefined);
    };
    c.addEventListener("blur", () => {
      if (!editing) return;
      if (!done(null)) {
        c.textContent = "";
        c.style.whiteSpace = "";
        inlineTo(c, raw);
      }
    });
    c.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        editing = false;
        c.blur();
        c.textContent = "";
        c.style.whiteSpace = "";
        inlineTo(c, raw);
        e.preventDefault();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!done({ row, col })) c.blur();
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const n = model.header.length;
        const idx = row * n + col + (e.shiftKey ? -1 : 1);
        const at = idx < -n ? -n : idx; // do cabeçalho (linha -1) em diante
        const r = Math.floor(at / n);
        const k = ((at % n) + n) % n;
        if (r < -1) return;
        if (r >= model.rows.length) {
          // Tab na última célula: abre uma linha nova e segue para ela
          const next = insertRow(editedModel(), model.rows.length);
          if (!apply(next, { row: model.rows.length, col: 0 })) c.blur();
          editing = false;
          return;
        }
        if (!done({ row: r, col: k })) {
          const target = cells[r + 1]?.[k];
          editing = false;
          target?.focus();
        }
      }
    });
    const editedModel = () => {
      const value = textToCell(c.innerText ?? c.textContent ?? "");
      return value === raw ? model : setCell(model, row, col, value);
    };
    void cells;
  }

  private menu(
    view: EditorView,
    wrap: HTMLElement,
    model: MdTable,
    row: number,
    col: number,
    canEdit: boolean,
    apply: (next: MdTable | null, focus?: { row: number; col: number }) => boolean,
  ): MenuItem[] {
    const inBody = row >= 0;
    const alignItem = (label: string, a: Align): MenuItem => ({
      label,
      checked: model.aligns[col] === a,
      disabled: !canEdit,
      action: () => apply(setAlign(model, col, a)),
    });
    return [
      { label: "Inserir linha acima", disabled: !canEdit || !inBody, action: () => apply(insertRow(model, row)) },
      { label: "Inserir linha abaixo", disabled: !canEdit, action: () => apply(insertRow(model, inBody ? row + 1 : 0)) },
      { label: "Apagar linha", disabled: !canEdit || !inBody, action: () => apply(deleteRow(model, row)) },
      "sep",
      { label: "Inserir coluna à esquerda", disabled: !canEdit, action: () => apply(insertCol(model, col)) },
      { label: "Inserir coluna à direita", disabled: !canEdit, action: () => apply(insertCol(model, col + 1)) },
      { label: "Apagar coluna", disabled: !canEdit || model.header.length <= 1, action: () => apply(deleteCol(model, col)) },
      { label: "Mover coluna para a esquerda", disabled: !canEdit || col === 0, action: () => apply(moveCol(model, col, -1)) },
      { label: "Mover coluna para a direita", disabled: !canEdit || col === model.header.length - 1, action: () => apply(moveCol(model, col, 1)) },
      "sep",
      {
        label: "Alinhar coluna",
        submenu: [alignItem("Padrão", "none"), alignItem("À esquerda", "left"), alignItem("Centralizado", "center"), alignItem("À direita", "right")],
      },
      "sep",
      { label: "Copiar tabela como CSV", action: () => void navigator.clipboard.writeText(tableToCsv(model)) },
      {
        label: "Editar o código",
        action: () => {
          const from = view.posAtDOM(wrap);
          view.dispatch({ selection: { anchor: from }, scrollIntoView: true });
          view.focus();
        },
      },
    ];
  }
}

/** Uma tabela no nível do documento: a faixa de linhas inteiras e o texto. Tabela em lista ou citação fica como texto. */
export function tablesIn(state: EditorState): { from: number; to: number; text: string }[] {
  const out: { from: number; to: number; text: string }[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "Table") return;
      if (node.node.parent?.name !== "Document") return false;
      const from = state.doc.lineAt(node.from).from;
      const to = state.doc.lineAt(node.to).to;
      const text = state.sliceDoc(from, to);
      const t = parseTable(text);
      if (t && t.header.length * (t.rows.length + 1) <= MAX_CELLS) out.push({ from, to, text });
      return false;
    },
  });
  return out;
}

/**
 * Tabelas do markdown viram a grade (widget de bloco). Com o cursor tocando a tabela aparece o código, como
 * o resto do live preview; em `fixed` (painel só de leitura) fica sempre a grade, sem edição. Campo de estado
 * porque troca linhas inteiras. O documento só muda quando a pessoa edita uma célula.
 */
export function makeTableField(fixed: boolean, maxChars: number) {
  const build = (state: EditorState): DecorationSet => {
    if (state.doc.length > maxChars) return Decoration.none;
    const sel = fixed ? [] : state.selection.ranges;
    const out: Range<Decoration>[] = [];
    for (const t of tablesIn(state)) {
      if (sel.some((r) => r.from <= t.to && r.to >= t.from)) continue;
      out.push(Decoration.replace({ widget: new TableWidget(t.text, !fixed), block: true }).range(t.from, t.to));
    }
    return Decoration.set(out, true);
  };
  return StateField.define<DecorationSet>({
    create: build,
    update(value, tr) {
      if (tr.docChanged || (!fixed && tr.selection) || tr.reconfigured || syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
        return build(tr.state);
      }
      return value;
    },
    provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((v) => v.state.field(f))],
  });
}
