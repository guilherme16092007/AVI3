import { Dependencias } from "../repositorios/portas";
import { reconstruirDominio } from "./dominio";
import { Ator, exigirPapel, PERMISSOES } from "./politicas";
import { arredondar, exigirEncontrado, nomeEstadoFisico } from "./util";

export class RelatorioServico {
  constructor(private readonly dep: Dependencias) {}

  async valorResidual(ator: Ator, filtro: { loteId?: string }) {
    exigirPapel(ator, PERMISSOES.relatorioValor);
    if (filtro.loteId) {
      exigirEncontrado(await this.dep.repos.lotes.buscarPorId(filtro.loteId), "Lote nao encontrado.");
    }

    const parametros = await this.dep.repos.parametros.obter();
    const equipamentos = await this.dep.repos.equipamentos.listarTodos({ loteId: filtro.loteId });
    const aliquota = parametros.aliquotaImpostoPercentual;

    const linhas = equipamentos.map((registro) => {
      const valorResidual = arredondar(
        reconstruirDominio(registro).calcularValorResidual(parametros.coeficienteDepreciacaoAnual)
      );
      const impostoEstimado = arredondar((valorResidual * aliquota) / 100);
      return {
        equipamentoId: registro.id,
        tipo: registro.tipo,
        estadoFisico: nomeEstadoFisico(registro.estadoFisico),
        status: registro.status,
        potencialRecuperacao: reconstruirDominio(registro).potencialRecuperacao(),
        valorResidual,
        impostoEstimado,
        valorLiquido: arredondar(valorResidual - impostoEstimado),
      };
    });

    const soma = (campo: "valorResidual" | "impostoEstimado" | "valorLiquido"): number =>
      arredondar(linhas.reduce((total, l) => total + l[campo], 0));

    return {
      geradoEm: new Date().toISOString(),
      parametros: {
        aliquotaImpostoPercentual: aliquota,
        coeficienteDepreciacaoAnual: parametros.coeficienteDepreciacaoAnual,
      },
      linhas,
      totais: {
        quantidade: linhas.length,
        valorResidual: soma("valorResidual"),
        impostoEstimado: soma("impostoEstimado"),
        valorLiquido: soma("valorLiquido"),
      },
    };
  }
}
