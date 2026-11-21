import { EstadoFisico } from "../../types";
import { EquipamentoAnalitico } from "../repositorios/portas";
import { reconstruirDominio } from "../servicos/dominio";
import { arredondar, mediana, media, soma } from "./estatistica";

export interface ParametrosRentabilidade {
  aliquotaImpostoPercentual: number;
  coeficienteDepreciacaoAnual: number;
}

interface Linha {
  equipamentoId: string;
  tipo: string;
  fabricante: string;
  modelo: string;
  estadoFisico: string;
  status: string;
  potencialRecuperacao: string;
  valorResidual: number;
  impostoEstimado: number;
  valorLiquido: number;
}

export interface GrupoRentabilidade {
  quantidade: number;
  valorMedio: number | null;
  valorMediano: number | null;
  valorTotal: number;
  valorLiquidoMedio: number | null;
}

export interface RentabilidadeResultado {
  geradoEm: string;
  parametros: ParametrosRentabilidade;
  observacoes: string[];
  totais: { quantidade: number; valorTotal: number; impostoEstimado: number; valorLiquido: number; valorMedio: number | null };
  porTipo: Array<GrupoRentabilidade & { tipo: string; potencialRecuperacao: Record<string, number> }>;
  porTipoEEstado: Array<GrupoRentabilidade & { tipo: string; estadoFisico: string }>;
  porFabricante: Array<GrupoRentabilidade & { fabricante: string }>;
  porModelo: Array<GrupoRentabilidade & { fabricante: string; modelo: string }>;
  ranking: Array<{ posicao: number; tipo: string; estadoFisico: string; valorMedio: number; quantidade: number }>;
  equipamentos: Linha[];
}

const NAO_INFORMADO = "(nao informado)";

function resumir(linhas: Linha[]): GrupoRentabilidade {
  const valores = linhas.map((l) => l.valorResidual);
  return {
    quantidade: linhas.length,
    valorMedio: arredondar(media(valores)),
    valorMediano: arredondar(mediana(valores)),
    valorTotal: arredondar(soma(valores)) as number,
    valorLiquidoMedio: arredondar(media(linhas.map((l) => l.valorLiquido))),
  };
}

function agrupar(linhas: Linha[], chave: (l: Linha) => string): Array<[string, Linha[]]> {
  const mapa = new Map<string, Linha[]>();
  for (const l of linhas) {
    const k = chave(l);
    const lista = mapa.get(k);
    if (lista) lista.push(l);
    else mapa.set(k, [l]);
  }
  return Array.from(mapa);
}

const porValorMedioDesc = (a: { valorMedio: number | null }, b: { valorMedio: number | null }): number =>
  (b.valorMedio ?? 0) - (a.valorMedio ?? 0);

/**
 * Rentabilidade esperada de recuperacao por tipo de equipamento, estado fisico, marca e modelo.
 * Reutiliza a regra de valorizacao do dominio (AV1): valor base do tipo x fator do estado x depreciacao temporal.
 * Observacao: o dominio atual nao diferencia preco por marca/modelo; essas dimensoes sao AGRUPAMENTOS
 * para o cliente comparar a composicao do seu inventario (ver docs/RELATORIO_TECNICO_AV3.md).
 */
export function calcularRentabilidade(
  equipamentos: EquipamentoAnalitico[],
  parametros: ParametrosRentabilidade,
  agora: Date
): RentabilidadeResultado {
  const linhas: Linha[] = equipamentos.map((e) => {
    const dominio = reconstruirDominio(e);
    const valorResidual = arredondar(dominio.calcularValorResidual(parametros.coeficienteDepreciacaoAnual)) as number;
    const impostoEstimado = arredondar((valorResidual * parametros.aliquotaImpostoPercentual) / 100) as number;
    return {
      equipamentoId: e.id,
      tipo: e.tipo,
      fabricante: e.fabricante ?? NAO_INFORMADO,
      modelo: e.modelo ?? NAO_INFORMADO,
      estadoFisico: EstadoFisico[e.estadoFisico],
      status: e.status,
      potencialRecuperacao: dominio.potencialRecuperacao(),
      valorResidual,
      impostoEstimado,
      valorLiquido: arredondar(valorResidual - impostoEstimado) as number,
    };
  });

  const porTipo = agrupar(linhas, (l) => l.tipo)
    .map(([tipo, ls]) => {
      const potencial: Record<string, number> = {};
      for (const l of ls) potencial[l.potencialRecuperacao] = (potencial[l.potencialRecuperacao] ?? 0) + 1;
      return { tipo, ...resumir(ls), potencialRecuperacao: potencial };
    })
    .sort(porValorMedioDesc);

  const porTipoEEstado = agrupar(linhas, (l) => `${l.tipo}|${l.estadoFisico}`)
    .map(([chave, ls]) => {
      const [tipo, estadoFisico] = chave.split("|");
      return { tipo, estadoFisico, ...resumir(ls) };
    })
    .sort(porValorMedioDesc);

  const porFabricante = agrupar(linhas, (l) => l.fabricante)
    .map(([fabricante, ls]) => ({ fabricante, ...resumir(ls) }))
    .sort(porValorMedioDesc);

  const porModelo = agrupar(linhas, (l) => `${l.fabricante}|${l.modelo}`)
    .map(([chave, ls]) => {
      const [fabricante, modelo] = chave.split("|");
      return { fabricante, modelo, ...resumir(ls) };
    })
    .sort(porValorMedioDesc);

  const ranking = porTipoEEstado
    .filter((g) => g.valorMedio !== null)
    .slice(0, 10)
    .map((g, i) => ({
      posicao: i + 1,
      tipo: g.tipo,
      estadoFisico: g.estadoFisico,
      valorMedio: g.valorMedio as number,
      quantidade: g.quantidade,
    }));

  const valorTotal = arredondar(soma(linhas.map((l) => l.valorResidual))) as number;
  const impostoEstimado = arredondar(soma(linhas.map((l) => l.impostoEstimado))) as number;

  return {
    geradoEm: agora.toISOString(),
    parametros,
    observacoes: [
      "Valor = valor base do tipo x fator do estado fisico x depreciacao temporal (regra do dominio, igual ao relatorio de valor residual da AV2).",
      "Fabricante e modelo sao agrupamentos de composicao do inventario: o dominio atual nao aplica premio de preco por marca/modelo.",
    ],
    totais: {
      quantidade: linhas.length,
      valorTotal,
      impostoEstimado,
      valorLiquido: arredondar(valorTotal - impostoEstimado) as number,
      valorMedio: arredondar(media(linhas.map((l) => l.valorResidual))),
    },
    porTipo,
    porTipoEEstado,
    porFabricante,
    porModelo,
    ranking,
    equipamentos: linhas,
  };
}
