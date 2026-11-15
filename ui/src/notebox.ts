/**
 * Caixinha flutuante para editar uma nota (várias linhas). Ctrl+Enter ou "Salvar" confirma, Esc ou clicar
 * fora cancela; texto vazio tira a nota. Se `submit` devolve um texto, ele é o motivo da recusa: aparece
 * abaixo do campo e a caixa continua aberta.
 */
export interface NoteBoxOptions {
  /** Onde abrir (coordenadas da tela): o canto de cima à esquerda; a caixa se ajusta para caber na janela. */
  x: number;
  y: number;
  value: string;
  /** Rótulo pequeno acima do campo ("Nota da tabela users"). */
  title: string;
  /** Devolve `null` se aceitou (a caixa fecha) ou o motivo da recusa. */
  submit(value: string): Promise<string | null> | string | null;
  /** Ao fechar (aceito ou não): devolver o foco a quem o tinha. */
  onClose?(accepted: boolean): void;
}

let closeCurrent: (() => void) | null = null;

export function promptNote(o: NoteBoxOptions): void {
  closeCurrent?.();
  const box = document.createElement("div");
  box.className = "renamebox notebox";
  box.setAttribute("role", "dialog");
  const label = document.createElement("div");
  label.className = "renamebox-title";
  label.textContent = o.title;
  const input = document.createElement("textarea");
  input.className = "renamebox-input notebox-input";
  input.value = o.value;
  input.rows = Math.min(10, Math.max(4, o.value.split("\n").length + 1));
  input.spellcheck = true;
  input.setAttribute("aria-label", o.title);
  const err = document.createElement("div");
  err.className = "renamebox-error";
  err.hidden = true;
  const bar = document.createElement("div");
  bar.className = "notebox-bar";
  const hint = document.createElement("span");
  hint.textContent = "Ctrl+Enter salva · Esc cancela · vazio tira a nota";
  const ok = document.createElement("button");
  ok.type = "button";
  ok.textContent = "Salvar";
  bar.append(hint, ok);
  box.append(label, input, err, bar);
  const w = Math.min(380, window.innerWidth - 16);
  box.style.width = `${w}px`;
  box.style.left = `${Math.max(8, Math.min(o.x, window.innerWidth - w - 8))}px`;
  box.style.top = `${Math.max(8, Math.min(o.y, window.innerHeight - 230))}px`;
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

  const save = () => {
    if (busy) return;
    busy = true;
    void Promise.resolve(o.submit(input.value)).then(
      (reason) => {
        busy = false;
        if (reason === null) return finish(true);
        err.textContent = reason;
        err.hidden = false;
        input.focus();
      },
      (e) => {
        busy = false;
        err.textContent = String(e);
        err.hidden = false;
      },
    );
  };
  ok.addEventListener("click", save);
  input.addEventListener("keydown", (e) => {
    e.stopPropagation(); // atalhos do app não valem dentro do campo
    if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.isComposing) {
      e.preventDefault();
      save();
    } else {
      err.hidden = true;
    }
  });
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}
