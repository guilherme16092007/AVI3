/**
 * Biblioteca estatistica minima da camada analitica.
 *
 * Os nomes e a semantica seguem a biblioteca `simple-statistics` (mean, median, standardDeviation,
 * quantile, linearRegression), de modo que, quando o pacote puder ser instalado, a troca e direta.
 * Foi implementada internamente (sem dependencia nova) para manter o build reprodutivel e identico
 * em Windows e Linux; as funcoes sao puras e cobertas por testes (tests/server/analise.test.ts).
 *
 * Convencao: colecoes vazias devolvem `null` (nunca NaN), para que o JSON final seja sempre valido.
 */

export function soma(valores: readonly number[]): number {
  return valores.reduce((total, v) => total + v, 0);
}

export function media(valores: readonly number[]): number | null {
  return valores.length === 0 ? null : soma(valores) / valores.length;
}

export function mediana(valores: readonly number[]): number | null {
  return percentil(valores, 50);
}

/** Variancia POPULACIONAL (divide por n), como `simple-statistics.variance`. */
export function variancia(valores: readonly number[]): number | null {
  const m = media(valores);
  if (m === null) return null;
  return soma(valores.map((v) => (v - m) ** 2)) / valores.length;
}

export function desvioPadrao(valores: readonly number[]): number | null {
  const v = variancia(valores);
  return v === null ? null : Math.sqrt(v);
}

/** Percentil `p` (0..100) por interpolacao linear entre as posicoes vizinhas (metodo "R-7"). */
export function percentil(valores: readonly number[], p: number): number | null {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const pos = (Math.min(Math.max(p, 0), 100) / 100) * (ordenados.length - 1);
  const baixo = Math.floor(pos);
  const alto = Math.ceil(pos);
  return ordenados[baixo] + (ordenados[alto] - ordenados[baixo]) * (pos - baixo);
}

export function minimo(valores: readonly number[]): number | null {
  return valores.length === 0 ? null : Math.min(...valores);
}

export function maximo(valores: readonly number[]): number | null {
  return valores.length === 0 ? null : Math.max(...valores);
}

export interface Ponto {
  x: number;
  y: number;
}

export interface RegressaoLinear {
  /** Coeficiente angular (variacao de y por unidade de x). */
  inclinacao: number;
  /** Valor de y em x = 0. */
  intercepto: number;
  /** Coeficiente de determinacao (0..1); null quando y e constante. */
  r2: number | null;
  n: number;
}

/**
 * Minimos quadrados ordinarios (OLS) para y = intercepto + inclinacao * x.
 * Devolve null se houver menos de 2 pontos ou se todos os x forem iguais (reta indeterminada).
 */
export function regressaoLinear(pontos: readonly Ponto[]): RegressaoLinear | null {
  const n = pontos.length;
  if (n < 2) return null;
  const mx = soma(pontos.map((p) => p.x)) / n;
  const my = soma(pontos.map((p) => p.y)) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of pontos) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
    syy += (p.y - my) ** 2;
  }
  if (sxx === 0) return null;
  const inclinacao = sxy / sxx;
  const intercepto = my - inclinacao * mx;
  const r2 = syy === 0 ? null : (sxy * sxy) / (sxx * syy);
  return { inclinacao, intercepto, r2, n };
}

export function arredondar(valor: number | null, casas = 2): number | null {
  if (valor === null || !Number.isFinite(valor)) return null;
  const f = 10 ** casas;
  return Math.round(valor * f) / f;
}

export const MS_POR_HORA = 3_600_000;
export const MS_POR_DIA = 86_400_000;
