import { saveProgress } from "./model";

/**
 * Cartão "Salvando…" de uma aba grande: salvar reescreve o arquivo inteiro (o resto muda de lugar quando
 * um lote muda de tamanho), então pode levar minutos num arquivo de GB. Mostra o andamento, tampa a tela
 * (nada é editado enquanto copia) e oferece Cancelar. `poll` devolve os bytes gravados e o total.
 */
export function showSaving(opts: { poll: () => Promise<{ done: number; total: number }>; cancel: () => void }): { close(): void } {
  const back = document.createElement("div");
  back.className = "saving-back";
  const card = document.createElement("div");
  card.className = "saving-card";
  const text = document.createElement("div");
  text.className = "saving-text";
  text.textContent = "Salvando…";
  const bar = document.createElement("div");
  bar.className = "saving-bar";
  const fill = document.createElement("div");
  bar.append(fill);
  const hint = document.createElement("div");
  hint.className = "saving-hint";
  hint.textContent = "O arquivo é reescrito do começo ao fim; o original só é trocado quando termina.";
  const btn = document.createElement("button");
  btn.textContent = "Cancelar";
  btn.addEventListener("click", () => {
    btn.disabled = true;
    text.textContent = "Cancelando…";
    opts.cancel();
  });
  card.append(text, bar, hint, btn);
  back.append(card);
  back.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") btn.click();
  });
  document.body.append(back);
  btn.focus();
  let alive = true;
  const tick = async () => {
    while (alive) {
      try {
        const { done, total } = await opts.poll();
        if (alive && total > 0 && !btn.disabled) {
          text.textContent = saveProgress(done, total);
          fill.style.width = `${Math.min(100, (done / total) * 100)}%`;
        }
      } catch {
        /* a próxima volta tenta de novo */
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  };
  void tick();
  return {
    close() {
      alive = false;
      back.remove();
    },
  };
}
