// Aviso na tela enquanto o usuário arrasta arquivos de fora (o Explorer, por exemplo) sobre a janela.
// Só desenha o aviso; quem abre os arquivos é o `openPaths` do main.ts.

/** Texto do aviso para `count` arquivos (a contagem vem do evento de arrastar do Tauri). */
export function dropMessage(count: number): string {
  if (count <= 0) return "Solte para abrir";
  return count === 1 ? "Solte para abrir o arquivo" : `Solte para abrir ${count} arquivos`;
}

/** Arquivo que o app aceita como imagem do markdown (a extensão; o Rust confere os bytes ao copiar). */
export const isImagePath = (path: string): boolean => /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(path);

/** Todos os arquivos arrastados são imagens (e há pelo menos um): só então o editor os trata como imagem. */
export const allImages = (paths: readonly string[]): boolean => paths.length > 0 && paths.every(isImagePath);

/** O que se sabe de cada imagem arrastada (vem de `image_import` com `dry_run`). */
export interface ImagePlan {
  target: string;
  name: string;
  reused: boolean;
}

/** Aviso de soltar imagens no markdown: título e o detalhe (linha, pasta e se já existe). */
export function imageDropText(count: number, line: number | null, plans: readonly ImagePlan[] | null, error: string | null): { title: string; detail: string } {
  const title = count === 1 ? "Solte para inserir a imagem" : `Solte para inserir ${count} imagens`;
  const where = line === null ? "" : `linha ${line.toLocaleString("pt-BR")}`;
  if (error) return { title, detail: [where, error].filter(Boolean).join(" · ") };
  if (!plans) return { title, detail: [where, "verificando…"].filter(Boolean).join(" · ") };
  const folder = (t: string) => (/^file:/i.test(t) ? "pasta de dados do app" : t.includes("/") ? decodeURIComponent(t.slice(0, t.lastIndexOf("/") + 1)) : "");
  const reused = plans.filter((p) => p.reused).length;
  let what: string;
  if (plans.length === 1) {
    const p = plans[0]!;
    what = `${folder(p.target)}${p.name} (${p.reused ? "já existe, será reaproveitada" : "nova"})`;
  } else {
    what = `${plans.length} imagens em ${folder(plans[0]!.target) || "pasta ao lado"}${reused > 0 ? ` (${reused} já ${reused === 1 ? "existe" : "existem"})` : ""}`;
  }
  return { title, detail: [where, what].filter(Boolean).join(" · ") };
}

export interface FileDropOverlay {
  show(count: number): void;
  /** Modo imagem no markdown: aviso discreto embaixo (o editor continua visível para ver onde cai). */
  showImage(title: string, detail: string): void;
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
  const sub = document.createElement("div");
  sub.className = "filedrop-sub";
  sub.hidden = true;
  box.append(icon, text, sub);
  el.append(box);
  parent.append(el);

  return {
    show(count) {
      text.textContent = dropMessage(count);
      sub.hidden = true;
      el.classList.remove("image");
      el.hidden = false;
    },
    showImage(title, detail) {
      text.textContent = title;
      sub.textContent = detail;
      sub.hidden = !detail;
      el.classList.add("image");
      el.hidden = false;
    },
    hide() {
      el.hidden = true;
      el.classList.remove("image");
    },
  };
}
