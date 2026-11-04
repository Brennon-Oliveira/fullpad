import { type Extension, Prec, StateField } from "@codemirror/state";
import { EditorView, type Tooltip, keymap, showTooltip } from "@codemirror/view";
import { BLOCK_LABELS, type Block, type Outcome, activeMarks, clearFormat, currentBlock, setBlock, toggleInline, toggleLink } from "./mdformat";
import { showMenu } from "./popup";

/** Ações de formatação (ids usados pelo menu, pela barra e pelos atalhos). */
export type FormatId = "bold" | "italic" | "strike" | "code" | "link" | "clear" | Block;

function apply(view: EditorView, o: Outcome | null): boolean {
  if (!o) return true;
  view.dispatch({
    changes: o.changes,
    selection: { anchor: o.anchor, head: o.head },
    scrollIntoView: true,
    userEvent: "input.format",
  });
  view.focus();
  return true;
}

/** Roda uma ação de formatação sobre a seleção do editor (uma transação: um passo no Ctrl+Z). */
export function runFormat(view: EditorView, id: FormatId): boolean {
  if (view.state.readOnly) return true; // aba só de leitura: nada a formatar
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc.toString();
  switch (id) {
    case "bold":
    case "italic":
    case "strike":
    case "code":
      return apply(view, toggleInline(doc, from, to, id));
    case "link":
      return apply(view, toggleLink(doc, from, to));
    case "clear":
      return apply(view, clearFormat(doc, from, to));
    default:
      return apply(view, setBlock(doc, from, to, id));
  }
}

const MAX_SELECTION = 50_000;

function build(view: EditorView): HTMLElement {
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc.toString();
  const marks = activeMarks(doc, from, to);
  const block = currentBlock(doc, from);
  const bar = document.createElement("div");
  bar.className = "fp-fmt";
  bar.addEventListener("mousedown", (e) => e.preventDefault()); // não tira o foco nem a seleção do texto

  const btn = (cls: string, label: string, title: string, on: () => void, active = false) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "fp-fmt-btn " + cls + (active ? " on" : "");
    b.innerHTML = label;
    b.title = title;
    b.addEventListener("click", on);
    return b;
  };
  const sep = () => {
    const s = document.createElement("span");
    s.className = "fp-fmt-sep";
    return s;
  };

  const current = block === "fence" ? "Bloco de código" : (BLOCK_LABELS.find(([k]) => k === block)?.[1] ?? "Texto normal");
  const typeBtn = btn("type", `<span>${current}</span><span class="caret">▾</span>`, "Tipo de bloco", () => {
    showMenu(
      typeBtn,
      BLOCK_LABELS.map(([k, label]) => ({
        label,
        checked: k === block || (k === "code" && block === "fence"),
        action: () => runFormat(view, k),
      })),
    );
  });
  bar.append(
    typeBtn,
    sep(),
    btn("b", "B", "Negrito (Ctrl+B)", () => runFormat(view, "bold"), marks.bold),
    btn("i", "I", "Itálico (Ctrl+I)", () => runFormat(view, "italic"), marks.italic),
    btn("s", "S", "Tachado (Ctrl+Shift+X)", () => runFormat(view, "strike"), marks.strike),
    btn("c", "&lt;/&gt;", "Código", () => runFormat(view, "code"), marks.code),
    sep(),
    btn("l", "🔗", "Link (Ctrl+K)", () => runFormat(view, "link"), marks.link),
    sep(),
    btn("x", "T<sub>x</sub>", "Limpar formatação", () => runFormat(view, "clear")),
  );
  return bar;
}

/** Barra flutuante acima da seleção (como a do Notion), só no markdown. */
const toolbarField = StateField.define<Tooltip | null>({
  create: () => null,
  update(prev, tr) {
    if (!tr.docChanged && !tr.selection && prev) return prev;
    const { from, to, empty } = tr.state.selection.main;
    if (empty || to - from > MAX_SELECTION) return null;
    return {
      pos: from,
      above: true,
      strictSide: true,
      arrow: false,
      create: (view) => ({ dom: build(view) }),
    };
  },
  provide: (f) => showTooltip.compute([f], (s) => s.field(f)),
});

/** Enquanto o botão do mouse está apertado (selecionando) a barra fica escondida. */
const selecting = EditorView.domEventHandlers({
  mousedown(_e, view) {
    view.dom.classList.add("fp-selecting");
    const up = () => {
      view.dom.classList.remove("fp-selecting");
      window.removeEventListener("mouseup", up, true);
    };
    window.addEventListener("mouseup", up, true);
    return false;
  },
});

const formatKeys = Prec.high(
  keymap.of([
    { key: "Mod-b", run: (v) => runFormat(v, "bold") },
    { key: "Mod-i", run: (v) => runFormat(v, "italic") },
    { key: "Mod-k", run: (v) => runFormat(v, "link") },
    { key: "Mod-Shift-x", run: (v) => runFormat(v, "strike") },
  ]),
);

export const mdFormatExtension: Extension = [toolbarField, selecting, formatKeys];
