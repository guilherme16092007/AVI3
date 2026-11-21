import { Dependencias } from "../repositorios/portas";
import { AnaliseServico } from "./AnaliseServico";
import { AutenticacaoServico } from "./AutenticacaoServico";
import { ChaveApiServico } from "./ChaveApiServico";
import { EquipamentoServico } from "./EquipamentoServico";
import { LoteServico } from "./LoteServico";
import { OrganizacaoServico } from "./OrganizacaoServico";
import { ParametroServico } from "./ParametroServico";
import { ParceiroServico } from "./ParceiroServico";
import { RelatorioAssincronoServico } from "./RelatorioAssincronoServico";
import { RelatorioServico } from "./RelatorioServico";
import { UsuarioServico } from "./UsuarioServico";

export interface Servicos {
  autenticacao: AutenticacaoServico;
  usuarios: UsuarioServico;
  parametros: ParametroServico;
  organizacoes: OrganizacaoServico;
  lotes: LoteServico;
  equipamentos: EquipamentoServico;
  relatorios: RelatorioServico;
  // AV3
  chavesApi: ChaveApiServico;
  analises: AnaliseServico;
  relatoriosAssincronos: RelatorioAssincronoServico;
  parceiros: ParceiroServico;
}

export interface ConfiguracaoServicos {
  /** Limite de requisicoes por minuto atribuido a novas chaves de API quando nao informado. */
  limitePadraoChavePorMinuto?: number;
  /** Tentativas maximas de uma tarefa da fila (1 execucao + retries). */
  maxTentativasTarefa?: number;
  /** Relatorios assincronos simultaneos (pendentes + em execucao) permitidos por chave de API. */
  limiteTarefasAtivasPorChave?: number;
  relogio?: () => Date;
}

export function criarServicos(dep: Dependencias, config: ConfiguracaoServicos = {}): Servicos {
  const relogio = config.relogio ?? ((): Date => new Date());
  const lotes = new LoteServico(dep);
  const equipamentos = new EquipamentoServico(dep);
  const analises = new AnaliseServico(dep, relogio);
  const relatoriosAssincronos = new RelatorioAssincronoServico(
    dep,
    analises,
    { maxTentativas: config.maxTentativasTarefa ?? 3, limiteTarefasAtivasPorChave: config.limiteTarefasAtivasPorChave ?? 5 },
    relogio
  );

  return {
    autenticacao: new AutenticacaoServico(dep),
    usuarios: new UsuarioServico(dep),
    parametros: new ParametroServico(dep),
    organizacoes: new OrganizacaoServico(dep),
    lotes,
    equipamentos,
    relatorios: new RelatorioServico(dep),
    chavesApi: new ChaveApiServico(dep, config.limitePadraoChavePorMinuto ?? 60, relogio),
    analises,
    relatoriosAssincronos,
    parceiros: new ParceiroServico(dep, lotes, equipamentos, analises, relatoriosAssincronos),
  };
}
