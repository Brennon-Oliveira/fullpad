// Aviso na tela enquanto o usuário arrasta arquivos de fora (o Explorer, por exemplo) sobre a janela.
// Só desenha o aviso; quem abre os arquivos é o `openPaths` do main.ts.

/** Texto do aviso para `count` arquivos (a contagem vem do evento de arrastar do Tauri). */
export function dropMessage(count: number): string {
  if (count <= 0) return "Solte para abrir";
  return count === 1 ? "Solte para abrir o arquivo" : `Solte para abrir ${count} arquivos`;
}

export interface FileDropOverlay {
  show(count: number): void;
  hide(): void;
}

export function createFileDrop(parent: HTMLElement = document.body): FileDropOverlay {
  const el = document.createElement("div");
  el.className = "filedrop";
  el.hidden = true;
  const box = document.createElement("div");
  box.className = "filedrop-box";
  const icon = document.createElement("div");
  icon.className = "filedrop-icon";
  icon.textContent = "⤓";
  const text = document.createElement("div");
  text.className = "filedrop-text";
  box.append(icon, text);
  el.append(box);
  parent.append(el);

  return {
    show(count) {
      text.textContent = dropMessage(count);
      el.hidden = false;
    },
    hide() {
      el.hidden = true;
    },
  };
}
