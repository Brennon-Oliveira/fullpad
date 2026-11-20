const MIN_K = 0.1;
const MAX_K = 3;

/** Pan (arrastar) e zoom (roda) sobre um `<g>`. Mantém a transformação entre re-renderizações. */
export function attachViewport(svg: SVGSVGElement, g: SVGGElement, onChange?: () => void) {
  let k = 1;
  let tx = 0;
  let ty = 0;
  let anim = 0;
  const apply = () => g.setAttribute("transform", `translate(${tx} ${ty}) scale(${k})`);

  svg.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      cancelAnimationFrame(anim);
      const r = svg.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      const nk = Math.min(MAX_K, Math.max(MIN_K, k * Math.exp(-e.deltaY * 0.0015)));
      tx = px - ((px - tx) * nk) / k;
      ty = py - ((py - ty) * nk) / k;
      k = nk;
      apply();
      onChange?.();
    },
    { passive: false },
  );

  let drag: { x: number; y: number } | null = null;
  svg.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    cancelAnimationFrame(anim);
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
    if (drag) onChange?.();
    drag = null;
    svg.classList.remove("panning");
  };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);

  return {
    /** Traz a caixa (coordenadas do layout) à vista, só deslocando; não mexe no zoom. */
    reveal(box: { x: number; y: number; w: number; h: number }, margin = 24) {
      const r = svg.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const fit = (pos: number, size: number, t: number, view: number): number => {
        const a = pos * k + t, b = (pos + size) * k + t;
        if (a >= margin && b <= view - margin) return t; // já visível
        if ((size * k) > view - 2 * margin) return margin - pos * k; // maior que a tela: alinha o início
        return view / 2 - (pos + size / 2) * k; // centraliza
      };
      tx = fit(box.x, box.w, tx, r.width);
      ty = fit(box.y, box.h, ty, r.height);
      apply();
    },
    /** O enquadramento de agora: deslocamento (px) e zoom, como o layout salvo guarda. */
    get(): { x: number; y: number; zoom: number } {
      return { x: Math.round(tx), y: Math.round(ty), zoom: k };
    },
    /** Põe um enquadramento salvo (limita o zoom e ignora valores que não são números). */
    set(v: { x: number; y: number; zoom: number }) {
      if (![v.x, v.y, v.zoom].every(Number.isFinite)) return;
      k = Math.min(MAX_K, Math.max(MIN_K, v.zoom));
      tx = v.x;
      ty = v.y;
      apply();
    },
    /**
     * Dá zoom numa caixa (coordenadas do layout): enquadra-a no centro com uma folga, até o zoom máximo.
     * Anima a passagem (`animate`), a menos que a pessoa prefira menos movimento.
     */
    focus(box: { x: number; y: number; w: number; h: number }, animate = true, margin = 120) {
      const r = svg.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || box.w <= 0 || box.h <= 0) return;
      const nk = Math.min(MAX_K, Math.max(MIN_K, Math.min((r.width - 2 * margin) / box.w, (r.height - 2 * margin) / box.h)));
      const ntx = r.width / 2 - (box.x + box.w / 2) * nk;
      const nty = r.height / 2 - (box.y + box.h / 2) * nk;
      const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
      cancelAnimationFrame(anim);
      if (!animate || reduce || typeof requestAnimationFrame !== "function") {
        k = nk;
        tx = ntx;
        ty = nty;
        apply();
        onChange?.();
        return;
      }
      const from = { k, tx, ty }, t0 = performance.now(), DUR = 280;
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / DUR);
        const e = 1 - (1 - p) ** 3; // desacelera no fim
        // a escala anda no log (o zoom é multiplicativo) e o deslocamento acompanha, para o centro não "voar"
        k = from.k * (nk / from.k) ** e;
        tx = from.tx + (ntx - from.tx) * e;
        ty = from.ty + (nty - from.ty) * e;
        apply();
        if (p < 1) anim = requestAnimationFrame(step);
        else onChange?.();
      };
      anim = requestAnimationFrame(step);
    },
    /** Escala de agora (pixels da tela por unidade do diagrama). */
    scale: () => k,
    /** Ajusta o conteúdo (largura x altura do layout, a partir de x0, y0) à área visível. */
    fit(width: number, height: number, x0 = 0, y0 = 0) {
      const r = svg.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || width === 0 || height === 0) return;
      k = Math.min(1, Math.min(r.width / width, r.height / height));
      tx = (r.width - width * k) / 2 - x0 * k;
      ty = Math.max(8, (r.height - height * k) / 2) - y0 * k;
      apply();
    },
  };
}
