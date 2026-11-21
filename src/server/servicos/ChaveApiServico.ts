import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { ErroValidacao } from "../../types";
import { ErroConflito, ErroNaoAutenticado, ErroPermissao } from "../erros";
import { Dependencias, Pagina, Paginacao } from "../repositorios/portas";
import { PermissaoApi } from "../tiposAv3";
import { ChaveApiDto, paraChaveApiDto } from "./dtoAv3";
import { Ator, exigirPapel, PERMISSOES } from "./politicas";
import { conferirVersao, exigirEncontrado, mapearPagina, novoId } from "./util";

/** Formato da chave: gck_<prefixo 12 hex>.<segredo 43 chars base64url> (256 bits de entropia no segredo). */
const FORMATO_CHAVE = /^gck_([0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;
const INTERVALO_REGISTRO_USO_MS = 60_000;
const MENSAGEM_INVALIDA = "Chave de API invalida, revogada ou expirada. Envie uma chave valida no cabecalho X-API-Key.";

export interface CriarChaveEntrada {
  nome: string;
  permissoes: PermissaoApi[];
  organizacaoId?: string;
  escopoGlobal?: boolean;
  usuarioServicoId?: string;
  limitePorMinuto?: number;
  expiraEm?: string;
}

/** Identidade e escopo de uma chave ja autenticada (nunca contem o segredo nem o hash). */
export interface ChaveApiAutenticada {
  id: string;
  nome: string;
  prefixo: string;
  permissoes: PermissaoApi[];
  organizacaoId: string | null;
  usuarioServicoId: string | null;
  limitePorMinuto: number;
}

export function hashDaChave(chave: string): string {
  return createHash("sha256").update(chave, "utf8").digest("hex");
}

export class ChaveApiServico {
  /** Hash usado para igualar o tempo de resposta quando o prefixo nao existe (evita enumeracao por timing). */
  private readonly hashFalso = hashDaChave("gck_000000000000.chave-inexistente-tempo-constante");

  constructor(
    private readonly dep: Dependencias,
    private readonly limitePadraoPorMinuto: number,
    private readonly relogio: () => Date = () => new Date()
  ) {}

  async criar(ator: Ator, entrada: CriarChaveEntrada): Promise<{ chave: ChaveApiDto; chaveSecreta: string }> {
    exigirPapel(ator, PERMISSOES.chaveApiGerenciar);
    const repos = this.dep.repos;

    const permissoes = Array.from(new Set(entrada.permissoes));
    if (permissoes.length === 0) throw new ErroValidacao("Informe ao menos uma permissao.", ["permissoes"]);

    if (entrada.organizacaoId && entrada.escopoGlobal) {
      throw new ErroValidacao("Use organizacaoId OU escopoGlobal=true, nunca os dois.", ["organizacaoId", "escopoGlobal"]);
    }
    if (!entrada.organizacaoId && !entrada.escopoGlobal) {
      throw new ErroValidacao(
        "Defina o escopo da chave: informe organizacaoId (acesso restrito a uma organizacao) ou escopoGlobal=true (acesso a todas).",
        ["organizacaoId", "escopoGlobal"]
      );
    }
    if (entrada.organizacaoId) {
      const org = await repos.organizacoes.buscarPorId(entrada.organizacaoId);
      if (!org || !org.ativo) throw new ErroValidacao("Organizacao inexistente ou inativa.", ["organizacaoId"]);
    }

    if (permissoes.includes(PermissaoApi.LOTES_ESCREVER)) {
      if (!entrada.usuarioServicoId) {
        throw new ErroValidacao(
          "A permissao LOTES_ESCREVER exige usuarioServicoId: o usuario (ADMINISTRADOR ou GESTOR_ALMOXARIFADO) a quem os registros serao atribuidos na auditoria.",
          ["usuarioServicoId"]
        );
      }
      const usuario = await repos.usuarios.buscarPorId(entrada.usuarioServicoId);
      if (!usuario || !usuario.ativo) throw new ErroValidacao("Usuario de servico inexistente ou inativo.", ["usuarioServicoId"]);
      if (!(PERMISSOES.loteCriar as readonly string[]).includes(usuario.papel)) {
        throw new ErroValidacao(
          `O usuario de servico precisa ter papel autorizado a criar lotes (${PERMISSOES.loteCriar.join(", ")}).`,
          ["usuarioServicoId"]
        );
      }
    }

    let expiraEm: Date | null = null;
    if (entrada.expiraEm) {
      expiraEm = new Date(entrada.expiraEm);
      if (Number.isNaN(expiraEm.getTime()) || expiraEm.getTime() <= this.relogio().getTime()) {
        throw new ErroValidacao("expiraEm deve ser uma data/hora futura valida.", ["expiraEm"]);
      }
    }

    const prefixo = randomBytes(6).toString("hex");
    const chaveSecreta = `gck_${prefixo}.${randomBytes(32).toString("base64url")}`;
    const registro = await repos.chavesApi.criar({
      id: novoId(),
      nome: entrada.nome.trim(),
      prefixo,
      hashChave: hashDaChave(chaveSecreta),
      permissoes,
      organizacaoId: entrada.organizacaoId ?? null,
      usuarioServicoId: entrada.usuarioServicoId ?? null,
      limitePorMinuto: entrada.limitePorMinuto ?? this.limitePadraoPorMinuto,
      expiraEm,
      criadoPorId: ator.id,
    });
    // O segredo em claro so existe nesta resposta: o banco guarda apenas o hash SHA-256.
    return { chave: paraChaveApiDto(registro), chaveSecreta };
  }

  async listar(ator: Ator, paginacao: Paginacao): Promise<Pagina<ChaveApiDto>> {
    exigirPapel(ator, PERMISSOES.chaveApiGerenciar);
    return mapearPagina(await this.dep.repos.chavesApi.listar(paginacao), paraChaveApiDto);
  }

  async detalhar(ator: Ator, id: string): Promise<ChaveApiDto> {
    exigirPapel(ator, PERMISSOES.chaveApiGerenciar);
    return paraChaveApiDto(exigirEncontrado(await this.dep.repos.chavesApi.buscarPorId(id), "Chave de API nao encontrada."));
  }

  async revogar(ator: Ator, id: string, versao?: number): Promise<ChaveApiDto> {
    exigirPapel(ator, PERMISSOES.chaveApiGerenciar);
    const atual = exigirEncontrado(await this.dep.repos.chavesApi.buscarPorId(id), "Chave de API nao encontrada.");
    if (atual.revogadaEm) throw new ErroConflito("Chave de API ja revogada.");
    conferirVersao(atual.versao, versao, "Chave de API");
    return paraChaveApiDto(await this.dep.repos.chavesApi.revogar(id, atual.versao, this.relogio()));
  }

  /** Valida a chave recebida no cabecalho X-API-Key. Falhas sempre devolvem a MESMA mensagem generica (401). */
  async autenticar(chaveBruta: string): Promise<ChaveApiAutenticada> {
    const partes = FORMATO_CHAVE.exec(chaveBruta);
    if (!partes) {
      this.compararHashes(hashDaChave(chaveBruta), this.hashFalso);
      throw new ErroNaoAutenticado(MENSAGEM_INVALIDA);
    }
    const registro = await this.dep.repos.chavesApi.buscarPorPrefixo(partes[1]);
    const confere = this.compararHashes(hashDaChave(chaveBruta), registro ? registro.hashChave : this.hashFalso);
    const agora = this.relogio();
    if (!registro || !confere || registro.revogadaEm || (registro.expiraEm && registro.expiraEm.getTime() <= agora.getTime())) {
      throw new ErroNaoAutenticado(MENSAGEM_INVALIDA);
    }

    if (!registro.ultimoUsoEm || agora.getTime() - registro.ultimoUsoEm.getTime() > INTERVALO_REGISTRO_USO_MS) {
      await this.dep.repos.chavesApi.registrarUso(registro.id, agora).catch(() => undefined);
    }
    return {
      id: registro.id,
      nome: registro.nome,
      prefixo: registro.prefixo,
      permissoes: registro.permissoes,
      organizacaoId: registro.organizacaoId,
      usuarioServicoId: registro.usuarioServicoId,
      limitePorMinuto: registro.limitePorMinuto,
    };
  }

  private compararHashes(a: string, b: string): boolean {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  }
}

export function exigirPermissaoApi(chave: ChaveApiAutenticada, permissao: PermissaoApi): void {
  if (!chave.permissoes.includes(permissao)) {
    throw new ErroPermissao(
      `Esta chave de API nao possui a permissao ${permissao}. Permissoes da chave: [${chave.permissoes.join(", ")}].`
    );
  }
}
