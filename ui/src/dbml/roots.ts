/**
 * Módulo `.dbmlx` aberto a partir de um arquivo que o inclui (Ctrl+clique no `!include`): lembra a **raiz**
 * por caminho (`localStorage` `fullpad.dbmlRoots`, as 200 últimas), para o módulo compilar com o contexto dela
 * (as tabelas dos outros arquivos e as relações entre módulos) e para a aba voltar a ela, mesmo depois de reabrir.
 * Funções puras sobre o texto guardado; quem lê e grava o storage é o chamador.
 */

const MAX_ENTRIES = 200;

/** Só vale o que é mapa caminho → caminho (texto não vazio): o resto é descartado, sem derrubar o resto. */
export function parseRoots(raw: string | null | undefined): Record<string, string> {
  try {
    const o = JSON.parse(raw ?? "{}");
    if (!o || typeof o !== "object" || Array.isArray(o)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(o)) if (typeof v === "string" && v !== "" && k !== "") out[k] = v;
    return out;
  } catch {
    return {};
  }
}

/** Acrescenta (ou troca) a raiz do módulo; o mais recente fica por último. Um módulo não é raiz de si mesmo. */
export function withRoot(map: Record<string, string>, child: string, root: string): Record<string, string> {
  const next = { ...map };
  delete next[child];
  if (child === root) return next;
  next[child] = root;
  const keys = Object.keys(next);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete next[k];
  return next;
}

/** A raiz mais alta de um módulo: se quem o abriu também é módulo de outro arquivo, vale esse. */
export function topRoot(map: Record<string, string>, path: string): string {
  let cur = path;
  const seen = new Set<string>();
  while (map[cur] && !seen.has(cur)) {
    seen.add(cur);
    cur = map[cur];
  }
  return cur;
}
