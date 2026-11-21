import { TipoMovimentacao } from "../../types";
import { EquipamentoAnalitico } from "../repositorios/portas";
import { arredondar, desvioPadrao, maximo, media, mediana, minimo, MS_POR_HORA, percentil } from "./estatistica";

/** Amostra minima para comparar operadores/periodos e para apontar lotes atipicos (evita conclusoes com 1-2 pontos). */
export const AMOSTRA_MINIMA_COMPARACAO = 3;
/** Um lote e "atipico" (possivel gargalo) quando excede media + K desvios-padrao. */
export const FATOR_LIMITE_ATIPICO = 1.5;

export interface LinhaLoteEficiencia {
  loteId: string;
  organizacaoId: string;
  dataEntrada: string;
  equipamentos: number;
  triados: number;
  concluidoEm: string | null;
  duracaoHoras: number | null;
  situacao: "CONCLUIDO" | "EM_ANDAMENTO";
}

export interface EficienciaResultado {
  geradoEm: string;
  definicoes: { duracaoLote: string; tempoOperador: string };
  resumo: {
    lotesAnalisados: number;
    lotesConcluidos: number;
    lotesEmAndamento: number;
    equipamentosTriados: number;
    tempoMedioHoras: number | null;
    medianaHoras: number | null;
    desvioPadraoHoras: number | null;
    p90Horas: number | null;
    minimoHoras: number | null;
    maximoHoras: number | null;
  };
  porOperador: Array<{
    usuario: string;
    triagens: number;
    tempoMedioHoras: number | null;
    medianaHoras: number | null;
    desvioPadraoHoras: number | null;
  }>;
  porMes: Array<{ mes: string; lotesConcluidos: number; tempoMedioHoras: number | null }>;
  gargalos: {
    limiteAtipicoHoras: number | null;
    lotesAtipicos: Array<{ loteId: string; duracaoHoras: number; organizacaoId: string }>;
    operadorMaisLento: { usuario: string; tempoMedioHoras: number; razaoSobreMediaGeral: number } | null;
    mesMaisLento: { mes: string; tempoMedioHoras: number } | null;
  };
  lotes: LinhaLoteEficiencia[];
}

const horas = (deMs: number, ateMs: number): number => Math.max(0, (ateMs - deMs) / MS_POR_HORA);

function agrupar<T>(itens: T[], chave: (i: T) => string): Map<string, T[]> {
  const mapa = new Map<string, T[]>();
  for (const item of itens) {
    const k = chave(item);
    const lista = mapa.get(k);
    if (lista) lista.push(item);
    else mapa.set(k, [item]);
  }
  return mapa;
}

/**
 * Eficiencia operacional.
 *  - Duracao do lote = (instante em que o ULTIMO equipamento do lote foi triado) - (data de entrada do lote).
 *    So lotes com todos os equipamentos triados sao "concluidos"; os demais ficam EM_ANDAMENTO.
 *  - Tempo do operador = (instante da triagem) - (instante do cadastro do equipamento), por triagem realizada.
 */
