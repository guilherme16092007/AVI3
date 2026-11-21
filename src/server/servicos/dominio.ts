import { EquipamentoFactory } from "../../factories/EquipamentoFactory";
import { EquipamentoRegistro } from "../repositorios/portas";

export type EquipamentoParaDominio = Pick<
  EquipamentoRegistro,
  "id" | "loteId" | "tipo" | "numeroSerie" | "fabricante" | "modelo" | "codigoBarrasInterno" | "estadoFisico" | "status" | "criadoEm"
>;

/**
 * Reconstroi o objeto de dominio (AV1) a partir de um registro persistido, para reutilizar
 * as regras de valorizacao (valor residual, depreciacao, potencial de recuperacao) sem duplica-las.
 * Compartilhado por RelatorioServico (AV2) e pela camada analitica (AV3).
 */
export function reconstruirDominio(registro: EquipamentoParaDominio) {
  const dominio = EquipamentoFactory.criar(registro.tipo, {
    id: registro.id,
    loteId: registro.loteId,
    numeroSerie: registro.numeroSerie,
    fabricante: registro.fabricante ?? undefined,
    modelo: registro.modelo ?? undefined,
    codigoBarrasInterno: registro.codigoBarrasInterno,
  });
  dominio.estadoFisico = registro.estadoFisico;
  dominio.status = registro.status;
  Object.assign(dominio, { criadoEm: registro.criadoEm.toISOString() });
  return dominio;
}
