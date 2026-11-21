import { validarCron } from "../fila/cron";

export interface Ambiente {
  PORT: number;
  HOST: string;
  DATABASE_URL: string;
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  LOG_LEVEL: string;
  SHUTDOWN_TIMEOUT_MS: number;
  // AV3
  WORKER_HABILITADO: boolean;
  WORKER_CONCORRENCIA: number;
  WORKER_INTERVALO_MS: number;
  JOBS_MAX_TENTATIVAS: number;
  JOBS_BACKOFF_BASE_MS: number;
  JOBS_LEASE_MS: number;
  JOBS_LIMITE_ATIVAS_POR_CHAVE: number;
  /** Expressao cron das analises recorrentes; string vazia = agendamento desligado. */
  ANALISE_CRON: string;
  API_LIMITE_PADRAO_POR_MINUTO: number;
  API_LIMITE_IP_POR_MINUTO: number;
}

type Fonte = Record<string, string | undefined>;

const NIVEIS_LOG = ["fatal", "error", "warn", "info", "debug", "trace", "silent"];

function inteiro(fonte: Fonte, nome: string, padrao: number, min: number, max: number): number {
  const bruto = fonte[nome];
  if (bruto === undefined || bruto.trim() === "") return padrao;
  const valor = Number(bruto);
  if (!Number.isInteger(valor) || valor < min || valor > max) {
    throw new Error(`Variavel de ambiente ${nome} invalida: '${bruto}' (esperado inteiro entre ${min} e ${max}).`);
  }
  return valor;
}

function booleano(fonte: Fonte, nome: string, padrao: boolean): boolean {
  const bruto = fonte[nome]?.trim().toLowerCase();
  if (bruto === undefined || bruto === "") return padrao;
  if (["1", "true", "sim", "yes"].includes(bruto)) return true;
  if (["0", "false", "nao", "no"].includes(bruto)) return false;
  throw new Error(`Variavel de ambiente ${nome} invalida: '${fonte[nome]}' (use true ou false).`);
}

export function carregarAmbiente(fonte: Fonte = process.env): Ambiente {
  const DATABASE_URL = fonte.DATABASE_URL?.trim();
  if (!DATABASE_URL) {
    throw new Error("Variavel de ambiente DATABASE_URL nao definida (veja .env.example).");
  }

  const JWT_SECRET = fonte.JWT_SECRET ?? "";
  if (JWT_SECRET.length < 32) {
    throw new Error("Variavel de ambiente JWT_SECRET ausente ou curta demais (minimo 32 caracteres; veja .env.example).");
  }

  const LOG_LEVEL = (fonte.LOG_LEVEL ?? "info").trim() || "info";
  if (!NIVEIS_LOG.includes(LOG_LEVEL)) {
    throw new Error(`Variavel de ambiente LOG_LEVEL invalida: '${LOG_LEVEL}' (use: ${NIVEIS_LOG.join(", ")}).`);
  }

  const ANALISE_CRON = (fonte.ANALISE_CRON ?? "0 2 * * *").trim();
  if (ANALISE_CRON !== "") {
    try {
      validarCron(ANALISE_CRON);
    } catch (erro) {
      throw new Error(`Variavel de ambiente ANALISE_CRON invalida: ${erro instanceof Error ? erro.message : erro}`);
    }
  }

  return {
    PORT: inteiro(fonte, "PORT", 3000, 1, 65535),
    HOST: fonte.HOST?.trim() || "127.0.0.1",
    DATABASE_URL,
    JWT_SECRET,
    JWT_EXPIRES_IN: fonte.JWT_EXPIRES_IN?.trim() || "30m",
    LOG_LEVEL,
    SHUTDOWN_TIMEOUT_MS: inteiro(fonte, "SHUTDOWN_TIMEOUT_MS", 10_000, 1_000, 120_000),
    WORKER_HABILITADO: booleano(fonte, "WORKER_HABILITADO", true),
    WORKER_CONCORRENCIA: inteiro(fonte, "WORKER_CONCORRENCIA", 2, 1, 32),
    WORKER_INTERVALO_MS: inteiro(fonte, "WORKER_INTERVALO_MS", 2_000, 100, 60_000),
    JOBS_MAX_TENTATIVAS: inteiro(fonte, "JOBS_MAX_TENTATIVAS", 3, 1, 20),
    JOBS_BACKOFF_BASE_MS: inteiro(fonte, "JOBS_BACKOFF_BASE_MS", 5_000, 100, 3_600_000),
    JOBS_LEASE_MS: inteiro(fonte, "JOBS_LEASE_MS", 300_000, 10_000, 3_600_000),
    JOBS_LIMITE_ATIVAS_POR_CHAVE: inteiro(fonte, "JOBS_LIMITE_ATIVAS_POR_CHAVE", 5, 1, 1_000),
    ANALISE_CRON,
    API_LIMITE_PADRAO_POR_MINUTO: inteiro(fonte, "API_LIMITE_PADRAO_POR_MINUTO", 60, 1, 100_000),
    API_LIMITE_IP_POR_MINUTO: inteiro(fonte, "API_LIMITE_IP_POR_MINUTO", 30, 1, 100_000),
  };
}
