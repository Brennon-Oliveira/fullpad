// Painel do leitor de uma aba de PDF/EPUB: o cartão "Carregar", os avisos e a barra do leitor.
// O leitor do formato (`pdfview.ts` com o pdf.js, ou `epubview.ts`) só é importado ao clicar em "Carregar".

import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { type FileStatus, type PdfScan, type TabState, api } from "../api";
import { friendlyError } from "./errors";
import { showMenuAt } from "../popup";
import { type Hit, MIN_QUERY, normalizeQuery, searchUnits } from "./find";
import { formatQuote, formatQuoteAt } from "./quote";
import { type ReaderPos, ZOOM_KEY_FACTOR, formatBytes, normalizePos, wheelFactor } from "./pos";
import type { ReaderView, ViewHooks } from "./view";

export interface ReaderHost {
  /** A posição de leitura da aba mudou (a sessão a grava). */
  onPosition(tabId: string, pos: ReaderPos): void;
  /** A aba foi apontada para outro arquivo (Localizar). */
  onRelocated(tab: TabState): void;
  /** Texto para a barra de status ("Página 3 de 120 · 2,3 MB"), ou `null` sem aba carregada. */
  onInfo(text: string | null): void;
}

export interface ReaderPanel {
  /** Mostra a aba de leitura (idempotente: chamar de novo para a mesma aba não refaz nada). */
  show(tab: TabState): void;
  /** Esconde e solta o documento da memória (a posição já foi gravada). */
  hide(): void;
  /** Carrega o arquivo da aba atual (o que o botão faz). */
  load(): void;
  /** Abre o seletor para apontar a aba atual para outro arquivo. */
  locate(): void;
  /** O painel mudou de tamanho. */
  resize(): void;
  /**
   * Zoom do documento (Ctrl+= / Ctrl+- / Ctrl+0 e Ctrl+roda). Devolvem `false` quando não há
   * documento carregado: aí o atalho cai no zoom do app, como em qualquer outra aba.
   */
  zoomStep(dir: 1 | -1): boolean;
  zoomFit(): boolean;
  zoomWheel(deltaY: number): boolean;
  /** Copia a seleção como citação em markdown. `false` (e um aviso) se não há texto selecionado. */
  quote(): boolean;
  /** Abre a busca no documento (Ctrl+F). `false` se não há documento carregado. */
  find(): boolean;
}

/** Abas que o usuário mandou carregar nesta execução: ao voltar a elas, carregam sozinhas. */
const loaded = new Set<string>();

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const KIND_NAME = { pdf: "PDF", epub: "EPUB" } as const;
type Supported = keyof typeof KIND_NAME;

