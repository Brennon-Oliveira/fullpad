// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { CSP, type FrameHandlers, type Theme, appCss, attachFrameHandlers, buildDocument, errorDocument, fragmentToText, parseEpubLink } from "./epubdoc";

const light: Theme = { dark: false, bg: "#fff", fg: "#111", muted: "#666", accent: "#25c", border: "#ddd", scale: 1 };
const dark: Theme = { ...light, dark: true, bg: "#1e1f22", fg: "#dcddde" };

describe("documento do capítulo", () => {
  it("tem a CSP sem rede e as camadas book e app, nessa ordem", () => {
    const doc = buildDocument({ html: "<p>oi</p>", css: "p{color:red;}" }, light, { prev: false, next: true });
    expect(doc).toContain(`http-equiv="Content-Security-Policy" content="${CSP}"`);
    expect(CSP).toContain("default-src 'none'");
    expect(CSP).not.toMatch(/script-src|connect-src|http/);
    expect(doc.indexOf("@layer book,app;")).toBeLessThan(doc.indexOf("@layer book{"));
    expect(doc.indexOf("@layer book{")).toBeLessThan(doc.indexOf("@layer app{"));
    expect(doc).toContain("<p>oi</p>");
    expect(doc).toContain('href="epub:next"');
    expect(doc).not.toContain("epub:prev");
  });

  it("não tem nenhum <script> e o tema usa o tamanho do zoom", () => {
    const doc = buildDocument({ html: "<p>x</p>", css: "" }, { ...light, scale: 1.5 }, { prev: true, next: true });
    expect(doc.toLowerCase()).not.toContain("<script");
    expect(appCss({ ...light, scale: 1.5 })).toContain("27.00px/1.65");
  });

  it("no tema escuro troca as cores do livro; no claro mantém", () => {
    expect(appCss(dark)).toContain("body *:not(a){color:inherit !important");
    expect(appCss(dark)).toContain("background-color:transparent !important");
    expect(appCss(light)).not.toContain("inherit !important");
  });

  it("o fundo e a cor do tema ficam no html e no body: a regra de trocar as cores não os atinge", () => {
    const css = appCss(dark);
    expect(css).toContain("html{background:#1e1f22;color:#dcddde}");
    expect(css).toMatch(/body\{[^}]*background:#1e1f22;color:#dcddde/);
    // nenhuma regra com !important mira `*`, `html` ou `body` sozinhos (senão apagaria o fundo)
    for (const rule of css.split("\n").filter((l) => l.includes("!important"))) expect(rule, rule).toMatch(/^(body \*:not\(a\)|\.fp-nav a)\{/);
  });

  it("imagem bloqueada some e link sem destino não parece link", () => {
    expect(appCss(light)).toContain("img:not([src]){display:none}");
    expect(appCss(light)).toContain("a:not([href]){color:inherit");
  });

  it("a mensagem de erro é escapada", () => {
    const doc = errorDocument('<img src=x onerror="alert(1)"> & "aspas"', light);
    expect(doc).not.toContain("<img");
    expect(doc).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &quot;aspas&quot;");
  });
});

describe("links do capítulo", () => {
  it("entende os destinos que o Rust gera", () => {
    expect(parseEpubLink("epub:3")).toEqual({ kind: "chapter", index: 3, fragment: null });
    expect(parseEpubLink("epub:12#sec%201")).toEqual({ kind: "chapter", index: 12, fragment: "sec 1" });
    expect(parseEpubLink("epub:next")).toEqual({ kind: "step", delta: 1 });
    expect(parseEpubLink("epub:prev")).toEqual({ kind: "step", delta: -1 });
    expect(parseEpubLink("#topo")).toEqual({ kind: "anchor", id: "topo" });
    expect(parseEpubLink("https://example.com/x")).toEqual({ kind: "external", url: "https://example.com/x" });
    expect(parseEpubLink("mailto:a@b.c")).toEqual({ kind: "external", url: "mailto:a@b.c" });
  });
  it("ignora o que não deveria existir", () => {
    for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,x", "epub:", "epub:abc", "epub:1234567", "#", "", "ftp://a", "//a.b/c"]) {
      expect(parseEpubLink(bad), bad).toBeNull();
    }
  });
  it("fragmento com % inválido não derruba", () => {
    expect(parseEpubLink("#a%zz")).toEqual({ kind: "anchor", id: "a%zz" });
  });
});

describe("eventos dentro do documento", () => {
  function frameDoc(html: string) {
    const doc = document.implementation.createHTMLDocument("x");
    doc.body.innerHTML = html;
    return doc;
  }
  const handlers = (): FrameHandlers => ({ link: vi.fn(), zoomWheel: vi.fn(), key: vi.fn(), focus: vi.fn(), scrolled: vi.fn(), context: vi.fn() });

  it("clicar num link nunca navega o iframe: vira um pedido ao app", () => {
    const doc = frameDoc('<p><a id="a" href="epub:2#x"><b id="b">dois</b></a> <a id="e" href="https://example.com">ext</a> <a id="j" href="javascript:alert(1)">js</a></p>');
    const h = handlers();
    attachFrameHandlers(doc, h);
    const click = (id: string) => {
      const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
      doc.getElementById(id)!.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    expect(click("b")).toBe(true); // clicou no <b> dentro do <a>
    expect(h.link).toHaveBeenLastCalledWith({ kind: "chapter", index: 2, fragment: "x" });
    expect(click("e")).toBe(true);
    expect(h.link).toHaveBeenLastCalledWith({ kind: "external", url: "https://example.com" });
    (h.link as ReturnType<typeof vi.fn>).mockClear();
    expect(click("j")).toBe(true); // não navega, e não vira pedido nenhum
    expect(h.link).not.toHaveBeenCalled();
  });

  it("Ctrl+roda dá zoom e a roda comum rola normalmente", () => {
    const doc = frameDoc("<p>x</p>");
    const h = handlers();
    attachFrameHandlers(doc, h);
    const plain = new WheelEvent("wheel", { deltaY: 100, cancelable: true });
    doc.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    const ctrl = new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, cancelable: true });
    doc.dispatchEvent(ctrl);
    expect(ctrl.defaultPrevented).toBe(true);
    expect(h.zoomWheel).toHaveBeenCalledWith(-100);
  });

  it("repassa teclas e foco ao app, e solta tudo ao desligar", () => {
    const doc = frameDoc("<p>x</p>");
    const h = handlers();
    const off = attachFrameHandlers(doc, h);
    doc.dispatchEvent(new KeyboardEvent("keydown", { key: "w", ctrlKey: true }));
    doc.dispatchEvent(new Event("pointerdown"));
    expect([h.key, h.focus].map((f) => (f as ReturnType<typeof vi.fn>).mock.calls.length)).toEqual([1, 1]);
    off();
    doc.dispatchEvent(new KeyboardEvent("keydown", { key: "w", ctrlKey: true }));
    expect((h.key as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it("o botão direito não abre o menu do navegador: vira um pedido ao app, com a posição", () => {
    const doc = frameDoc("<p id='p'>x</p>");
    const h = handlers();
    const off = attachFrameHandlers(doc, h);
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 90 });
    doc.getElementById("p")!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(h.context).toHaveBeenCalledWith(40, 90);
    off();
    doc.getElementById("p")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect((h.context as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it("formulário não envia", () => {
    const doc = frameDoc("<form id='f'></form>");
    attachFrameHandlers(doc, handlers());
    const ev = new Event("submit", { bubbles: true, cancelable: true });
    doc.getElementById("f")!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});

describe("texto da seleção", () => {
  const frag = (html: string) => {
    const d = document.createElement("div");
    d.innerHTML = html;
    return d;
  };
  it("parágrafos ficam separados por linha em branco, e quebra de linha dentro do parágrafo é uma só", () => {
    expect(fragmentToText(frag("<p>um parágrafo</p><p>outro<br>com quebra</p>"))).toBe("um parágrafo\n\noutro\ncom quebra");
  });
  it("título, citação e item de lista também separam", () => {
    expect(fragmentToText(frag("<h1>Título</h1><blockquote><p>citado</p></blockquote><ul><li>a</li><li>b</li></ul>"))).toBe("Título\n\ncitado\n\na\n\nb");
  });
  it("texto em linha (negrito, link) não quebra", () => {
    expect(fragmentToText(frag("<p>um <b>forte</b> e <a href='#x'>link</a> juntos</p>"))).toBe("um forte e link juntos");
  });
  it("seleção parcial (só texto) sai como veio", () => {
    expect(fragmentToText(document.createTextNode("  trecho solto  "))).toBe("trecho solto");
  });
});
