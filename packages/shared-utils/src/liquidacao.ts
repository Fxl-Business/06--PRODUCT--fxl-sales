/**
 * Regra unica de liquidacao do Sales: baixas e estornos de receivables e payables.
 *
 * Espelho do redutor do FXL Finance (`reduzirLiquidacao` em F:packages/shared-utils/src/liquidacao.ts,
 * plano F:nexo/plans/20260924T011357Z-feedback-socio-financeiro/01-liquidacao-redutor.md):
 * mesmas regras, mesmos nomes e mesmos codigos de erro. O oraculo de paridade em
 * __tests__/liquidacao.test.ts falha se as duas regras divergirem.
 *
 * Fatos imutaveis. O modulo nao le o relogio, nao usa ponto flutuante nem formatacao de locale
 * e nao importa nada: "hoje" chega como argumento (dia civil de Sao Paulo calculado pelo chamador).
 *
 * Etapa 1: so baixa integral e estorno integral (EstornoValorDivergente). Pagamento parcial,
 * juros, multa e desconto revisitam esta regra junto com o Finance.
 */

export interface BaixaEvento {
  readonly id: string;
  readonly tipo: 'baixa';
  readonly estornaBaixaId: null;
  /** YYYY-MM-DD, dia civil real do pagamento. */
  readonly data: string;
  /** Inteiro seguro > 0. */
  readonly valorCentavos: number;
}

export interface EstornoEvento {
  readonly id: string;
  readonly tipo: 'estorno';
  readonly estornaBaixaId: string;
  /** YYYY-MM-DD, dia civil do estorno. */
  readonly data: string;
  /** Inteiro seguro > 0, igual ao da baixa citada. */
  readonly valorCentavos: number;
}

export type LiquidacaoEvento = BaixaEvento | EstornoEvento;

export interface LiquidacaoEntrada {
  readonly valorOriginalCentavos: number;
  readonly eventos: readonly LiquidacaoEvento[];
}

export interface Liquidacao {
  pagoCentavos: number;
  abertoCentavos: number;
  dataUltimoPagamento: string | null;
  baixasAtivas: BaixaEvento[];
}

export type LiquidacaoErroCodigo =
  | 'CentavosInvalidos'
  | 'DataInvalida'
  | 'EventoInvalido'
  | 'IdDuplicado'
  | 'EstornoSemBaixa'
  | 'BaixaJaEstornada'
  | 'EstornoValorDivergente';

export class LiquidacaoErro extends Error {
  readonly codigo: LiquidacaoErroCodigo;
  constructor(codigo: LiquidacaoErroCodigo, mensagem: string) {
    super(`liquidacao: ${mensagem}`);
    this.name = 'LiquidacaoErro';
    this.codigo = codigo;
  }
}

const DIA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function ehBissexto(ano: number): boolean {
  return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
}

function diasNoMes(ano: number, mes: number): number {
  if (mes === 2) return ehBissexto(ano) ? 29 : 28;
  return mes === 4 || mes === 6 || mes === 9 || mes === 11 ? 30 : 31;
}

function ehDiaCivil(valor: unknown): valor is string {
  if (typeof valor !== 'string') return false;
  const partes = DIA_ISO.exec(valor);
  if (!partes) return false;
  const ano = parseInt(partes[1] ?? '', 10);
  const mes = parseInt(partes[2] ?? '', 10);
  const dia = parseInt(partes[3] ?? '', 10);
  if (ano < 1 || mes < 1 || mes > 12 || dia < 1) return false;
  return dia <= diasNoMes(ano, mes);
}

function assertCentavos(valor: unknown, minimo: 0 | 1, campo: string): void {
  if (typeof valor !== 'number' || !Number.isSafeInteger(valor) || valor < minimo) {
    throw new LiquidacaoErro('CentavosInvalidos', `${campo} precisa ser inteiro seguro >= ${minimo}`);
  }
}

