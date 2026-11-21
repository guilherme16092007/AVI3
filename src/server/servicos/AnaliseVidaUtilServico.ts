import { calcularVidaUtil, VidaUtilResultado } from "../analise/vidaUtil";
import { Dependencias } from "../repositorios/portas";

/** Servico independente: previsao de vida util remanescente (regressao linear por tipo de equipamento). */
export class AnaliseVidaUtilServico {
  constructor(private readonly dep: Dependencias, private readonly relogio: () => Date = () => new Date()) {}

  async calcular(filtro: { organizacaoId?: string }): Promise<VidaUtilResultado> {
    const parametros = await this.dep.repos.parametros.obter();
    const equipamentos = await this.dep.repos.analise.listarEquipamentos(filtro);
    return calcularVidaUtil(equipamentos, {
      coeficienteDepreciacaoAnual: parametros.coeficienteDepreciacaoAnual,
      agora: this.relogio(),
    });
  }
}
