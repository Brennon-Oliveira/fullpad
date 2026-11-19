import { describe, expect, it, vi } from "vitest";
import { markdownToBody, markdownToHtml } from "./mdexport";

const png = () => new Uint8Array([137, 80, 78, 71]).buffer;

describe("exportação com imagens locais", () => {
  it("embute a imagem local em data: (HTML autônomo)", async () => {
    const read = vi.fn().mockResolvedValue(png());
    const html = await markdownToHtml("# T\n\n![foto](imagens/n/a%20b.png)\n", "t", false, { base: "/notas", read });
    expect(html).toContain('src="data:image/png;base64,iVBORw=="');
    expect(html).not.toContain("imagens/n");
    expect(read).toHaveBeenCalledWith("imagens/n/a b.png", "/notas");
  });

  it("lê uma imagem repetida uma vez só", async () => {
    const read = vi.fn().mockResolvedValue(png());
    await markdownToBody("![a](x.png) e ![b](x.png)", "htmlAndMathml", { base: null, read });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("imagem que não carrega vira o texto alternativo, sem quebrar", async () => {
    const read = vi.fn().mockRejectedValue("não encontrada");
    const body = await markdownToBody("antes ![uma <foto>](sumiu.png) depois", "htmlAndMathml", { base: null, read });
    expect(body).toContain('<span class="img-missing">uma &lt;foto&gt;</span>');
    expect(body).not.toContain("<img");
    expect(body).toContain("antes");
    expect(body).toContain("depois");
  });

  it("deixa a imagem de rede como está e não lê nada", async () => {
    const read = vi.fn();
    const body = await markdownToBody("![a](https://x.com/a.png)", "htmlAndMathml", { base: null, read });
    expect(body).toContain('src="https://x.com/a.png"');
    expect(read).not.toHaveBeenCalled();
  });

  it("sem fonte de imagens, o caminho fica como estava", async () => {
    expect(await markdownToBody("![a](x.png)")).toContain('src="x.png"');
  });
});
