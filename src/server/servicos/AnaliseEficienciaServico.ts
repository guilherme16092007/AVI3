import { calcularEficiencia, EficienciaResultado } from "../analise/eficiencia";
import { Dependencias } from "../repositorios/portas";

/** Servico independente: eficiencia operacional (tempo de processamento de lotes, operadores, periodos, gargalos). */
export class AnaliseEficienciaServico {
  constructor(private readonly dep: Dependencias, private readonly relogio: () => Date = () => new Date()) {}

  async calcular(filtro: { organizacaoId?: string }): Promise<EficienciaResultado> {
    const equipamentos = await this.dep.repos.analise.listarEquipamentos(filtro);
    return calcularEficiencia(equipamentos, this.relogio());
  }
}
