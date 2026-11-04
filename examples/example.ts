// Pequena biblioteca de eventos tipados + store reativa — exemplo de TypeScript para o Fullpad.

export type Unsubscribe = () => void;

export interface Eventos {
  "nota:criada": { id: string; titulo: string };
  "nota:fechada": { id: string; motivo: "usuario" | "janela" };
  "tema:mudou": "claro" | "escuro";
}

type Handler<K extends keyof Eventos> = (payload: Eventos[K]) => void;

export class Emissor {
  #ouvintes = new Map<keyof Eventos, Set<Handler<any>>>();

  on<K extends keyof Eventos>(evento: K, handler: Handler<K>): Unsubscribe {
    const set = this.#ouvintes.get(evento) ?? new Set();
    set.add(handler);
    this.#ouvintes.set(evento, set);
    return () => set.delete(handler);
  }

  emit<K extends keyof Eventos>(evento: K, payload: Eventos[K]): void {
    this.#ouvintes.get(evento)?.forEach((h) => h(payload));
  }
}

// ---------- Tipos utilitários ----------

type SomenteLeitura<T> = { readonly [K in keyof T]: T[K] extends object ? SomenteLeitura<T[K]> : T[K] };
type Chaves<T, V> = { [K in keyof T]: T[K] extends V ? K : never }[keyof T];

interface Config {
  tema: "claro" | "escuro";
  fonte: { familia: string; tamanho: number };
  autoSalvar: boolean;
}

type ChavesBooleanas = Chaves<Config, boolean>; // "autoSalvar"

// ---------- Store ----------

export type Seletor<S, R> = (estado: S) => R;

export function criarStore<S extends object>(inicial: S) {
  let estado = inicial;
  const inscritos = new Set<(s: SomenteLeitura<S>) => void>();

  return {
    get: (): SomenteLeitura<S> => estado as SomenteLeitura<S>,
    set(parcial: Partial<S> | ((s: S) => Partial<S>)) {
      const mudanca = typeof parcial === "function" ? parcial(estado) : parcial;
      estado = { ...estado, ...mudanca };
      inscritos.forEach((f) => f(estado as SomenteLeitura<S>));
    },
    assinar<R>(seletor: Seletor<SomenteLeitura<S>, R>, ouvir: (valor: R) => void): Unsubscribe {
      let ultimo = seletor(estado as SomenteLeitura<S>);
      const f = (s: SomenteLeitura<S>) => {
        const novo = seletor(s);
        if (!Object.is(novo, ultimo)) ouvir((ultimo = novo));
      };
      inscritos.add(f);
      return () => inscritos.delete(f);
    },
  };
}

// ---------- Resultado sem exceções ----------

export type Resultado<T, E = string> = { ok: true; valor: T } | { ok: false; erro: E };
const ok = <T,>(valor: T): Resultado<T> => ({ ok: true, valor });
const falha = <E,>(erro: E): Resultado<never, E> => ({ ok: false, erro });

export function lerTamanho(texto: string): Resultado<number> {
  const n = Number.parseInt(texto, 10);
  if (Number.isNaN(n)) return falha(`"${texto}" não é um número`);
  return n >= 8 && n <= 72 ? ok(n) : falha("o tamanho deve estar entre 8 e 72");
}

enum Direcao {
  Esquerda = "esquerda",
  Direita = "direita",
}

function inverter(d: Direcao): Direcao {
  switch (d) {
    case Direcao.Esquerda:
      return Direcao.Direita;
    case Direcao.Direita:
      return Direcao.Esquerda;
  }
}

// ---------- Uso ----------

const store = criarStore<Config>({ tema: "claro", fonte: { familia: "Inter", tamanho: 14 }, autoSalvar: true });
const emissor = new Emissor();

const parar = store.assinar(
  (s) => s.tema,
  (tema) => emissor.emit("tema:mudou", tema),
);

emissor.on("tema:mudou", (t) => console.log(`Tema agora é ${t}`));
store.set({ tema: "escuro" });
store.set((s) => ({ fonte: { ...s.fonte, tamanho: s.fonte.tamanho + 2 } }));
parar();

const r = lerTamanho("16");
console.log(r.ok ? `Tamanho ${r.valor}` : `Erro: ${r.erro}`, inverter(Direcao.Esquerda));