export function calcularEficiencia(equipamentos: EquipamentoAnalitico[], agora: Date): EficienciaResultado {
  const linhas: LinhaLoteEficiencia[] = [];
  const temposOperador: Array<{ usuario: string; horas: number }> = [];

  for (const [loteId, itens] of agrupar(equipamentos, (e) => e.loteId)) {
    let triados = 0;
    let ultimaTriagemMs = 0;
    for (const eq of itens) {
      const triagem = eq.movimentacoes.find((m) => m.tipo === TipoMovimentacao.TRIAGEM);
      if (!triagem) continue;
      triados += 1;
      ultimaTriagemMs = Math.max(ultimaTriagemMs, triagem.criadoEm.getTime());
      const cadastro = eq.movimentacoes.find((m) => m.tipo === TipoMovimentacao.CADASTRO);
      const inicio = (cadastro?.criadoEm ?? eq.criadoEm).getTime();
      temposOperador.push({ usuario: triagem.usuarioUsername, horas: horas(inicio, triagem.criadoEm.getTime()) });
    }
    const concluido = triados === itens.length;
    const entradaMs = itens[0].loteDataEntrada.getTime();
    linhas.push({
      loteId,
      organizacaoId: itens[0].organizacaoId,
      dataEntrada: itens[0].loteDataEntrada.toISOString().slice(0, 10),
      equipamentos: itens.length,
      triados,
      concluidoEm: concluido ? new Date(ultimaTriagemMs).toISOString() : null,
      duracaoHoras: concluido ? arredondar(horas(entradaMs, ultimaTriagemMs)) : null,
      situacao: concluido ? "CONCLUIDO" : "EM_ANDAMENTO",
    });
  }
  linhas.sort((a, b) => a.dataEntrada.localeCompare(b.dataEntrada) || a.loteId.localeCompare(b.loteId));

  const concluidos = linhas.filter((l) => l.situacao === "CONCLUIDO");
  const duracoes = concluidos.map((l) => l.duracaoHoras as number);
  const mediaGeral = media(duracoes);
  const desvioGeral = desvioPadrao(duracoes);

  const porOperador = Array.from(agrupar(temposOperador, (t) => t.usuario), ([usuario, ts]) => {
    const valores = ts.map((t) => t.horas);
    return {
      usuario,
      triagens: ts.length,
      tempoMedioHoras: arredondar(media(valores)),
      medianaHoras: arredondar(mediana(valores)),
      desvioPadraoHoras: arredondar(desvioPadrao(valores)),
    };
  }).sort((a, b) => a.usuario.localeCompare(b.usuario));

  const porMes = Array.from(
    agrupar(concluidos, (l) => (l.concluidoEm as string).slice(0, 7)),
    ([mes, ls]) => ({
      mes,
      lotesConcluidos: ls.length,
      tempoMedioHoras: arredondar(media(ls.map((l) => l.duracaoHoras as number))),
    })
  ).sort((a, b) => a.mes.localeCompare(b.mes));

  let limiteAtipico: number | null = null;
  let atipicos: EficienciaResultado["gargalos"]["lotesAtipicos"] = [];
  if (concluidos.length >= AMOSTRA_MINIMA_COMPARACAO && mediaGeral !== null && desvioGeral !== null && desvioGeral > 0) {
    limiteAtipico = mediaGeral + FATOR_LIMITE_ATIPICO * desvioGeral;
    atipicos = concluidos
      .filter((l) => (l.duracaoHoras as number) > (limiteAtipico as number))
      .map((l) => ({ loteId: l.loteId, duracaoHoras: l.duracaoHoras as number, organizacaoId: l.organizacaoId }))
      .sort((a, b) => b.duracaoHoras - a.duracaoHoras);
  }

  const comparaveis = porOperador.filter((o) => o.triagens >= AMOSTRA_MINIMA_COMPARACAO && o.tempoMedioHoras !== null);
  const mediaOperadores = media(temposOperador.map((t) => t.horas));
  let operadorMaisLento: EficienciaResultado["gargalos"]["operadorMaisLento"] = null;
  if (comparaveis.length >= 2 && mediaOperadores !== null && mediaOperadores > 0) {
    const pior = comparaveis.reduce((a, b) => ((b.tempoMedioHoras as number) > (a.tempoMedioHoras as number) ? b : a));
    operadorMaisLento = {
      usuario: pior.usuario,
      tempoMedioHoras: pior.tempoMedioHoras as number,
      razaoSobreMediaGeral: arredondar((pior.tempoMedioHoras as number) / mediaOperadores) as number,
    };
  }

  let mesMaisLento: EficienciaResultado["gargalos"]["mesMaisLento"] = null;
  const mesesComparaveis = porMes.filter((m) => m.tempoMedioHoras !== null);
  if (mesesComparaveis.length >= 2) {
    const pior = mesesComparaveis.reduce((a, b) => ((b.tempoMedioHoras as number) > (a.tempoMedioHoras as number) ? b : a));
    mesMaisLento = { mes: pior.mes, tempoMedioHoras: pior.tempoMedioHoras as number };
  }

  return {
    geradoEm: agora.toISOString(),
    definicoes: {
      duracaoLote: "horas entre a data de entrada do lote e a triagem do ultimo equipamento (somente lotes totalmente triados)",
      tempoOperador: "horas entre o cadastro do equipamento e a sua triagem, por operador",
    },
    resumo: {
      lotesAnalisados: linhas.length,
      lotesConcluidos: concluidos.length,
      lotesEmAndamento: linhas.length - concluidos.length,
      equipamentosTriados: temposOperador.length,
      tempoMedioHoras: arredondar(mediaGeral),
      medianaHoras: arredondar(mediana(duracoes)),
      desvioPadraoHoras: arredondar(desvioGeral),
      p90Horas: arredondar(percentil(duracoes, 90)),
      minimoHoras: arredondar(minimo(duracoes)),
      maximoHoras: arredondar(maximo(duracoes)),
    },
    porOperador,
    porMes,
    gargalos: {
      limiteAtipicoHoras: arredondar(limiteAtipico),
      lotesAtipicos: atipicos,
      operadorMaisLento,
      mesMaisLento,
    },
    lotes: linhas,
  };
}
