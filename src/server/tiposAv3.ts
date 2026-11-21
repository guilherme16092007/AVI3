/**
 * Enumeracoes da AV3 (camada analitica, API publica e fila de tarefas).
 * Os valores espelham, um a um, os enums criados em prisma/schema.prisma.
 */

export enum PermissaoApi {
  RASTREABILIDADE_LER = "RASTREABILIDADE_LER",
  LOTES_LER = "LOTES_LER",
  LOTES_ESCREVER = "LOTES_ESCREVER",
  ANALISES_LER = "ANALISES_LER",
  RELATORIOS_GERAR = "RELATORIOS_GERAR",
}

export enum TipoRelatorio {
  EFICIENCIA_OPERACIONAL = "EFICIENCIA_OPERACIONAL",
  RENTABILIDADE_EQUIPAMENTO = "RENTABILIDADE_EQUIPAMENTO",
  VIDA_UTIL_REMANESCENTE = "VIDA_UTIL_REMANESCENTE",
}

export enum OrigemRelatorio {
  MANUAL = "MANUAL",
  AGENDADO = "AGENDADO",
  API = "API",
}

export enum StatusTarefa {
  PENDENTE = "PENDENTE",
  EM_EXECUCAO = "EM_EXECUCAO",
  CONCLUIDA = "CONCLUIDA",
  FALHA = "FALHA",
}

export enum FormatoSaida {
  JSON = "JSON",
  CSV = "CSV",
}

/** Tipos de tarefa suportados pelo processador da fila. */
export type TipoTarefa = "GERAR_RELATORIO";

/** Slug usado nas URLs da API para cada tipo de relatorio. */
export const SLUG_RELATORIO: Record<TipoRelatorio, string> = {
  [TipoRelatorio.EFICIENCIA_OPERACIONAL]: "eficiencia-operacional",
  [TipoRelatorio.RENTABILIDADE_EQUIPAMENTO]: "rentabilidade",
  [TipoRelatorio.VIDA_UTIL_REMANESCENTE]: "vida-util",
};

export function tipoRelatorioPorSlug(slug: string): TipoRelatorio | undefined {
  return (Object.keys(SLUG_RELATORIO) as TipoRelatorio[]).find((t) => SLUG_RELATORIO[t] === slug);
}
