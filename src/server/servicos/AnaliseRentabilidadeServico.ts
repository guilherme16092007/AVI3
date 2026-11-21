import { calcularRentabilidade, RentabilidadeResultado } from "../analise/rentabilidade";
import { Dependencias } from "../repositorios/portas";

/** Servico independente: rentabilidade esperada de recuperacao por tipo, estado fisico, marca e modelo. */
export class AnaliseRentabilidadeServico {
  constructor(private readonly dep: Dependencias, private readonly relogio: () => Date = () => new Date()) {}

  async calcular(filtro: { organizacaoId?: string }): Promise<RentabilidadeResultado> {
    const parametros = await this.dep.repos.parametros.obter();
    const equipamentos = await this.dep.repos.analise.listarEquipamentos(filtro);
    return calcularRentabilidade(
      equipamentos,
      {
        aliquotaImpostoPercentual: parametros.aliquotaImpostoPercentual,
        coeficienteDepreciacaoAnual: parametros.coeficienteDepreciacaoAnual,
      },
      this.relogio()
    );
  }
}
