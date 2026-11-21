import { FormatoSaida, SLUG_RELATORIO, TipoRelatorio } from "../tiposAv3";
import { paraCsv } from "./csv";

export interface ArquivoRelatorio {
  conteudo: string;
  mime: string;
  nomeArquivo: string;
}

/** Linhas "planas" de cada relatorio (uma por lote / por equipamento), usadas na exportacao CSV. */
function linhasPlanas(tipo: TipoRelatorio, resultado: any): Array<Record<string, any>> {
  switch (tipo) {
    case TipoRelatorio.EFICIENCIA_OPERACIONAL:
      return resultado.lotes ?? [];
    case TipoRelatorio.RENTABILIDADE_EQUIPAMENTO:
    case TipoRelatorio.VIDA_UTIL_REMANESCENTE:
      return resultado.equipamentos ?? [];
  }
}

export function nomeArquivoRelatorio(tipo: TipoRelatorio, relatorioId: string, formato: FormatoSaida): string {
  return `relatorio-${SLUG_RELATORIO[tipo]}-${relatorioId}.${formato === FormatoSaida.CSV ? "csv" : "json"}`;
}

export function renderizarRelatorio(
  tipo: TipoRelatorio,
  resultado: unknown,
  formato: FormatoSaida,
  relatorioId: string
): ArquivoRelatorio {
  if (formato === FormatoSaida.CSV) {
    return { conteudo: paraCsv(linhasPlanas(tipo, resultado)), mime: "text/csv; charset=utf-8", nomeArquivo: nomeArquivoRelatorio(tipo, relatorioId, formato) };
  }
  return {
    conteudo: JSON.stringify({ relatorioId, tipo, resultado }, null, 2),
    mime: "application/json; charset=utf-8",
    nomeArquivo: nomeArquivoRelatorio(tipo, relatorioId, formato),
  };
}
