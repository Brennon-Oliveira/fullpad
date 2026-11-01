import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "./api";
import "./style.css";

/**
 * Janela com a visão renderizada de uma aba (markdown ou diagrama DBML) que está em outra janela, a
 * "dona". O texto chega por eventos `pv-text`; passar o mouse no diagrama avisa a dona
 * (`pv-hover:<aba>`) para ela destacar a linha. Fechar a janela avisa a dona (`pv-closed:<aba>`), que
 * volta a mostrar a visão ao lado do código.
 */
interface TextMsg {
  text: string;
  rev: number;
  title: string;
  cursor: number | null;
}

async function boot() {
  document.body.classList.add("preview-only");
  const win = getCurrentWindow();
  const info = await api.previewInfo();
  const { owner, tab } = info;
  const mdEl = document.getElementById("mdview")!;
  const diagramEl = document.getElementById("diagram")!;

  let apply: (m: TextMsg) => void;
  if (info.lang === "dbml") {
    const { createDiagramPanel } = await import("./dbml/panel");
    const panel = createDiagramPanel(diagramEl, {
      onHover: (spans, rev) => void emitTo(owner, `pv-hover:${tab}`, { spans, rev }),
    });
    let first = true;
    apply = (m) => {
      if (first) panel.show(m.text, true, m.rev);
      else panel.update(m.text, m.rev);
      first = false;
      panel.setCursor(m.cursor, m.rev);
    };
    void listen<{ offset: number | null; rev: number }>("pv-cursor", (e) => panel.setCursor(e.payload.offset, e.payload.rev));
  } else {
    const { createMarkdownPane } = await import("./mdpreview");
    const pane = createMarkdownPane(mdEl);
    mdEl.classList.add("on");
    apply = (m) => pane.show(m.text);
  }

  let shown = false;
  await listen<TextMsg>("pv-text", (e) => {
    apply(e.payload);
    void win.setTitle(`${e.payload.title} — Preview`);
    if (!shown) {
      shown = true;
      void win.show();
    }
  });
  await win.onCloseRequested(async (e) => {
    e.preventDefault();
    await emitTo(owner, `pv-closed:${tab}`, {}).catch(() => {});
    await win.destroy();
  });
  await emitTo(owner, `pv-ready:${tab}`, {}); // só agora: os ouvintes já existem
  setTimeout(() => !shown && void win.show(), 3000); // a dona não respondeu: mostra assim mesmo
}

boot().catch((e) => {
  console.error(e);
  document.body.textContent = `Erro ao abrir o preview: ${e}`;
  void getCurrentWindow().show();
});
