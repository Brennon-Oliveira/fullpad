/**
 * Faixa "Qual é o separador?" do CSV: aparece quando a estrutura do texto não revela o separador e
 * o arquivo fica no código até a pessoa escolher. Botões para os comuns e um campo de um caractere
 * para outro qualquer (Enter confirma). Só monta DOM; quem grava a escolha é o chamador.
 */
import { DELIMITERS, isValidDelimiter } from "./settings";

export function renderCsvAsk(el: HTMLElement, onPick: (delimiter: string) => void) {
  el.replaceChildren();
  const msg = document.createElement("span");
  msg.className = "csvask-msg";
  msg.textContent = "Não deu para identificar o separador deste CSV. Qual usar?";
  el.append(msg);
  const short: Record<string, string> = { ",": "Vírgula ,", ";": "Ponto e vírgula ;", "\t": "Tab", "|": "Barra |" };
  for (const d of DELIMITERS) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = short[d.value] ?? d.label;
    b.title = d.label;
    b.addEventListener("click", () => onPick(d.value));
    el.append(b);
  }
  const input = document.createElement("input");
  input.type = "text";
  input.className = "csvask-input";
  input.maxLength = 1;
  input.placeholder = "outro";
  input.title = "Digite o caractere separador e aperte Enter";
  input.setAttribute("aria-label", "Outro separador");
  const use = document.createElement("button");
  use.type = "button";
  use.textContent = "Usar";
  use.disabled = true;
  const apply = () => {
    if (isValidDelimiter(input.value)) onPick(input.value);
  };
  input.addEventListener("input", () => {
    const ok = isValidDelimiter(input.value);
    use.disabled = !ok;
    input.classList.toggle("invalid", input.value !== "" && !ok);
  });
  input.addEventListener("keydown", (e) => {
    e.stopPropagation(); // não deixa os atalhos do app agirem enquanto digita
    if (e.key === "Enter") {
      e.preventDefault();
      apply();
    }
  });
  use.addEventListener("click", apply);
  el.append(input, use);
}