function validarEvento(evento: LiquidacaoEvento): void {
  const e = evento as unknown as Record<string, unknown>;
  if (typeof e.id !== 'string' || e.id.length === 0) throw new LiquidacaoErro('EventoInvalido', 'id vazio');
  if (e.tipo === 'baixa') {
    if (e.estornaBaixaId !== null) throw new LiquidacaoErro('EventoInvalido', `baixa ${e.id} com estornaBaixaId`);
  } else if (e.tipo === 'estorno') {
    if (typeof e.estornaBaixaId !== 'string' || e.estornaBaixaId.length === 0) {
      throw new LiquidacaoErro('EventoInvalido', `estorno ${e.id} sem estornaBaixaId`);
    }
  } else {
    throw new LiquidacaoErro('EventoInvalido', `tipo desconhecido em ${e.id}`);
  }
  if (!ehDiaCivil(e.data)) throw new LiquidacaoErro('DataInvalida', `data invalida em ${e.id}`);
  assertCentavos(e.valorCentavos, 1, `valorCentavos de ${e.id}`);
}

function compararBaixas(a: BaixaEvento, b: BaixaEvento): number {
  if (a.data !== b.data) return a.data < b.data ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

export function reduzirLiquidacao(entrada: LiquidacaoEntrada): Liquidacao {
  assertCentavos(entrada.valorOriginalCentavos, 0, 'valorOriginalCentavos');
  for (const evento of entrada.eventos) validarEvento(evento);

  const porId = new Map<string, LiquidacaoEvento>();
  for (const evento of entrada.eventos) {
    if (porId.has(evento.id)) throw new LiquidacaoErro('IdDuplicado', `id repetido ${evento.id}`);
    porId.set(evento.id, evento);
  }

  const estornadas = new Set<string>();
  for (const evento of entrada.eventos) {
    if (evento.tipo !== 'estorno') continue;
    const alvo = porId.get(evento.estornaBaixaId);
    if (!alvo || alvo.tipo !== 'baixa') {
      throw new LiquidacaoErro('EstornoSemBaixa', `estorno ${evento.id} nao cita uma baixa da lista`);
    }
    if (estornadas.has(alvo.id)) throw new LiquidacaoErro('BaixaJaEstornada', `baixa ${alvo.id} ja estornada`);
    if (evento.valorCentavos !== alvo.valorCentavos) {
      throw new LiquidacaoErro('EstornoValorDivergente', `estorno ${evento.id} difere da baixa ${alvo.id}`);
    }
    estornadas.add(alvo.id);
  }

  const baixasAtivas = entrada.eventos
    .filter((e): e is BaixaEvento => e.tipo === 'baixa' && !estornadas.has(e.id))
    .map((b) => ({ ...b }))
    .sort(compararBaixas);
  let pagoCentavos = 0;
  for (const baixa of baixasAtivas) pagoCentavos += baixa.valorCentavos;
  const ultima = baixasAtivas[baixasAtivas.length - 1];
  return {
    pagoCentavos,
    abertoCentavos: Math.max(entrada.valorOriginalCentavos - pagoCentavos, 0),
    dataUltimoPagamento: ultima ? ultima.data : null,
    baixasAtivas,
  };
}

export type StatusLinhaLiquidavel = 'open' | 'paid' | 'void';
export type StatusVendaLiquidavel = 'draft' | 'open' | 'won' | 'lost' | 'cancelled';

/** Codigos de wire de C5, iguais ao `error` que a API responde. */
export type RecusaBaixaCodigo =
  | 'sale_not_won'
  | 'row_void'
  | 'invalid_paid_on'
  | 'paid_on_in_future'
  | 'already_paid';
export type RecusaEstornoCodigo = 'not_found' | 'already_reversed';

export interface NovaBaixaEntrada {
  readonly valorOriginalCentavos: number;
  readonly eventos: readonly LiquidacaoEvento[];
  readonly statusLinha: StatusLinhaLiquidavel;
  readonly statusVenda: StatusVendaLiquidavel;
  readonly dataPagamento: string;
  readonly hojeSaoPaulo: string;
}

export type NovaBaixaResultado =
  | { readonly ok: true; readonly valorCentavos: number; readonly data: string }
  | { readonly ok: false; readonly codigo: RecusaBaixaCodigo };

export function validarNovaBaixa(entrada: NovaBaixaEntrada): NovaBaixaResultado {
  if (!ehDiaCivil(entrada.hojeSaoPaulo)) throw new LiquidacaoErro('DataInvalida', 'hojeSaoPaulo invalido');
  if (entrada.statusVenda !== 'won') return { ok: false, codigo: 'sale_not_won' };
  if (entrada.statusLinha === 'void') return { ok: false, codigo: 'row_void' };
  if (!ehDiaCivil(entrada.dataPagamento)) return { ok: false, codigo: 'invalid_paid_on' };
  if (entrada.dataPagamento > entrada.hojeSaoPaulo) return { ok: false, codigo: 'paid_on_in_future' };
  const { abertoCentavos } = reduzirLiquidacao({
    valorOriginalCentavos: entrada.valorOriginalCentavos,
    eventos: entrada.eventos,
  });
  if (abertoCentavos === 0) return { ok: false, codigo: 'already_paid' };
  return { ok: true, valorCentavos: abertoCentavos, data: entrada.dataPagamento };
}

export interface EstornoEntrada {
  readonly baixaId: string;
  readonly eventos: readonly LiquidacaoEvento[];
  readonly hojeSaoPaulo: string;
}

export type EstornoResultado =
  | { readonly ok: true; readonly estornaBaixaId: string; readonly valorCentavos: number; readonly data: string }
  | { readonly ok: false; readonly codigo: RecusaEstornoCodigo };

export function validarEstorno(entrada: EstornoEntrada): EstornoResultado {
  if (!ehDiaCivil(entrada.hojeSaoPaulo)) throw new LiquidacaoErro('DataInvalida', 'hojeSaoPaulo invalido');
  const { baixasAtivas } = reduzirLiquidacao({ valorOriginalCentavos: 0, eventos: entrada.eventos });
  const alvo = entrada.eventos.find((e) => e.id === entrada.baixaId && e.tipo === 'baixa');
  if (!alvo) return { ok: false, codigo: 'not_found' };
  if (!baixasAtivas.some((b) => b.id === alvo.id)) return { ok: false, codigo: 'already_reversed' };
  return { ok: true, estornaBaixaId: alvo.id, valorCentavos: alvo.valorCentavos, data: entrada.hojeSaoPaulo };
}

/** Cache de `status` da linha: `void` e decisao do Sales e nunca muda aqui. */
export function statusCacheDaLinha(statusAtual: StatusLinhaLiquidavel, liquidacao: Liquidacao): StatusLinhaLiquidavel {
  if (statusAtual === 'void') return 'void';
  return liquidacao.baixasAtivas.length > 0 && liquidacao.abertoCentavos === 0 ? 'paid' : 'open';
}

/** Trava de C5 (valor, vencimento, sair de won): existe baixa ativa? */
export function temBaixaAtiva(eventos: readonly LiquidacaoEvento[]): boolean {
  return reduzirLiquidacao({ valorOriginalCentavos: 0, eventos }).baixasAtivas.length > 0;
}

/** Linha de `sales_ops_settlements` (camelCase do Drizzle, C3) para o evento do redutor. */
export interface SettlementRowLike {
  readonly id: string;
  readonly type: string;
  readonly reversesSettlementId: string | null;
  readonly paidOn: string;
  readonly amountBrl: number;
}

export function eventoDeSettlement(row: SettlementRowLike): LiquidacaoEvento {
  return {
    id: row.id,
    tipo: row.type,
    estornaBaixaId: row.reversesSettlementId,
    data: row.paidOn,
    valorCentavos: row.amountBrl,
  } as unknown as LiquidacaoEvento;
}
