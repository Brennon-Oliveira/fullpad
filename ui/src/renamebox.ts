/**
 * Caixinha flutuante para pedir um nome (renomear símbolo): um campo já com o nome de agora
 * selecionado. Enter confirma, Esc ou clicar fora cancela. Se `submit` devolve um texto, ele é o
 * motivo da recusa: aparece abaixo do campo e a caixa continua aberta.
 */
export interface RenameBoxOptions {
  /** Onde abrir (coordenadas da tela): o canto de cima à esquerda; o campo se ajusta para caber na janela. */
  x: number;
  y: number;
  width?: number;
  value: string;
  /** Rótulo pequeno acima do campo ("Renomear coluna"). */
  title: string;
  /** Devolve `null` se aceitou (a caixa fecha) ou o motivo da recusa. */
  submit(value: string): Promise<string | null> | string | null;
  /** Ao fechar (aceito ou não): devolver o foco a quem o tinha. */
  onClose?(accepted: boolean): void;
}

let closeCurrent: (() => void) | null = null;

export function promptRename(o: RenameBoxOptions): void {
  closeCurrent?.();
  const box = document.createElement("div");
  box.className = "renamebox";
  box.setAttribute("role", "dialog");
  const label = document.createElement("div");
  label.className = "renamebox-title";
  label.textContent = o.title;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "renamebox-input";
  input.value = o.value;
  input.spellcheck = false;
  input.setAttribute("aria-label", o.title);
  const err = document.createElement("div");
  err.className = "renamebox-error";
  err.hidden = true;
  box.append(label, input, err);
  const w = Math.max(220, Math.min(o.width ?? 260, window.innerWidth - 16));
  box.style.width = `${w}px`;
  box.style.left = `${Math.max(8, Math.min(o.x, window.innerWidth - w - 8))}px`;
  box.style.top = `${Math.max(8, Math.min(o.y, window.innerHeight - 90))}px`;
  document.body.append(box);

  let done = false;
  let busy = false;
  const finish = (accepted: boolean) => {
    if (done) return;
    done = true;
    document.removeEventListener("pointerdown", outside, true);
    box.remove();
    if (closeCurrent === close) closeCurrent = null;
    o.onClose?.(accepted);
  };
  const close = () => finish(false);
  closeCurrent = close;
  const outside = (e: Event) => {
    if (!box.contains(e.target as Node)) finish(false);
  };
  document.addEventListener("pointerdown", outside, true);

  input.addEventListener("keydown", (e) => {
    e.stopPropagation(); // atalhos do app (Ctrl+…, F2) não valem dentro do campo
    if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    } else if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      if (busy) return;
      busy = true;
      void Promise.resolve(o.submit(input.value.trim() === input.value ? input.value : input.value.trim())).then(
        (reason) => {
          busy = false;
          if (reason === null) return finish(true);
          err.textContent = reason;
          err.hidden = false;
          input.focus();
        },
        (e2) => {
          busy = false;
          err.textContent = String(e2);
          err.hidden = false;
        },
      );
    } else {
      err.hidden = true;
    }
  });
  input.focus();
  input.select();
}
