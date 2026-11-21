import { ErroAutenticacao, ErroDominio, ErroValidacao } from "../../types";
import { ErroHttp } from "../erros";

export interface OpcoesBackoff {
  baseMs: number;
  maxMs: number;
  /** Fracao de jitter (0..1) somada ao atraso para evitar que varias tarefas voltem ao mesmo tempo. */
  jitter?: number;
  aleatorio?: () => number;
}

/** Backoff exponencial: base * 2^(tentativa-1), limitado a maxMs, mais jitter. `tentativa` comeca em 1 (apos a 1a falha). */
export function calcularBackoffMs(tentativa: number, o: OpcoesBackoff): number {
  const exponencial = Math.min(o.baseMs * 2 ** Math.max(tentativa - 1, 0), o.maxMs);
  const jitter = (o.jitter ?? 0.2) * (o.aleatorio ?? Math.random)();
  return Math.round(exponencial * (1 + jitter));
}

/**
 * Erros de regra de negocio/validacao/autorizacao (4xx) nao melhoram com nova tentativa: falham de imediato.
 * Qualquer outro erro (banco indisponivel, timeout, bug transitorio) e considerado recuperavel e sofre retry.
 */
export function erroRecuperavel(erro: unknown): boolean {
  if (erro instanceof ErroDominio || erro instanceof ErroValidacao || erro instanceof ErroAutenticacao) return false;
  if (erro instanceof ErroHttp) return erro.statusCode >= 500;
  return true;
}
