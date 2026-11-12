import type { Box } from "./layout";

const THRESHOLD = 3; // px da tela: abaixo disso é clique, não arrasto

export interface TableDragHooks {
  /** Escala de agora do viewport (pixels da tela por unidade do diagrama). */
  scale(): number;
  /** Caixa atual da tabela `id` (`null` se não existe). */
  box(id: string): Box | null;
  /** A tabela foi para `x`, `y` (a cada movimento; quem recebe redesenha). */
  move(id: string, x: number, y: number): void;
  /** Soltou depois de mover: a tabela ficou em `x`, `y`. */
  end(id: string, x: number, y: number): void;
  /** Arrastar vale agora? (não vale sem layout para guardar, ou com o layout inválido) */
  enabled(): boolean;
}

/**
 * Arrastar uma tabela pelo cabeçalho (o corpo continua sendo de clique e de passar o mouse).
 * Escuta no `<g>` do diagrama, **antes** do pan do viewport (que está no `<svg>`): o evento que
 * começa numa tabela não chega lá. Arrastar o fundo continua movendo a vista.
 */
export function attachTableDrag(svg: SVGSVGElement, g: SVGGElement, hooks: TableDragHooks) {
  let drag: { id: string; sx: number; sy: number; bx: number; by: number; moved: boolean; pointer: number } | null = null;

  g.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !hooks.enabled()) return;
    const head = (e.target as Element | null)?.closest?.(".dbml-head, .dbml-title");
    const table = head?.closest<SVGElement>(".dbml-table");
    const id = table?.getAttribute("data-t");
    if (!id) return;
    const b = hooks.box(id);
    if (!b) return;
    e.stopPropagation(); // não deixa o viewport começar a mover a vista
    drag = { id, sx: e.clientX, sy: e.clientY, bx: b.x, by: b.y, moved: false, pointer: e.pointerId };
    svg.setPointerCapture(e.pointerId);
    svg.classList.add("dragging-table");
  });

  svg.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const dx = e.clientX - drag.sx;
    const dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < THRESHOLD) return;
    drag.moved = true;
    const k = hooks.scale() || 1;
    hooks.move(drag.id, Math.round(drag.bx + dx / k), Math.round(drag.by + dy / k));
  });

  const finish = (e: PointerEvent, cancel: boolean) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const d = drag;
    drag = null;
    svg.classList.remove("dragging-table");
    if (!d.moved) return;
    if (cancel) {
      hooks.move(d.id, d.bx, d.by);
      return;
    }
    const k = hooks.scale() || 1;
    hooks.end(d.id, Math.round(d.bx + (e.clientX - d.sx) / k), Math.round(d.by + (e.clientY - d.sy) / k));
  };
  svg.addEventListener("pointerup", (e) => finish(e, false));
  svg.addEventListener("pointercancel", (e) => finish(e, true));
}
