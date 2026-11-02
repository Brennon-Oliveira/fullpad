import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { codeLanguages } from "./codelangs";
import { hintExtension, hintLines, isDark, syntaxColors } from "./editor";
import { linkExtension } from "./links";
import { livePreview } from "./livepreview";

/**
 * Painel com o markdown renderizado, só leitura, para ficar ao lado do código (ou numa janela
 * própria). É um segundo CodeMirror com o mesmo `livePreview` do modo "no próprio texto", só que sem
 * cursor: tudo fica renderizado. Reaproveita o parser e as linguagens dos blocos de código.
 */
export interface PaneHooks {
  /** Mouse sobre uma linha do painel: o trecho dela no texto (`null` ao sair). */
  onHover?(span: { from: number; to: number } | null): void;
}

export function createMarkdownPane(host: HTMLElement, hooks: PaneHooks = {}) {
  const theme = new Compartment();
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: "",
      extensions: [
        markdown({ base: markdownLanguage, codeLanguages }),
        livePreview({ fixed: true }),
        syntaxColors,
        hintExtension,
        linkExtension,
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.lineWrapping,
        theme.of(EditorView.darkTheme.of(isDark())),
      ],
    }),
  });

  // Destaque de linha, igual ao do diagrama DBML: o mouse aponta a linha no painel e no código; o
  // cursor do código aponta a linha no painel (o mouse tem prioridade enquanto está em cima).
  let hovered: { from: number; to: number } | null = null;
  let cursor: { from: number; to: number } | null = null;
  let hoverLine = -1;
  const paint = () => {
    const s = hovered ?? cursor;
    view.dispatch({ effects: hintLines(s ? [s] : null) });
  };
  view.contentDOM.addEventListener("mousemove", (e) => {
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos === null) return;
    const line = view.state.doc.lineAt(pos);
    if (line.number === hoverLine) return;
    hoverLine = line.number;
    hovered = { from: line.from, to: line.to };
    paint();
    hooks.onHover?.(hovered);
  });
  view.dom.addEventListener("mouseleave", () => {
    hoverLine = -1;
    hovered = null;
    paint();
    hooks.onHover?.(null);
  });

  /** Troca o texto mexendo só no trecho que mudou, para o scroll e a seleção não saltarem. */
  function setText(text: string) {
    const old = view.state.doc.toString();
    if (old === text) return;
    let a = 0;
    const max = Math.min(old.length, text.length);
    while (a < max && old.charCodeAt(a) === text.charCodeAt(a)) a++;
    let b = 0;
    while (b < max - a && old.charCodeAt(old.length - 1 - b) === text.charCodeAt(text.length - 1 - b)) b++;
    view.dispatch({ changes: { from: a, to: old.length - b, insert: text.slice(a, text.length - b) } });
    hoverLine = -1;
    hovered = null; // as posições mudaram
    if (cursor) paint();
  }

  return {
    show(text: string) {
      host.classList.add("on");
      setText(text);
    },
    update: setText,
    /** O cursor do código está em `offset` (ou `null`): destaca a linha dele no painel. */
    setCursor(offset: number | null) {
      const o = offset === null ? null : Math.min(offset, view.state.doc.length);
      cursor = o === null ? null : (() => { const l = view.state.doc.lineAt(o); return { from: l.from, to: l.to }; })();
      paint();
    },
    hide() {
      host.classList.remove("on");
    },
    setDark(dark: boolean) {
      view.dispatch({ effects: theme.reconfigure(EditorView.darkTheme.of(dark)) });
    },
    /** Acompanha o scroll do código: `fraction` é a posição (0 a 1) no editor. */
    scrollToFraction(fraction: number) {
      const s = view.scrollDOM;
      s.scrollTop = fraction * (s.scrollHeight - s.clientHeight);
    },
  };
}

export type MarkdownPane = ReturnType<typeof createMarkdownPane>;
