const MIN_K = 0.1;
const MAX_K = 3;

/** Pan (arrastar) e zoom (roda) sobre um `<g>`. Mantém a transformação entre re-renderizações. */
export function attachViewport(svg: SVGSVGElement, g: SVGGElement) {
  let k = 1;
  let tx = 0;
  let ty = 0;
  const apply = () => g.setAttribute("transform", `translate(${tx} ${ty}) scale(${k})`);

  svg.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      const nk = Math.min(MAX_K, Math.max(MIN_K, k * Math.exp(-e.deltaY * 0.0015)));
      tx = px - ((px - tx) * nk) / k;
      ty = py - ((py - ty) * nk) / k;
      k = nk;
      apply();
    },
    { passive: false },
  );

  let drag: { x: number; y: number } | null = null;
  svg.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX - tx, y: e.clientY - ty };
    svg.setPointerCapture(e.pointerId);
    svg.classList.add("panning");
  });
  svg.addEventListener("pointermove", (e) => {
    if (!drag) return;
    tx = e.clientX - drag.x;
    ty = e.clientY - drag.y;
    apply();
  });
  const end = () => {
    drag = null;
    svg.classList.remove("panning");
  };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);

  return {
    /** Ajusta o conteúdo (largura x altura do layout) à área visível. */
    fit(width: number, height: number) {
      const r = svg.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || width === 0 || height === 0) return;
      k = Math.min(1, Math.min(r.width / width, r.height / height));
      tx = (r.width - width * k) / 2;
      ty = Math.max(8, (r.height - height * k) / 2);
      apply();
    },
  };
}
