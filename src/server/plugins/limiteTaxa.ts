/**
 * Limitador de taxa por janela deslizante (contador ponderado entre a janela atual e a anterior).
 * Memoria O(1) por chave, sem rajadas de 2x na virada de janela como no "fixed window".
 * Equivalente funcional ao @fastify/rate-limit com store em memoria. Para varias instancias da API
 * o contador precisa ser compartilhado (Redis) — ver docs/RELATORIO_TECNICO_AV3.md (plano de evolucao).
 */
export interface ResultadoLimite {
  permitido: boolean;
  limite: number;
  restante: number;
  /** Segundos ate a janela deslizar o suficiente para liberar novas requisicoes (>= 1). */
  reiniciaEmSeg: number;
}

interface Janela {
  inicio: number;
  atual: number;
  anterior: number;
}

export class LimitadorTaxa {
  private readonly janelas = new Map<string, Janela>();
  private ultimaLimpeza = 0;

  constructor(
    private readonly janelaMs = 60_000,
    private readonly agora: () => number = () => Date.now()
  ) {}

  private estado(chave: string, t: number): Janela {
    let j = this.janelas.get(chave);
    if (!j) {
      j = { inicio: t, atual: 0, anterior: 0 };
      this.janelas.set(chave, j);
      return j;
    }
    const n = Math.floor((t - j.inicio) / this.janelaMs);
    if (n >= 1) {
      j.anterior = n === 1 ? j.atual : 0;
      j.atual = 0;
      j.inicio += n * this.janelaMs;
    }
    return j;
  }

  private estimativa(j: Janela, t: number): number {
    return j.anterior * (1 - (t - j.inicio) / this.janelaMs) + j.atual;
  }

  private resultado(j: Janela, t: number, limite: number, permitido: boolean): ResultadoLimite {
    return {
      permitido,
      limite,
      restante: Math.max(0, Math.floor(limite - this.estimativa(j, t))),
      reiniciaEmSeg: Math.max(1, Math.ceil((j.inicio + this.janelaMs - t) / 1000)),
    };
  }

  /** Verifica sem consumir. */
  consultar(chave: string, limite: number): ResultadoLimite {
    const t = this.agora();
    const j = this.estado(chave, t);
    return this.resultado(j, t, limite, this.estimativa(j, t) + 1 <= limite);
  }

  /** Consome 1 unidade se houver saldo. */
  consumir(chave: string, limite: number): ResultadoLimite {
    const t = this.agora();
    this.limparSeNecessario(t);
    const j = this.estado(chave, t);
    const permitido = this.estimativa(j, t) + 1 <= limite;
    if (permitido) j.atual += 1;
    return this.resultado(j, t, limite, permitido);
  }

  limpar(): void {
    this.janelas.clear();
  }

  private limparSeNecessario(t: number): void {
    if (t - this.ultimaLimpeza < this.janelaMs) return;
    this.ultimaLimpeza = t;
    for (const [chave, j] of this.janelas) if (t - j.inicio >= 2 * this.janelaMs) this.janelas.delete(chave);
  }
}
