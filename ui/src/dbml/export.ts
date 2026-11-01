import type { Layout } from "./layout";

/** Propriedades de estilo copiadas do elemento vivo (o arquivo exportado não tem o CSS nem as variáveis do app). */
const PROPS = [
  "fill",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "text-anchor",
];
const PAD = 24;
const MAX_PX = 16000; // limite seguro de lado de canvas

function inlineStyles(live: Element, clone: Element) {
  const cs = getComputedStyle(live);
  const css = PROPS.map((p) => [p, cs.getPropertyValue(p)] as const)
    .filter(([, v]) => v !== "")
    .map(([p, v]) => `${p}:${v}`)
    .join(";");
  if (css) clone.setAttribute("style", css);
  for (let i = 0; i < live.children.length; i++) inlineStyles(live.children[i], clone.children[i]);
}

export function bounds(layout: Layout) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of layout.boxes.values()) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  if (!isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0 - PAD, y: y0 - PAD, w: x1 - x0 + PAD * 2, h: y1 - y0 + PAD * 2 };
}

/** SVG autônomo do diagrama: estilos resolvidos em linha, fundo sólido, sem áreas de interação. */
export function buildSvg(live: SVGGElement, layout: Layout, background: string) {
  const b = bounds(layout);
  const clone = live.cloneNode(true) as SVGGElement;
  inlineStyles(live, clone);
  clone.removeAttribute("transform");
  clone.removeAttribute("class");
  clone.querySelectorAll(".dbml-row, .dbml-hit").forEach((e) => e.remove());
  const body = new XMLSerializer().serializeToString(clone);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${b.w}" height="${b.h}" viewBox="${b.x} ${b.y} ${b.w} ${b.h}">` +
    `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${background}"/>${body}</svg>`;
  return { svg, width: b.w, height: b.h };
}

export async function svgToPng(svg: string, width: number, height: number, scale = 2): Promise<Uint8Array> {
  const k = Math.min(scale, MAX_PX / Math.max(width, height, 1));
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * k));
    canvas.height = Math.max(1, Math.round(height * k));
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
    if (!blob) throw new Error("não foi possível gerar o PNG");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}
