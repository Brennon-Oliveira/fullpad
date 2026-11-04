/**
 * Equações: LaTeX → HTML do KaTeX. A biblioteca (e o CSS, e as fontes) só entram na primeira vez que uma
 * equação aparece, por `import()`: nada de importar `katex` estaticamente (não pode pesar a abertura do app).
 * Sempre `trust: false` (sem `\href`, `\url`, `\includegraphics`…) e sem rede; as fontes viajam no app
 * (`public/katex/fonts/`, copiadas pelo `vite.config.ts`).
 */

/** Acima disso a equação não é desenhada (o texto continua normal). */
export const MAX_MATH_CHARS = 10_000;

/** `htmlAndMathml`: o desenho de sempre. `mathml`: só MathML, sem CSS nem fontes (para colar em outro programa). */
export type MathOutput = "htmlAndMathml" | "mathml";

export type MathResult = { ok: true; html: string } | { ok: false; error: string };

type Katex = typeof import("katex").default;

let lib: Promise<Katex> | undefined;
let loaded: Katex | undefined;
const cache = new Map<string, MathResult>();
const CACHE_MAX = 500;
const STYLE_ID = "fp-katex-css";

function load(): Promise<Katex> {
  lib ??= import("katex").then((m) => (loaded = m.default));
  lib.catch(() => (lib = undefined)); // falhou ao carregar: tenta de novo na próxima vez
  return lib;
}

/** O CSS do KaTeX, com as fontes apontadas para a cópia que viaja no app e só a `.woff2`. */
export function katexCss(css: string, fontsBase: string): string {
  return css.replace(WOFF_AND_TTF, "").replace(/url\(fonts\//g, `url(${fontsBase}`);
}

const WOFF_AND_TTF = /,url\(fonts\/[^)]+\.woff\) format\("woff"\),url\(fonts\/[^)]+\.ttf\) format\("truetype"\)/g;

async function fetchFont(name: string): Promise<ArrayBuffer> {
  const res = await fetch(new URL(`katex/fonts/${name}`, document.baseURI));
  if (!res.ok) throw new Error(`fonte ${name}: ${res.status}`);
  return res.arrayBuffer();
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * O CSS do KaTeX com as fontes (`.woff2`) embutidas como `data:`, para o HTML exportado ser autônomo
 * (sem rede nem a pasta de fontes do app). Uma fonte que não carrega fica com o endereço de antes.
 */
export async function mathStyles(getFont: (name: string) => Promise<ArrayBuffer> = fetchFont): Promise<string> {
  const css = (await import("katex/dist/katex.min.css?raw")).default.replace(WOFF_AND_TTF, "");
  const names = [...new Set([...css.matchAll(/url\(fonts\/([^)]+)\)/g)].map((m) => m[1]!))];
  const data = new Map<string, string>();
  await Promise.all(
    names.map(async (n) => {
      try {
        data.set(n, `data:font/woff2;base64,${toBase64(await getFont(n))}`);
      } catch {
        /* fica sem a fonte: o navegador usa a de reserva */
      }
    }),
  );
  return css.replace(/url\(fonts\/([^)]+)\)/g, (m, n: string) => (data.has(n) ? `url(${data.get(n)})` : m));
}

let styled: Promise<void> | undefined;
/** Põe o CSS do KaTeX na página, uma vez. */
function ensureStyles(): Promise<void> {
  styled ??= import("katex/dist/katex.min.css?raw")
    .then((m) => {
      if (document.getElementById(STYLE_ID)) return;
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = katexCss(m.default, new URL("katex/fonts/", document.baseURI).href);
      document.head.append(style);
    })
    .catch((e) => {
      styled = undefined;
      console.error("falha ao carregar o CSS das equações", e);
    });
  return styled;
}

/** Mensagem do KaTeX sem o prefixo e sem o trecho repetido. */
export function cleanMathError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.replace(/^KaTeX parse error:\s*/i, "").split("\n")[0]!.trim() || "equação inválida";
}

const keyOf = (tex: string, display: boolean, output: MathOutput = "htmlAndMathml") => `${output === "mathml" ? "M" : "H"}${display ? "D" : "I"}\u0000${tex}`;

function draw(katex: Katex, tex: string, display: boolean, output: MathOutput = "htmlAndMathml"): MathResult {
  const key = keyOf(tex, display, output);
  const hit = cache.get(key);
  if (hit) return hit;
  let result: MathResult;
  if (tex.length > MAX_MATH_CHARS) result = { ok: false, error: "equação grande demais para desenhar" };
  else {
    try {
      const html = katex.renderToString(tex, {
        displayMode: display,
        throwOnError: true,
        trust: false,
        strict: "ignore",
        maxExpand: 1000,
        output,
      });
      result = { ok: true, html };
    } catch (e) {
      result = { ok: false, error: cleanMathError(e) };
    }
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, result);
  return result;
}

/** O resultado já desenhado (em cache) para esta equação, sem esperar. */
export function cachedMath(tex: string, display: boolean): MathResult | undefined {
  return cache.get(keyOf(tex, display));
}

/** Desenha a equação. Erro de sintaxe volta como `{ok:false}`, nunca como exceção. */
export async function renderMath(tex: string, display: boolean): Promise<MathResult> {
  const hit = cachedMath(tex, display);
  if (hit) return hit;
  try {
    const [katex] = await Promise.all([load(), ensureStyles()]);
    return draw(katex, tex, display);
  } catch (e) {
    return { ok: false, error: cleanMathError(e) };
  }
}

/** Carrega o KaTeX (para a exportação, que desenha de forma síncrona depois). */
export async function loadMath(): Promise<void> {
  await load();
}

/** Desenha já, se o KaTeX estiver carregado (`loadMath`); senão `null`. */
export function renderMathSync(tex: string, display: boolean, output: MathOutput = "htmlAndMathml"): MathResult | null {
  return loaded ? draw(loaded, tex, display, output) : null;
}

/** Só para os testes. */
export function resetMathForTests() {
  lib = undefined;
  loaded = undefined;
  styled = undefined;
  cache.clear();
  document.getElementById(STYLE_ID)?.remove();
}
