import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { codeLanguages } from "./codelangs";
import { isDark, syntaxColors } from "./editor";
import { livePreview } from "./livepreview";

/**
 * Painel com o markdown renderizado, só leitura, para ficar ao lado do código (ou numa janela
 * própria). É um segundo CodeMirror com o mesmo `livePreview` do modo "no próprio texto", só que sem
 * cursor: tudo fica renderizado. Reaproveita o parser e as linguagens dos blocos de código.
 */
export function createMarkdownPane(host: HTMLElement) {
  const theme = new Compartment();
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: "",
      extensions: [
        markdown({ base: markdownLanguage, codeLanguages }),
        livePreview({ fixed: true }),
        syntaxColors,
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.lineWrapping,
        theme.of(EditorView.darkTheme.of(isDark())),
      ],
    }),
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
  }

  return {
    show(text: string) {
      host.classList.add("on");
      setText(text);
    },
    update: setText,
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