export function createReaderPanel(root: HTMLElement, host: ReaderHost): ReaderPanel {
  let tab: TabState | null = null;
  let view: ReaderView | null = null;
  let stamp: { size: number; mtime: number } | null = null; // como o arquivo estava ao carregar
  let token = 0; // invalida respostas atrasadas quando a aba muda
  let memoKey: string | null = null; // identidade do arquivo carregado (chave da posição lembrada)
  let pending: { key: string; pos: ReaderPos } | null = null;
  let rememberTimer = 0;

  /** Lembra a posição por arquivo, com um pouco de atraso (rolar não grava a cada pixel). */
  function remember(pos: ReaderPos) {
    if (!memoKey) return;
    pending = { key: memoKey, pos };
    window.clearTimeout(rememberTimer);
    rememberTimer = window.setTimeout(flushRemember, 1500);
  }
  function flushRemember() {
    window.clearTimeout(rememberTimer);
    const p = pending;
    pending = null;
    if (p) void api.readerRemember(p.key, p.pos).catch((e) => console.error("não lembrou a posição de leitura", e));
  }

  const kindName = () => KIND_NAME[tab?.kind === "epub" ? "epub" : "pdf"];
  const supported = (t: TabState): t is TabState & { kind: Supported } => t.kind === "pdf" || t.kind === "epub";
  /** "Página" no PDF, "Capítulo" no EPUB. */
  const unit = () => (tab?.kind === "epub" ? "Capítulo" : "Página");
  // ---- busca no documento ----
  let findBar: { el: HTMLElement; input: HTMLInputElement; count: HTMLElement } | null = null;
  let findHits: Hit[] = [];
  let findIdx = -1;
  let findQuery = "";
  let findToken = 0;
  let findTimer = 0;
  let findTruncated = false;

  function setCount(text: string) {
    if (findBar) findBar.count.textContent = text;
  }

  /** Mostra o resultado `findIdx`: o leitor vai até ele e o realça. */
  function showHit() {
    const hit = findHits[findIdx];
    if (!hit) return;
    view?.find?.reveal(hit, findQuery);
    setCount(`${findIdx + 1} de ${findHits.length}${findTruncated ? "+" : ""}`);
  }

  function stepHit(delta: number) {
    if (findHits.length === 0) return;
    findIdx = (findIdx + delta + findHits.length) % findHits.length;
    showHit();
  }

  async function runSearch() {
    const f = view?.find;
    if (!f || !findBar) return;
    const q = findBar.input.value;
    const my = ++findToken;
    findQuery = q;
    findHits = [];
    findIdx = -1;
    findTruncated = false;
    if (normalizeQuery(q).length < MIN_QUERY) {
      f.clear();
      setCount(q.trim() ? `Digite ao menos ${MIN_QUERY} letras` : "");
      return;
    }
    setCount("Buscando…");
    const r = await searchUnits(f, q, () => my !== findToken, (done, total, hits) => {
      if (my !== findToken) return;
      if (findIdx < 0 && hits.length > 0) {
        // o primeiro resultado aparece na hora, sem esperar o resto do documento
        findHits = hits;
        findIdx = 0;
        showHit();
      }
      if (done < total) setCount(`Buscando… ${done}/${total} · ${hits.length} resultado${hits.length === 1 ? "" : "s"}`);
    });
    if (my !== findToken) return;
    findHits = r.hits;
    findTruncated = r.truncated;
    if (findHits.length === 0) {
      f.reveal(null, q);
      setCount("Nenhum resultado");
    } else if (findIdx < 0) {
      findIdx = 0;
      showHit();
    } else {
      setCount(`${findIdx + 1} de ${findHits.length}${findTruncated ? "+" : ""}`);
    }
  }

  /** Fecha a busca: some a barra e todo o realce. */
  function closeFind(refocus = false) {
    findToken++;
    window.clearTimeout(findTimer);
    findHits = [];
    findIdx = -1;
    view?.find?.clear();
    findBar?.el.remove();
    findBar = null;
    if (refocus) root.querySelector<HTMLElement>(".rd-scroll, .rd-epub-frame")?.focus();
  }

  function openFind(): boolean {
    if (!view?.find) return false;
    if (!findBar) {
      const el = document.createElement("div");
      el.className = "rd-find";
      const input = document.createElement("input");
      input.className = "rd-find-input";
      input.type = "search";
      input.placeholder = "Localizar no documento";
      input.setAttribute("aria-label", "Localizar no documento");
      const count = document.createElement("span");
      count.className = "rd-find-count";
      const mk = (label: string, title: string, run: () => void) => {
        const b = document.createElement("button");
        b.className = "rd-tool";
        b.textContent = label;
        b.title = title;
        b.addEventListener("click", run);
        return b;
      };
      el.append(input, mk("▲", "Resultado anterior (Shift+Enter)", () => stepHit(-1)), mk("▼", "Próximo resultado (Enter)", () => stepHit(1)), count, mk("✕", "Fechar (Esc)", () => closeFind(true)));
      input.addEventListener("input", () => {
        window.clearTimeout(findTimer);
        findTimer = window.setTimeout(() => void runSearch(), 350);
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          closeFind(true);
        } else if (e.key === "Enter") {
          e.preventDefault();
          window.clearTimeout(findTimer);
          if (input.value !== findQuery) void runSearch();
          else stepHit(e.shiftKey ? -1 : 1);
        }
      });
      root.querySelector(".rd-bar")?.after(el);
      findBar = { el, input, count };
    }
    findBar.input.focus();
    findBar.input.select();
    return true;
  }

  const savePos = () => {
    if (!tab || !view) return;
    const pos = view.position();
    host.onPosition(tab.id, pos);
    remember(pos);
    flushRemember();
  };

  async function drop() {
    token++;
    savePos();
    const v = view;
    closeFind();
    view = null;
    stamp = null;
    memoKey = null;
    host.onInfo(null);
    await v?.dispose();
  }

  function card(title: string, lines: string[], buttons: { label: string; primary?: boolean; run: () => void }[], cls = "") {
    const box = el("div", `rd-card ${cls}`.trim());
    box.append(el("div", "rd-icon", kindName()), el("div", "rd-title", title));
    for (const l of lines) box.append(el("div", "rd-line", l));
    const row = el("div", "rd-actions");
    for (const b of buttons) {
      const btn = el("button", b.primary ? "rd-btn primary" : "rd-btn", b.label);
      btn.addEventListener("click", b.run);
      row.append(btn);
    }
    if (buttons.length) box.append(row);
    root.replaceChildren(el("div", "rd-center", "")); // limpa
    root.firstElementChild!.append(box);
  }

  const name = () => tab?.title || tab?.path || "";

  function idle(size: number) {
    card(name(), [`${kindName()} · ${formatBytes(size)}`, "O arquivo só é lido quando você carregar."], [{ label: `Carregar ${kindName()}`, primary: true, run: () => loadNow() }]);
    host.onInfo(`${formatBytes(size)} · não carregado`);
  }

  function missing() {
    card(
      "Arquivo não encontrado",
      [tab?.path ?? "", "Ele foi apagado, movido ou está em uma pasta ou unidade que não está disponível."],
      [
        { label: "Localizar arquivo…", primary: true, run: () => locateNow() },
        { label: "Tentar de novo", run: () => void check(true) },
      ],
      "warn",
    );
    host.onInfo("arquivo não encontrado");
  }

  /** Tipo de uma versão mais nova (ou ainda sem leitor): nada é lido nem editado. */
  function unsupported() {
    card("Este arquivo não abre nesta versão", [name(), "Ele só pode ser lido por uma versão mais nova do Fullpad."], [], "warn");
    host.onInfo(null);
  }

  /** O Rust achou um trecho que expande demais ao abrir: não carrega sem o usuário confirmar. */
  function suspicious(scan: Extract<PdfScan, { verdict: "suspicious" }>, st: FileStatus) {
    if (tab) loaded.delete(tab.id);
    const unpacked = `${scan.at_least ? "mais de " : ""}${formatBytes(scan.unpacked)}`;
    card(
      "Este PDF parece uma bomba de compressão",
      [`Um trecho de ${formatBytes(scan.packed)} vira ${unpacked} ao abrir. Carregar pode travar o app e consumir toda a memória.`, "Se você confia no arquivo, pode carregar mesmo assim."],
      [{ label: "Carregar mesmo assim", run: () => void loadNow(st, true) }],
      "warn",
    );
    host.onInfo("arquivo suspeito, não carregado");
  }

  function failed(message: string) {
    if (tab) loaded.delete(tab.id);
    card(`Não foi possível abrir o ${kindName()}`, [message], [{ label: "Tentar de novo", primary: true, run: () => void check(true) }], "error");
    host.onInfo(null);
  }

  /** Confere o arquivo e mostra o cartão certo (ou carrega, se a aba já foi carregada antes). */
  async function check(force = false) {
    const t = tab;
    if (!t) return;
    const my = ++token;
    root.classList.add("on");
    if (!supported(t)) return unsupported();
    let st: FileStatus;
    try {
      st = await api.readerInfo(t.id);
    } catch (e) {
      if (my === token) failed(String(e));
      return;
    }
    if (my !== token) return;
    if (st.status === "missing") return missing();
    if (force || loaded.has(t.id)) return void loadNow(st);
    idle(st.size);
  }

  /** `risky`: o usuário já viu o aviso de arquivo suspeito e quer carregar assim mesmo. */
  async function loadNow(known?: FileStatus, risky = false) {
    const t = tab;
    if (!t) return;
    const my = ++token;
    const verified = risky || loaded.has(t.id); // quem já carregou nesta execução não é verificado de novo
    loaded.add(t.id);
    card(name(), ["Carregando…"], [], "busy");
    try {
      const st = known ?? (await api.readerInfo(t.id));
      if (my !== token) return;
      if (st.status === "missing") return missing();
      if (!verified) {
        card(name(), ["Verificando o arquivo…"], [], "busy");
        const scan = await api.readerCheck(t.id);
        if (my !== token) return;
        if (scan.verdict === "suspicious") return suspicious(scan, st);
      }
      // onde o usuário parou: a posição da sessão vale; sem ela, a lembrada para este arquivo
      let remembered: unknown = null;
      try {
        const memo = await api.readerMemo(t.id);
        if (my !== token) return;
        memoKey = memo.key;
        remembered = memo.pos;
      } catch {
        memoKey = null; // sem identidade, só não lembra por arquivo
      }
      // o leitor do formato (e o pdf.js ou o resto dele) só é importado agora
      const epub = t.kind === "epub";
      const mod = epub ? await import("./epubview") : await import("./pdfview");
      if (my !== token) return;
      stamp = { size: st.size, mtime: st.mtime };
      const bar = el("div", "rd-bar");
      const body = el("div", "rd-body");
      root.replaceChildren(bar, body);
      const ui = buildBar(bar, () => v, unit(), epub);
      const start = normalizePos(t.reader ?? remembered);
      const hooks: ViewHooks = {
        onFind: () => void openFind(),
        onQuote: () => void quote(),
        onContextMenu: contextMenu,
        onPosition: (pos) => {
          host.onPosition(t.id, pos);
          remember(pos);
        },
        onFatal: (m) => {
          view = null;
          if (my === token) failed(m);
        },
        onView: (page, total, scale, fit) => {
          ui.update(page, total, scale, fit);
          host.onInfo(`${unit()} ${page} de ${total} · ${formatBytes(st.size)}`);
        },
      };
      const v = await ("openEpubView" in mod ? mod.openEpubView(body, t.id, start, hooks) : mod.openPdfView(body, t.id, st.size, start, hooks));
      if (my !== token) return void (await v.dispose());
      view = v;
    } catch (e) {
      if (my === token) failed(typeof e === "string" ? e : friendlyError(e));
    }
  }

  function buildBar(bar: HTMLElement, current: () => ReaderView | null, noun: string, epub: boolean) {
    const btn = (label: string, title: string, run: () => void) => {
      const b = el("button", "rd-tool", label);
      b.title = title;
      b.addEventListener("click", run);
      return b;
    };
    const zoomLabel = el("span", "rd-zoom", "");
    const page = el("input", "rd-page-input") as HTMLInputElement;
    page.type = "number";
    page.min = "1";
    page.title = "Ir para a página";
    const total = el("span", "rd-total", "");
    page.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const n = Number(page.value);
      if (Number.isFinite(n)) current()?.goTo(n);
      page.blur();
    });
    bar.append(
      btn("−", "Diminuir o zoom do documento", () => current()?.zoomBy(1 / ZOOM_KEY_FACTOR)),
      zoomLabel,
      btn("+", "Aumentar o zoom do documento", () => current()?.zoomBy(ZOOM_KEY_FACTOR)),
      epub ? btn("Padrão", "Voltar ao tamanho normal do texto", () => current()?.setZoom(null)) : btn("Largura", "Ajustar à largura do painel", () => current()?.setZoom(null)),
      el("span", "rd-sep"),
      el("span", "rd-label", noun),
      page,
      total,
    );
    return {
      update(p: number, t: number, scale: number, fit: boolean) {
        zoomLabel.textContent = `${Math.round(scale * 100)}%${fit ? " (largura)" : ""}`;
        if (document.activeElement !== page) page.value = String(p);
        total.textContent = `de ${t}`;
        page.max = String(t);
      },
    };
  }

  function locateNow() {
    const t = tab;
    if (!t) return;
    void (async () => {
      const ext = t.kind === "epub" ? "epub" : "pdf";
      const picked = await openDialog({ multiple: false, filters: [{ name: kindName(), extensions: [ext] }] });
      if (!picked || Array.isArray(picked)) return;
      try {
        const updated = await api.readerRelocate(t.id, picked);
        if (tab?.id !== t.id) return;
        tab = { ...t, ...updated };
        host.onRelocated(tab);
        void check(true);
      } catch (e) {
        failed(String(e));
      }
    })();
  }

  /** Voltou à janela: o arquivo mudou ou sumiu enquanto estava aberto? Só avisa, nunca recarrega sozinho. */
  async function watch() {
    const t = tab;
    if (!t || !view || !stamp || !root.classList.contains("on")) return;
    let st: FileStatus;
    try {
      st = await api.readerInfo(t.id);
    } catch {
      return;
    }
    if (tab?.id !== t.id || !view || root.querySelector(".rd-notice")) return;
    if (st.status === "missing") return notice("O arquivo foi movido ou apagado. O que está na tela continua aqui.", [{ label: "Localizar arquivo…", run: () => locateNow() }]);
    if (st.size !== stamp.size || st.mtime !== stamp.mtime) {
      notice("O arquivo mudou no disco.", [{ label: "Recarregar", run: () => void reload() }]);
    }
  }

  function notice(text: string, actions: { label: string; run: () => void }[]) {
    const bar = el("div", "rd-notice");
    bar.append(el("span", "", text));
    for (const a of actions) {
      const b = el("button", "rd-btn", a.label);
      b.addEventListener("click", () => {
        bar.remove();
        a.run();
      });
      bar.append(b);
    }
    const dismiss = el("button", "rd-btn", "Ignorar");
    dismiss.addEventListener("click", () => {
      bar.remove();
      if (stamp) stamp = null; // não avisar de novo a cada foco
    });
    bar.append(dismiss);
    root.prepend(bar);
  }

  async function reload() {
    if (tab) loaded.delete(tab.id); // o arquivo mudou: verifica de novo
    await drop();
    await check(true);
  }

  // ---- citação (a integração com as notas) ----

  /** Texto selecionado no documento e as páginas em que o trecho começa e termina. */
  function selectionInfo(): { text: string; first: number; last: number } | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return null;
    const pageOf = (n: Node) => Number((n instanceof Element ? n : n.parentElement)?.closest<HTMLElement>(".rd-page")?.dataset.page);
    const first = pageOf(range.startContainer);
    const last = pageOf(range.endContainer);
    if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
    const text = sel.toString();
    return text.trim() ? { text, first: Math.min(first, last), last: Math.max(first, last) } : null;
  }

  function toast(message: string) {
    root.querySelector(".rd-toast")?.remove();
    const t = el("div", "rd-toast", message);
    root.append(t);
    window.setTimeout(() => t.remove(), 1800);
  }

  /** A citação da seleção atual: no PDF, lida da tela; no EPUB, do documento dentro do iframe. */
  function quoteMarkdown(): string | null {
    if (!tab) return null;
    if (tab.kind === "epub") {
      const s = view?.selection?.();
      return s ? formatQuoteAt(s.text, s.source || tab.title, s.where) : null;
    }
    const info = selectionInfo();
    return info ? formatQuote(info.text, tab.title || tab.path || "", info.first, info.last) : null;
  }

  function quote(): boolean {
    const md = quoteMarkdown();
    if (!md) {
      toast("Selecione um trecho do texto primeiro");
      return false;
    }
    navigator.clipboard.writeText(md).then(
      () => toast("Citação copiada"),
      () => toast("Não foi possível copiar"),
    );
    return true;
  }

  /** Menu do botão direito sobre o documento (no EPUB vem do iframe, com as coordenadas já da janela). */
  function contextMenu(x: number, y: number) {
    const epub = tab?.kind === "epub";
    const has = !!quoteMarkdown();
    showMenuAt(x, y, [
      { label: "Copiar", shortcut: "Ctrl+C", disabled: !has, action: () => (epub ? view?.copySelection?.() : void document.execCommand("copy")) },
      { label: "Copiar como citação", shortcut: "Ctrl+Shift+C", disabled: !has, action: () => void quote() },
      "sep",
      epub ? { label: "Tamanho normal do texto", action: () => view?.setZoom(null) } : { label: "Ajustar à largura", action: () => view?.setZoom(null) },
    ]);
  }
  root.addEventListener("contextmenu", (e) => {
    if (!view || !(e.target instanceof Element) || !e.target.closest(".rd-body")) return;
    e.preventDefault();
    contextMenu(e.clientX, e.clientY);
  });
  root.addEventListener("keydown", (e) => {
    if (view && e.ctrlKey && !e.shiftKey && !e.altKey && e.code === "KeyF" && openFind()) e.preventDefault();
    if (view && e.ctrlKey && e.shiftKey && !e.altKey && e.code === "KeyC") {
      e.preventDefault();
      quote();
    }
  });

  window.addEventListener("focus", () => void watch());

  return {
    show(next) {
      if (tab?.id === next.id) {
        tab = next;
        root.classList.add("on");
        return;
      }
      const going = drop();
      tab = next;
      root.classList.add("on");
      void going.then(() => check());
    },
    hide() {
      root.classList.remove("on");
      const going = drop(); // grava a posição antes de esquecer a aba
      tab = null;
      void going.then(() => root.replaceChildren());
    },
    load: () => void loadNow(),
    locate: () => locateNow(),
    resize: () => view?.resize(),
    zoomStep: (dir) => !!view && (view.zoomBy(dir > 0 ? ZOOM_KEY_FACTOR : 1 / ZOOM_KEY_FACTOR), true),
    zoomFit: () => !!view && (view.setZoom(null), true),
    zoomWheel: (deltaY) => !!view && (view.zoomBy(wheelFactor(deltaY)), true),
    quote,
    find: openFind,
  };
}
