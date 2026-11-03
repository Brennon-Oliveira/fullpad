// Painel do leitor de uma aba de PDF/EPUB: o cartão "Carregar", os avisos e a barra do leitor.
// O pdf.js (`pdfview.ts`) só é importado ao clicar em "Carregar".

import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { type FileStatus, type PdfScan, type TabState, api } from "../api";
import { friendlyError } from "./errors";
import { type ReaderPos, ZOOM_KEY_FACTOR, formatBytes, normalizePos, wheelFactor } from "./pos";
import type { PdfView } from "./pdfview";

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
  let view: PdfView | null = null;
  let stamp: { size: number; mtime: number } | null = null; // como o arquivo estava ao carregar
  let token = 0; // invalida respostas atrasadas quando a aba muda

  const kindName = () => KIND_NAME[tab?.kind === "epub" ? "epub" : "pdf"];
  const supported = (t: TabState): t is TabState & { kind: Supported } => t.kind === "pdf";
  const savePos = () => {
    if (tab && view) host.onPosition(tab.id, view.position());
  };

  async function drop() {
    token++;
    savePos();
    const v = view;
    view = null;
    stamp = null;
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
      const mod = await import("./pdfview");
      if (my !== token) return;
      stamp = { size: st.size, mtime: st.mtime };
      const bar = el("div", "rd-bar");
      const body = el("div", "rd-body");
      root.replaceChildren(bar, body);
      const ui = buildBar(bar, () => v);
      const v = await mod.openPdfView(body, t.id, st.size, normalizePos(t.reader), {
        onPosition: (pos) => host.onPosition(t.id, pos),
        onFatal: (m) => {
          view = null;
          if (my === token) failed(m);
        },
        onView: (page, total, scale, fit) => {
          ui.update(page, total, scale, fit);
          host.onInfo(`Página ${page} de ${total} · ${formatBytes(st.size)}`);
        },
      });
      if (my !== token) return void (await v.dispose());
      view = v;
    } catch (e) {
      if (my === token) failed(typeof e === "string" ? e : friendlyError(e));
    }
  }

  function buildBar(bar: HTMLElement, current: () => PdfView | null) {
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
      btn("Largura", "Ajustar à largura do painel", () => current()?.setZoom(null)),
      el("span", "rd-sep"),
      el("span", "rd-label", "Página"),
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
  };
}
