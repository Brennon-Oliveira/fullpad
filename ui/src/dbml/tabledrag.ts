const THRESHOLD = 3; // px da tela: abaixo disso é clique, não arrasto

/** O que se arrasta: uma tabela (pelo cabeçalho), um grupo (pela faixa do título) ou o canto da moldura de um grupo. */
export type DragKind = "table" | "group" | "resize";

export interface TableDragHooks {
  /** Escala de agora do viewport (pixels da tela por unidade do diagrama). */
  scale(): number;
  /** Arrastar vale agora? (não vale sem layout para guardar, ou com o layout inválido) */
  enabled(): boolean;
  /** Começou a pressionar `id` (id da tabela ou nome do grupo): guarde o ponto de partida. `false` recusa. */
  start(kind: DragKind, id: string): boolean;
  /** O ponteiro andou `dx`, `dy` (unidades do diagrama, desde o ponto de partida): a cada movimento; quem recebe redesenha. */
  move(kind: DragKind, id: string, dx: number, dy: number): void;
  /** Soltou depois de mover. */
  end(kind: DragKind, id: string, dx: number, dy: number): void;
}

/**
 * Arrastar tabelas, grupos e a moldura dos grupos. Escuta no `<g>` do diagrama, **antes** do pan do
 * viewport (que está no `<svg>`): o evento que começa numa alça não chega lá. Arrastar o fundo
 * continua movendo a vista. O corpo da tabela continua sendo de clique e de passar o mouse.
 */
export function attachTableDrag(svg: SVGSVGElement, g: SVGGElement, hooks: TableDragHooks) {
  let drag: { kind: DragKind; id: string; sx: number; sy: number; moved: boolean; pointer: number } | null = null;

  const pick = (target: Element | null): { kind: DragKind; id: string } | null => {
    if (!target?.closest) return null;
    const resize = target.closest(".dbml-group-resize");
    if (resize) {
      const name = resize.closest(".dbml-group")?.getAttribute("data-grp");
      return name ? { kind: "resize", id: name } : null;
    }
    const move = target.closest(".dbml-group-move");
    if (move) {
      const name = move.closest(".dbml-group")?.getAttribute("data-grp");
      return name ? { kind: "group", id: name } : null;
    }
    const head = target.closest(".dbml-head, .dbml-title");
    const id = head?.closest(".dbml-table")?.getAttribute("data-t");
    return id ? { kind: "table", id } : null;
  };

  g.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !hooks.enabled()) return;
    const hit = pick(e.target as Element | null);
    if (!hit || !hooks.start(hit.kind, hit.id)) return;
    e.stopPropagation(); // não deixa o viewport começar a mover a vista
    drag = { ...hit, sx: e.clientX, sy: e.clientY, moved: false, pointer: e.pointerId };
    svg.setPointerCapture(e.pointerId);
    svg.classList.add("dragging-table");
  });

  const delta = (e: PointerEvent) => {
    const k = hooks.scale() || 1;
    return { dx: Math.round((e.clientX - drag!.sx) / k), dy: Math.round((e.clientY - drag!.sy) / k) };
  };

  svg.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < THRESHOLD) return;
    drag.moved = true;
    const { dx, dy } = delta(e);
    hooks.move(drag.kind, drag.id, dx, dy);
  });

  const finish = (e: PointerEvent, cancel: boolean) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const d = drag;
    const { dx, dy } = delta(e);
    drag = null;
    svg.classList.remove("dragging-table");
    if (!d.moved) return;
    if (cancel) hooks.move(d.kind, d.id, 0, 0);
    else hooks.end(d.kind, d.id, dx, dy);
  };
  svg.addEventListener("pointerup", (e) => finish(e, false));
  svg.addEventListener("pointercancel", (e) => finish(e, true));
}
