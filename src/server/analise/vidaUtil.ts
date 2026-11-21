import { EstadoFisico, StatusEquipamento, TipoEquipamento, TipoMovimentacao } from "../../types";
import { EquipamentoAnalitico } from "../repositorios/portas";
import { arredondar, maximo, mediana, minimo, MS_POR_DIA, percentil, Ponto, regressaoLinear } from "./estatistica";

/** Minimo de observacoes (pontos) e de equipamentos distintos para confiar na regressao do tipo. */
export const MINIMO_AMOSTRAS_REGRESSAO = 6;
export const MINIMO_EQUIPAMENTOS_REGRESSAO = 3;
/** Inclinacoes acima disto (estado por dia) nao representam degradacao observavel. */
const EPSILON_INCLINACAO = 1e-6;
/** Projecoes alem de 100 anos nao sao informativas: viram "sem previsao". */
export const HORIZONTE_MAXIMO_DIAS = 36_500;

export type ModeloVidaUtil = "OLS" | "DEPRECIACAO_PARAMETRO";

export interface PrevisaoTipo {
  tipo: TipoEquipamento;
  modelo: ModeloVidaUtil;
  motivoModelo: string;
  amostras: number;
  equipamentosComAmostra: number;
  inclinacaoPorDia: number;
  interceptoEstado: number;
  r2: number | null;
  equipamentosAtivos: number;
  vidaUtilRestanteDias: { mediana: number; p25: number; p75: number; minimo: number; maximo: number } | null;
}

export interface PrevisaoItem {
  equipamentoId: string;
  tipo: TipoEquipamento;
  estadoAtual: string;
  estadoAtualNumerico: number;
  modelo: ModeloVidaUtil;
  diasRestantes: number | null;
  dataProjetadaInservivel: string | null;
}

export interface VidaUtilResultado {
  geradoEm: string;
  metodo: string;
  parametros: { coeficienteDepreciacaoAnual: number; minimoAmostras: number; minimoEquipamentos: number; limiarEstado: number };
  limitacoes: string[];
  resumo: { equipamentosAnalisados: number; ativos: number; inserviveis: number; comPrevisao: number };
  porTipo: PrevisaoTipo[];
  equipamentos: PrevisaoItem[];
}

const FORA_DO_CICLO: StatusEquipamento[] = [StatusEquipamento.RECICLADO, StatusEquipamento.DESCARTADO];

/** Observacoes (idade em dias desde o cadastro, estado fisico) de um equipamento a partir do seu historico. */
function observacoes(eq: EquipamentoAnalitico): Ponto[] {
  const pontos: Ponto[] = [];
  for (const m of eq.movimentacoes) {
    if (m.estadoFisicoNovo === null) continue;
    if (m.tipo !== TipoMovimentacao.CADASTRO && m.tipo !== TipoMovimentacao.TRIAGEM && m.tipo !== TipoMovimentacao.MUDANCA_ESTADO) continue;
    pontos.push({ x: Math.max(0, (m.criadoEm.getTime() - eq.criadoEm.getTime()) / MS_POR_DIA), y: m.estadoFisicoNovo });
  }
  return pontos;
}

/**
 * Analise preditiva de vida util remanescente (regressao linear simples por tipo de equipamento).
 *
 * Modelo: estado_fisico = intercepto + inclinacao x idade_em_dias, ajustado por minimos quadrados ordinarios
 * sobre todas as observacoes historicas (cadastro, triagem, mudancas de estado) dos equipamentos do mesmo tipo.
 * Projecao por equipamento: dias ate o estado fisico atingir INSERVIVEL (0) = estado_atual / |inclinacao|.
 *
 * Fallback: com poucas amostras, ou quando os dados nao mostram degradacao (inclinacao >= 0), usa-se a
 * depreciacao linear do parametro `coeficienteDepreciacaoAnual` (do estado NOVO=4 ate 0), marcada como
 * modelo "DEPRECIACAO_PARAMETRO" para que o consumidor saiba que nao veio dos dados observados.
 */
