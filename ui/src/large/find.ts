// Ctrl+F no arquivo grande: a busca roda no Rust, em fluxo, e os resultados chegam aos poucos. O painel
// de busca do CodeMirror só enxergaria os lotes carregados, então aqui há uma barra própria (como a do
// leitor de PDF): campo, "3 de 17+", ▲/▼, Aa/palavra/regex e Esc. Procurar uma linha pelo número é o
// "Ir para linha" (Ctrl+G), que nem precisa ler o arquivo.
import type { LargeHit, LargeSearchEnd, SearchOptions } from "../api";

export interface FindDeps {
  /** Começa uma busca (o fim vem na promessa; os resultados, por `listen`). Erro: a mensagem vai para a barra. */
  search(id: string, query: string, opts: SearchOptions): Promise<LargeSearchEnd>;
  cancel(id: string): void;
  /** Quem ouve os resultados parciais da busca (devolve como parar de ouvir). */
  listen(handler: (searchId: string, hits: LargeHit[]) => void): Promise<() => void> | (() => void);
  /** Leva o cursor ao resultado (seleciona o trecho). */
  reveal(hit: LargeHit): void;
  /** A linha (a partir de 0) do cursor: o primeiro resultado mostrado é o primeiro dali em diante. */
  cursorLine(): number;
  /** O índice terminou? Enquanto não, a busca espera. */
  indexed(): boolean;
  /** Devolve o foco ao editor (ao fechar). */
  refocus(): void;
}

export interface LargeFind {
  el: HTMLElement;
  open(initial?: string): void;
  close(refocus?: boolean): void;
  /** O texto mudou: os resultados guardados deixaram de valer (Enter refaz a busca). */
  stale(): void;
  /** Troca de aba: a busca da anterior não vale para esta. */
  reset(): void;
  readonly isOpen: boolean;
  dispose(): void;
}

const DEBOUNCE_MS = 350;
const nf = new Intl.NumberFormat("pt-BR");

export function mountLargeFind(parent: HTMLElement, deps: FindDeps): LargeFind {
  const el = document.createElement("div");
  el.className = "rd-find lfind";
  el.hidden = true;
  const input = document.createElement("input");
  input.className = "rd-find-input";
  input.type = "search";
  input.placeholder = "Localizar no arquivo";
  input.setAttribute("aria-label", "Localizar no arquivo");
  const count = document.createElement("span");
  count.className = "rd-find-count";
  const opts: SearchOptions = { case_sensitive: false, whole_word: false, regex: false };
  const btn = (label: string, title: string, run: () => void) => {
    const b = document.createElement("button");
    b.className = "rd-tool";
    b.type = "button";
    b.textContent = label;
    b.title = title;
    b.addEventListener("click", run);
    return b;
  };
  const toggle = (label: string, title: string, key: keyof SearchOptions) => {
    const b = btn(label, title, () => {
      opts[key] = !opts[key];
      b.classList.toggle("on", opts[key]);
      b.setAttribute("aria-pressed", String(opts[key]));
      void run();
    });
    b.setAttribute("aria-pressed", "false");
    return b;
  };
  el.append(
    input,
    toggle("Aa", "Diferenciar maiúsculas de minúsculas", "case_sensitive"),
    toggle("ab", "Palavra inteira", "whole_word"),
    toggle(".*", "Expressão regular", "regex"),
    btn("▲", "Resultado anterior (Shift+Enter)", () => step(-1)),
    btn("▼", "Próximo resultado (Enter)", () => step(1)),
    count,
    btn("✕", "Fechar (Esc)", () => close(true)),
  );
  parent.append(el);

  let hits: LargeHit[] = [];
  let idx = -1;
  let running = false;
  let truncated = false;
  let current = "";
  let token = 0;
  let timer = 0;
  let retry = 0;
  let searchId = "";
  let isStale = false;
  /** Já mostrou um resultado desta busca (os resultados chegam em ordem do arquivo, não do cursor). */
  let revealed = false;
  let unlisten: (() => void) | null = null;
  let counter = 0;
  let disposed = false;

  void Promise.resolve(
    deps.listen((sid, found) => {
      if (sid !== searchId) return;
      hits.push(...found);
      if (!revealed) {
        // o primeiro resultado a partir do cursor, assim que ele chegar: os do começo do arquivo vêm antes e
        // não podem tirar a pessoa de onde está (se não houver nenhum depois do cursor, vale o primeiro, no fim)
        const from = deps.cursorLine();
        const at = hits.findIndex((h) => h.line >= from);
        if (at >= 0) {
          revealed = true;
          idx = at;
          show();
          return;
        }
      }
      label();
    }),
  ).then((u) => {
    if (disposed) u();
    else unlisten = u;
  });

  function label(msg?: string) {
    if (msg !== undefined) {
      count.textContent = msg;
      return;
    }
    if (hits.length === 0) count.textContent = running ? "Procurando…" : current ? "Nenhum resultado" : "";
    else count.textContent = `${nf.format(idx + 1)} de ${nf.format(hits.length)}${running || truncated ? "+" : ""}`;
  }

  function show() {
    const h = hits[idx];
    if (h) deps.reveal(h);
    label();
  }

  function step(delta: number) {
    if (isStale || (input.value && input.value !== current)) return void run();
    if (hits.length === 0) return;
    idx = (idx + delta + hits.length) % hits.length;
    show();
  }

  async function run() {
    window.clearTimeout(timer);
    window.clearTimeout(retry);
    const q = input.value;
    const my = ++token;
    if (searchId) deps.cancel(searchId);
    hits = [];
    idx = -1;
    truncated = false;
    isStale = false;
    revealed = false;
    current = q;
    if (!q) {
      running = false;
      return label();
    }
    if (!deps.indexed()) {
      // a busca precisa do índice pronto: tenta de novo logo
      running = false;
      label("Indexando… a busca começa quando terminar");
      retry = window.setTimeout(() => token === my && void run(), 600);
      return;
    }
    searchId = `s${Date.now().toString(36)}${counter++}`;
    running = true;
    label();
    try {
      const end = await deps.search(searchId, q, { ...opts });
      if (token !== my) return;
      truncated = end.truncated;
    } catch (e) {
      if (token !== my) return;
      running = false;
      hits = [];
      label(String(e).replace(/^Error:\s*/, "") || "Expressão inválida");
      return;
    }
    running = false;
    if (!revealed && hits.length > 0) {
      // nenhum resultado depois do cursor: dá a volta e mostra o primeiro
      revealed = true;
      idx = 0;
      show();
      return;
    }
    label();
  }

  input.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void run(), DEBOUNCE_MS);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Enter") {
      e.preventDefault();
      window.clearTimeout(timer);
      step(e.shiftKey ? -1 : 1);
    }
  });

  function close(refocus = false) {
    token++;
    window.clearTimeout(timer);
    window.clearTimeout(retry);
    if (searchId) deps.cancel(searchId);
    running = false;
    el.hidden = true;
    if (refocus) deps.refocus();
  }

  return {
    el,
    open(initial) {
      el.hidden = false;
      if (initial !== undefined && initial !== "") input.value = initial;
      input.focus();
      input.select();
      if (input.value && input.value !== current) void run();
    },
    close,
    stale() {
      if (current) isStale = true;
    },
    reset() {
      close(false);
      hits = [];
      idx = -1;
      current = "";
      input.value = "";
      label();
    },
    get isOpen() {
      return !el.hidden;
    },
    dispose() {
      disposed = true;
      close(false);
      unlisten?.();
      el.remove();
    },
  };
}
