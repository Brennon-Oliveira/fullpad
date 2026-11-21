/**
 * O código do arquivo incluído que o diagrama está mostrando ("Ver: Só foundation.dbmlx"): fica no lugar do editor
 * da aba, **somente leitura** (o texto da aba continua sendo o do arquivo dela, vivo e escondido), com uma faixa
 * para voltar. Só lê o que o Rust já entregou em `DbmlProject.parts`; nunca grava nada.
 */
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { dbmlLanguage } from "../dbmllang";
import { syntaxColors } from "../editor";
import { isDark } from "../theme";

export interface IncludeView {
  /** Mostra o texto (e o nome do arquivo) no lugar do editor. */
  show(file: string, text: string, backLabel: string): void;
  hide(): void;
  readonly shown: boolean;
}

export function createIncludeView(host: HTMLElement, onBack: () => void): IncludeView {
  host.classList.add("incview");
  const bar = document.createElement("div");
  bar.className = "backbar incbar";
  const msg = document.createElement("span");
  const back = document.createElement("button");
  back.type = "button";
  back.addEventListener("click", onBack);
  bar.append(msg, back);
  const code = document.createElement("div");
  code.className = "inccode";
  host.append(bar, code);
  let view: EditorView | null = null;
  let key = "";
  return {
    show(file, text, backLabel) {
      msg.textContent = `Código de ${file} (somente leitura; edite abrindo o arquivo).`;
      back.textContent = backLabel;
      const k = `${file}\u0000${isDark()}\u0000${text.length}\u0000${text.slice(0, 200)}`;
      if (!view || k !== key) {
        view?.destroy();
        view = new EditorView({
          parent: code,
          state: EditorState.create({
            doc: text,
            extensions: [lineNumbers(), dbmlLanguage, syntaxColors, EditorView.lineWrapping, EditorState.readOnly.of(true), EditorView.editable.of(false), EditorView.darkTheme.of(isDark())],
          }),
        });
        key = k;
      }
      host.dataset.shown = "1";
    },
    hide() {
      delete host.dataset.shown;
    },
    get shown() {
      return host.dataset.shown === "1";
    },
  };
}
