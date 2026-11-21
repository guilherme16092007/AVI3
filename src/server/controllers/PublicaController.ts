import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { chaveDe } from "../plugins/chaveApi";
import { Servicos } from "../servicos";
import { TarefaDto } from "../servicos/dtoAv3";
import { CriarLotePublicoEntrada } from "../servicos/ParceiroServico";
import {
  consultaAnalisePublica, consultaLotesPublica, corpoCriarLotePublico, corpoSolicitarRelatorio, paramsIdUuid,
  paramsSlugRelatorio, respostaLivre, respostaTarefa, SEGURANCA_API,
} from "../schemasAv3";
import { FormatoSaida, tipoRelatorioPorSlug, TipoRelatorio } from "../tiposAv3";
import { ErroNaoEncontrado } from "../erros";
import { ConsultaPaginada, paginacaoDe } from "./comum";

export interface OpcoesPublica {
  servicos: Servicos;
  /** Prefixo onde o plugin foi montado (ex.: /api/v1/public), usado para montar os links das respostas. */
  prefixo: string;
}

/** API PUBLICA v1: autenticada por chave (X-API-Key), com permissoes, escopo por organizacao e limite de taxa. */
export const publicaController: FastifyPluginAsync<OpcoesPublica> = async (app, { servicos, prefixo }) => {
  const comLinks = (t: TarefaDto) => ({
    ...t,
    links: {
      status: `${prefixo}/relatorios/${t.id}`,
      download: t.downloadDisponivel ? `${prefixo}/relatorios/${t.id}/download` : null,
    },
  });

  app.get(
    "/me",
    {
      schema: {
        tags: ["Conta"], summary: "Identidade, permissoes, escopo e limite da chave",
        description: "Util para o parceiro validar a integracao e conhecer seu limite de requisicoes por minuto.",
        security: SEGURANCA_API, response: { 200: respostaLivre("Dados da chave (sem o segredo).") },
      },
    },
    async (request) => servicos.parceiros.quemSou(chaveDe(request))
  );

  app.get<{ Params: { id: string } }>(
    "/rastreabilidade/equipamentos/:id",
    {
      schema: {
        tags: ["Rastreabilidade"], summary: "Rastreabilidade de um equipamento",
        description: "Exige RASTREABILIDADE_LER. Devolve o equipamento e o historico cronologico de movimentacoes (sem dados internos de operador).",
        security: SEGURANCA_API, params: paramsIdUuid, response: { 200: respostaLivre("Equipamento e historico.") },
      },
    },
    async (request) => servicos.parceiros.rastrear(chaveDe(request), request.params.id)
  );

  app.get<{ Querystring: ConsultaPaginada & { organizacaoId?: string } }>(
    "/lotes",
    {
      schema: {
        tags: ["Lotes"], summary: "Lista lotes", description: "Exige LOTES_LER. Paginado.",
        security: SEGURANCA_API, querystring: consultaLotesPublica, response: { 200: respostaLivre("Pagina de lotes (itens, total, limite, offset).") },
      },
    },
    async (request) => servicos.parceiros.listarLotes(chaveDe(request), paginacaoDe(request.query), request.query.organizacaoId)
  );

  app.get<{ Params: { id: string } }>(
    "/lotes/:id",
    {
      schema: {
        tags: ["Lotes"], summary: "Detalha um lote com seus equipamentos", description: "Exige LOTES_LER.",
        security: SEGURANCA_API, params: paramsIdUuid, response: { 200: respostaLivre("Lote e equipamentos.") },
      },
    },
    async (request) => servicos.parceiros.detalharLote(chaveDe(request), request.params.id)
  );

  app.post<{ Body: CriarLotePublicoEntrada }>(
    "/lotes",
    {
      schema: {
        tags: ["Lotes"], summary: "Submete um novo lote",
        description: "Exige LOTES_ESCREVER. O registro e atribuido ao usuario de servico da chave (auditoria). Aplica as mesmas regras de negocio do sistema interno.",
        security: SEGURANCA_API, body: corpoCriarLotePublico, response: { 201: respostaLivre("Lote criado.") },
      },
    },
    async (request, reply) => {
      const lote = await servicos.parceiros.criarLote(chaveDe(request), request.body);
      reply.code(201);
      return lote;
    }
  );

  app.get<{ Params: { tipo: string }; Querystring: { organizacaoId?: string } }>(
    "/analises/:tipo/ultimo",
    {
      schema: {
        tags: ["Analises"], summary: "Ultimo relatorio analitico persistido",
        description: "Exige ANALISES_LER. Leitura rapida do ultimo relatorio ja gerado (agendado ou solicitado). Para gerar um novo use POST /relatorios.",
        security: SEGURANCA_API, params: paramsSlugRelatorio, querystring: consultaAnalisePublica,
        response: { 200: respostaLivre("Relatorio com 'resultado' especifico do tipo.") },
      },
    },
    async (request) => {
      const tipo = tipoRelatorioPorSlug(request.params.tipo);
      if (!tipo) throw new ErroNaoEncontrado("Tipo de relatorio desconhecido.");
      return servicos.parceiros.ultimaAnalise(chaveDe(request), tipo, request.query.organizacaoId);
    }
  );

  app.post<{ Body: { tipo: TipoRelatorio; formato?: FormatoSaida; organizacaoId?: string } }>(
    "/relatorios",
    {
      schema: {
        tags: ["Relatorios assincronos"], summary: "Solicita a geracao de um relatorio (assincrona)",
        description:
          "Exige RELATORIOS_GERAR. Responde 202 imediatamente com o identificador da tarefa e o cabecalho Location. Consulte o status em GET /relatorios/{id} e baixe o arquivo em /download quando CONCLUIDA.",
        security: SEGURANCA_API, body: corpoSolicitarRelatorio, response: { 202: respostaTarefa },
      },
    },
    async (request, reply) => {
      const tarefa = comLinks(await servicos.parceiros.solicitarRelatorio(chaveDe(request), request.body));
      reply.code(202).header("Location", tarefa.links.status);
      return tarefa;
    }
  );

  app.get<{ Params: { id: string } }>(
    "/relatorios/:id",
    {
      schema: {
        tags: ["Relatorios assincronos"], summary: "Status da geracao do relatorio (polling)",
        description: "Exige RELATORIOS_GERAR. So enxerga tarefas criadas pela propria chave.",
        security: SEGURANCA_API, params: paramsIdUuid, response: { 200: respostaTarefa },
      },
    },
    async (request) => comLinks(await servicos.parceiros.consultarRelatorio(chaveDe(request), request.params.id))
  );

  app.get<{ Params: { id: string } }>(
    "/relatorios/:id/download",
    {
      schema: {
        tags: ["Relatorios assincronos"], summary: "Baixa o arquivo do relatorio concluido",
        description: "Exige RELATORIOS_GERAR. Responde 409 enquanto a tarefa nao estiver CONCLUIDA.",
        security: SEGURANCA_API, params: paramsIdUuid,
        respostasDoc: {
          "200": {
            description: "Arquivo do relatorio (JSON ou CSV, conforme solicitado).",
            content: { "application/json": { schema: { type: "object" } }, "text/csv": { schema: { type: "string" } } },
          },
        },
      },
    },
    async (request, reply: FastifyReply) => {
      const arquivo = await servicos.parceiros.baixarRelatorio(chaveDe(request), request.params.id);
      return reply
        .header("Content-Type", arquivo.mime)
        .header("Content-Disposition", `attachment; filename="${arquivo.nomeArquivo}"`)
        .header("Cache-Control", "private, no-store")
        .send(arquivo.conteudo);
    }
  );
};
