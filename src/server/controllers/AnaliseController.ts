import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { ErroNaoEncontrado } from "../erros";
import { atorDe } from "../plugins/autenticacao";
import {
  consultaAnaliseAoVivo, consultaHistoricoAnalises, consultaTarefas, corpoGerarAnalise, corpoSolicitarRelatorio,
  paramsIdUuid, paramsSlugRelatorio,
} from "../schemasAv3";
import { FormatoSaida, StatusTarefa, TipoRelatorio, tipoRelatorioPorSlug } from "../tiposAv3";
import { ConsultaPaginada, OpcoesController, paginacaoDe } from "./comum";

function tipoDe(slug: string): TipoRelatorio {
  const tipo = tipoRelatorioPorSlug(slug);
  if (!tipo) throw new ErroNaoEncontrado("Tipo de relatorio desconhecido.");
  return tipo;
}

/** API INTERNA de analises e fila (JWT; ADMINISTRADOR e AUDITOR). Montada em /api/v1/internal. */
export const analiseController: FastifyPluginAsync<OpcoesController> = async (app, { servicos }) => {
  app.get<{ Params: { tipo: string }; Querystring: { organizacaoId?: string } }>(
    "/analises/:tipo",
    { schema: { params: paramsSlugRelatorio, querystring: consultaAnaliseAoVivo } },
    async (request) => servicos.analises.calcularAoVivo(atorDe(request), tipoDe(request.params.tipo), { organizacaoId: request.query.organizacaoId })
  );

  app.post<{ Params: { tipo: string }; Body: { organizacaoId?: string } }>(
    "/analises/:tipo/gerar",
    { schema: { params: paramsSlugRelatorio, body: corpoGerarAnalise } },
    async (request, reply) => {
      const relatorio = await servicos.analises.gerarManual(atorDe(request), tipoDe(request.params.tipo), request.body?.organizacaoId ?? null);
      reply.code(201);
      return relatorio;
    }
  );

  app.get<{ Querystring: ConsultaPaginada & { tipo?: TipoRelatorio; organizacaoId?: string; global?: boolean } }>(
    "/analises/historico",
    { schema: { querystring: consultaHistoricoAnalises } },
    async (request) => {
      const { tipo, organizacaoId, global } = request.query;
      return servicos.analises.historico(
        atorDe(request),
        { tipo, organizacaoId: global ? null : organizacaoId },
        paginacaoDe(request.query)
      );
    }
  );

  app.get("/analises/previsoes/acuracia", async (request) => servicos.analises.acuracia(atorDe(request)));

  app.get<{ Params: { id: string } }>("/analises/relatorios/:id", { schema: { params: paramsIdUuid } }, async (request) =>
    servicos.analises.detalhar(atorDe(request), request.params.id)
  );

  app.post<{ Body: { tipo: TipoRelatorio; formato?: FormatoSaida; organizacaoId?: string } }>(
    "/analises/executar",
    { schema: { body: corpoSolicitarRelatorio } },
    async (request, reply) => {
      const tarefa = await servicos.relatoriosAssincronos.solicitar({ tipo: "USUARIO", ator: atorDe(request) }, request.body);
      reply.code(202).header("Location", `/api/v1/internal/tarefas/${tarefa.id}`);
      return tarefa;
    }
  );

  app.get<{ Querystring: ConsultaPaginada & { status?: StatusTarefa } }>(
    "/tarefas",
    { schema: { querystring: consultaTarefas } },
    async (request) => servicos.relatoriosAssincronos.listar(atorDe(request), { status: request.query.status }, paginacaoDe(request.query))
  );

  app.get<{ Params: { id: string } }>("/tarefas/:id", { schema: { params: paramsIdUuid } }, async (request) =>
    servicos.relatoriosAssincronos.consultar({ tipo: "USUARIO", ator: atorDe(request) }, request.params.id)
  );

  app.get<{ Params: { id: string } }>("/tarefas/:id/download", { schema: { params: paramsIdUuid } }, async (request, reply: FastifyReply) => {
    const arquivo = await servicos.relatoriosAssincronos.baixar({ tipo: "USUARIO", ator: atorDe(request) }, request.params.id);
    return reply
      .header("Content-Type", arquivo.mime)
      .header("Content-Disposition", `attachment; filename="${arquivo.nomeArquivo}"`)
      .send(arquivo.conteudo);
  });
};