export function calcularVidaUtil(
  equipamentos: EquipamentoAnalitico[],
  opcoes: { coeficienteDepreciacaoAnual: number; agora: Date }
): VidaUtilResultado {
  const { agora, coeficienteDepreciacaoAnual } = opcoes;
  const inclinacaoFallback = -((EstadoFisico.NOVO * coeficienteDepreciacaoAnual) / 100) / 365.25;

  const porTipoEq = new Map<TipoEquipamento, EquipamentoAnalitico[]>();
  for (const e of equipamentos) {
    const lista = porTipoEq.get(e.tipo);
    if (lista) lista.push(e);
    else porTipoEq.set(e.tipo, [e]);
  }

  const tipos: PrevisaoTipo[] = [];
  const itens: PrevisaoItem[] = [];
  let ativosTotal = 0;

  for (const [tipo, lista] of Array.from(porTipoEq).sort(([a], [b]) => a.localeCompare(b))) {
    const pontos: Ponto[] = [];
    let equipamentosComAmostra = 0;
    for (const e of lista) {
      const obs = observacoes(e);
      if (obs.length > 0) equipamentosComAmostra += 1;
      pontos.push(...obs);
    }

    const reg = regressaoLinear(pontos);
    let modelo: ModeloVidaUtil;
    let motivo: string;
    let inclinacao: number;
    let intercepto: number;
    let r2: number | null = null;

    if (reg === null || pontos.length < MINIMO_AMOSTRAS_REGRESSAO || equipamentosComAmostra < MINIMO_EQUIPAMENTOS_REGRESSAO) {
      modelo = "DEPRECIACAO_PARAMETRO";
      motivo = `amostras insuficientes (${pontos.length} observacoes de ${equipamentosComAmostra} equipamentos; minimo ${MINIMO_AMOSTRAS_REGRESSAO} e ${MINIMO_EQUIPAMENTOS_REGRESSAO})`;
      inclinacao = inclinacaoFallback;
      intercepto = EstadoFisico.NOVO;
    } else if (reg.inclinacao > -EPSILON_INCLINACAO) {
      modelo = "DEPRECIACAO_PARAMETRO";
      motivo = "os dados historicos nao mostram degradacao do estado fisico (inclinacao >= 0)";
      inclinacao = inclinacaoFallback;
      intercepto = EstadoFisico.NOVO;
      r2 = reg.r2;
    } else {
      modelo = "OLS";
      motivo = "regressao linear (minimos quadrados) sobre o historico observado";
      inclinacao = reg.inclinacao;
      intercepto = reg.intercepto;
      r2 = reg.r2;
    }

    const diasRestantesTipo: number[] = [];
    let ativos = 0;
    for (const e of lista) {
      let dias: number | null = null;
      if (e.estadoFisico <= EstadoFisico.INSERVIVEL) dias = 0;
      else if (inclinacao < -EPSILON_INCLINACAO) dias = e.estadoFisico / -inclinacao;
      if (dias !== null && dias > HORIZONTE_MAXIMO_DIAS) dias = null;

      const ativo = !FORA_DO_CICLO.includes(e.status);
      if (ativo) {
        ativos += 1;
        ativosTotal += 1;
        if (dias !== null) diasRestantesTipo.push(dias);
      }
      itens.push({
        equipamentoId: e.id,
        tipo,
        estadoAtual: EstadoFisico[e.estadoFisico],
        estadoAtualNumerico: e.estadoFisico,
        modelo,
        diasRestantes: arredondar(dias, 1),
        dataProjetadaInservivel: dias === null || !ativo ? null : new Date(agora.getTime() + dias * MS_POR_DIA).toISOString().slice(0, 10),
      });
    }

    tipos.push({
      tipo,
      modelo,
      motivoModelo: motivo,
      amostras: pontos.length,
      equipamentosComAmostra,
      inclinacaoPorDia: Number(inclinacao.toFixed(8)),
      interceptoEstado: Number(intercepto.toFixed(4)),
      r2: arredondar(r2, 4),
      equipamentosAtivos: ativos,
      vidaUtilRestanteDias:
        diasRestantesTipo.length === 0
          ? null
          : {
              mediana: arredondar(mediana(diasRestantesTipo), 1) as number,
              p25: arredondar(percentil(diasRestantesTipo, 25), 1) as number,
              p75: arredondar(percentil(diasRestantesTipo, 75), 1) as number,
              minimo: arredondar(minimo(diasRestantesTipo), 1) as number,
              maximo: arredondar(maximo(diasRestantesTipo), 1) as number,
            },
    });
  }

  return {
    geradoEm: agora.toISOString(),
    metodo: "Regressao linear simples (minimos quadrados ordinarios) por tipo: estado fisico x idade em dias desde o cadastro",
    parametros: {
      coeficienteDepreciacaoAnual,
      minimoAmostras: MINIMO_AMOSTRAS_REGRESSAO,
      minimoEquipamentos: MINIMO_EQUIPAMENTOS_REGRESSAO,
      limiarEstado: EstadoFisico.INSERVIVEL,
    },
    limitacoes: [
      "A idade considerada e o tempo desde o cadastro no greencode (o sistema nao registra a data de fabricacao).",
      "Com poucas observacoes o modelo usa a depreciacao parametrizada (campo 'modelo' = DEPRECIACAO_PARAMETRO).",
    ],
    resumo: {
      equipamentosAnalisados: itens.length,
      ativos: ativosTotal,
      inserviveis: equipamentos.filter((e) => e.estadoFisico === EstadoFisico.INSERVIVEL).length,
      comPrevisao: itens.filter((i) => i.diasRestantes !== null).length,
    },
    porTipo: tipos,
    equipamentos: itens,
  };
}
