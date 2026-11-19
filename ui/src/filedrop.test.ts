// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { allImages, createFileDrop, dropMessage, imageDropText, isImagePath } from "./filedrop";

describe("aviso de arrastar arquivos", () => {
  it("diz quantos arquivos serão abertos", () => {
    expect(dropMessage(0)).toBe("Solte para abrir");
    expect(dropMessage(1)).toBe("Solte para abrir o arquivo");
    expect(dropMessage(3)).toBe("Solte para abrir 3 arquivos");
  });

  it("nasce escondido, aparece ao arrastar e some ao soltar ou sair", () => {
    const host = document.createElement("div");
    const drop = createFileDrop(host);
    const el = host.querySelector<HTMLElement>(".filedrop")!;
    expect(el.hidden).toBe(true);
    drop.show(2);
    expect(el.hidden).toBe(false);
    expect(el.textContent).toContain("Solte para abrir 2 arquivos");
    drop.hide();
    expect(el.hidden).toBe(true);
  });
});

describe("soltar imagem no markdown", () => {
  it("só trata como imagem se todos os arquivos são imagens", () => {
    expect(isImagePath("C:\\x\\Foto.PNG")).toBe(true);
    expect(isImagePath("a.jpeg")).toBe(true);
    expect(isImagePath("a.svg")).toBe(false);
    expect(isImagePath("a.md")).toBe(false);
    expect(allImages(["a.png", "b.webp"])).toBe(true);
    expect(allImages(["a.png", "b.md"])).toBe(false);
    expect(allImages([])).toBe(false);
  });

  it("mostra a linha, a pasta e se a imagem é nova ou já existe", () => {
    const nova = { target: "imagens/notas/9f3a.png", name: "9f3a.png", reused: false };
    expect(imageDropText(1, 12, [nova], null)).toEqual({
      title: "Solte para inserir a imagem",
      detail: "linha 12 · imagens/notas/9f3a.png (nova)",
    });
    expect(imageDropText(1, 3, [{ ...nova, reused: true }], null).detail).toContain("já existe, será reaproveitada");
    expect(imageDropText(1, 3, [{ target: "file:///home/u/dados/images/a/9f.png", name: "9f.png", reused: false }], null).detail).toContain("pasta de dados do app");
  });

  it("várias imagens: conta e diz quantas já existem", () => {
    const a = { target: "imagens/n/a.png", name: "a.png", reused: true };
    const b = { target: "imagens/n/b.png", name: "b.png", reused: false };
    expect(imageDropText(2, 1, [a, b], null)).toEqual({ title: "Solte para inserir 2 imagens", detail: "linha 1 · 2 imagens em imagens/n/ (1 já existe)" });
  });

  it("enquanto verifica e quando dá erro", () => {
    expect(imageDropText(1, 5, null, null).detail).toBe("linha 5 · verificando…");
    expect(imageDropText(1, 5, null, "imagem grande demais").detail).toBe("linha 5 · imagem grande demais");
  });

  it("o aviso de imagem deixa o editor visível e volta ao normal", () => {
    const host = document.createElement("div");
    const drop = createFileDrop(host);
    const el = host.querySelector<HTMLElement>(".filedrop")!;
    drop.showImage("Solte para inserir a imagem", "linha 2 · imagens/n/a.png (nova)");
    expect(el.classList.contains("image")).toBe(true);
    expect(el.textContent).toContain("linha 2");
    drop.show(1);
    expect(el.classList.contains("image")).toBe(false);
    expect(host.querySelector<HTMLElement>(".filedrop-sub")!.hidden).toBe(true);
    drop.hide();
    expect(el.hidden).toBe(true);
  });
});
