/**
 * Diagramas Mermaid: texto → SVG. A biblioteca é pesada, então só entra por `import()` na primeira vez
 * que um diagrama aparece (nada de importar `mermaid` estaticamente: não pode pesar a abertura do app).
 * Sempre `securityLevel: "strict"` (sem HTML nem scripts nos rótulos) e sem rede.
 */

/** Acima disso o diagrama não é desenhado (o texto continua normal), como `MAX_DIAGRAM_CHARS` do DBML. */
export const MAX_MERMAID_CHARS = 100_000;

export type MermaidResult = { ok: true; svg: string } | { ok: false; error: string };

/** O texto depois dos três acentos graves é `mermaid` (a primeira palavra, sem diferenciar maiúsculas). */
export function isMermaidInfo(info: string): boolean {
  return /^mermaid$/i.test(info.trim().split(/\s+/)[0] ?? "");
}

type Mermaid = typeof import("mermaid").default;

let lib: Promise<Mermaid> | undefined;
let configuredFor: boolean | undefined;
let counter = 0;
let chain: Promise<unknown> = Promise.resolve();
const cache = new Map<string, MermaidResult>();
const CACHE_MAX = 60;

function load(): Promise<Mermaid> {
  lib ??= import("mermaid").then((m) => m.default);
  lib.catch(() => (lib = undefined)); // falhou ao carregar: tenta de novo na próxima vez
  return lib;
}

/** Mensagem do parser sem o ruído (primeira linha útil). */
export function cleanError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const line = raw
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !/^Syntax error in (text|graph)/i.test(l));
  return (line ?? raw.trim()) || "diagrama inválido";
}

/** O resultado já desenhado (em cache) para este texto e tema, sem esperar. */
export function cachedMermaid(code: string, dark: boolean): MermaidResult | undefined {
  return cache.get(`${dark ? "d" : "l"}\u0000${code}`);
}

/**
 * Desenha o diagrama. `dark` escolhe o tema (claro/escuro do app). As chamadas são enfileiradas (o
 * Mermaid usa elementos temporários na página e não gosta de desenhos ao mesmo tempo) e o resultado
 * fica em cache por texto e tema.
 */
export function renderMermaid(code: string, dark: boolean): Promise<MermaidResult> {
  if (code.length > MAX_MERMAID_CHARS) {
    return Promise.resolve({ ok: false, error: "diagrama grande demais para desenhar" });
  }
  const key = `${dark ? "d" : "l"}\u0000${code}`;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const job = chain.then(async (): Promise<MermaidResult> => {
    const cached = cache.get(key);
    if (cached) return cached;
    let result: MermaidResult;
    try {
      const mermaid = await load();
      if (configuredFor !== dark) {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: dark ? "dark" : "default",
          suppressErrorRendering: true,
          fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
        });
        configuredFor = dark;
      }
      const { svg } = await mermaid.render(`fp-mermaid-${++counter}`, code);
      result = { ok: true, svg };
    } catch (e) {
      result = { ok: false, error: cleanError(e) };
    } finally {
      document.getElementById(`dfp-mermaid-${counter}`)?.remove(); // sobra do desenho que falhou
    }
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(key, result);
    return result;
  });
  chain = job.catch(() => {});
  return job;
}

/** Só para os testes. */
export function resetMermaidForTests() {
  lib = undefined;
  configuredFor = undefined;
  chain = Promise.resolve();
  cache.clear();
}
