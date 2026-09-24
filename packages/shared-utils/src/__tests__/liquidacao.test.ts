import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  eventoDeSettlement,
  LiquidacaoErro,
  reduzirLiquidacao,
  statusCacheDaLinha,
  temBaixaAtiva,
  validarEstorno,
  validarNovaBaixa,
  type BaixaEvento,
  type EstornoEvento,
  type LiquidacaoErroCodigo,
  type LiquidacaoEvento,
} from '../liquidacao.js';

const baixa = (id: string, data: string, valorCentavos: number): BaixaEvento => ({
  id,
  tipo: 'baixa',
  estornaBaixaId: null,
  data,
  valorCentavos,
});

const estorno = (id: string, alvo: string, data: string, valorCentavos: number): EstornoEvento => ({
  id,
  tipo: 'estorno',
  estornaBaixaId: alvo,
  data,
  valorCentavos,
});

const capturar = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error('nao lancou');
};

// Testes oraculo copiados de F:nexo/plans/20260924T011357Z-feedback-socio-financeiro/01-liquidacao-redutor.md
// (secao "Testes oraculo", copiado 2026-09-23).
// Quando o Finance mudar uma regra, mude aqui na mesma respiracao; uma falha aqui e uma
// divergencia entre os dois apps.
type Esperado =
  | { pago: number; aberto: number; data: string | null; ativas: string[] }
  | { erro: LiquidacaoErroCodigo };

interface CasoParidade {
  readonly financeCaso: number;
  readonly nome: string;
  readonly original: number;
  readonly eventos: readonly LiquidacaoEvento[];
  readonly esperado: Esperado;
}

const PARIDADE_FINANCE: readonly CasoParidade[] = [
  {
    financeCaso: 1,
    nome: 'sem eventos',
    original: 1000,
    eventos: [],
    esperado: { pago: 0, aberto: 1000, data: null, ativas: [] },
  },
  {
    financeCaso: 2,
    nome: 'baixa integral',
    original: 1000,
    eventos: [baixa('b1', '2026-03-25', 1000)],
    esperado: { pago: 1000, aberto: 0, data: '2026-03-25', ativas: ['b1'] },
  },
  {
    financeCaso: 3,
    nome: 'um centavo em aberto (8.15 x 8.14)',
    original: 815,
    eventos: [baixa('b1', '2026-03-10', 814)],
    esperado: { pago: 814, aberto: 1, data: '2026-03-10', ativas: ['b1'] },
  },
  {
    financeCaso: 4,
    nome: 'valor que nao divide exato, parcial',
    original: 1000,
    eventos: [baixa('b1', '2026-01-10', 333), baixa('b2', '2026-02-10', 333)],
    esperado: { pago: 666, aberto: 334, data: '2026-02-10', ativas: ['b1', 'b2'] },
  },
  {
    financeCaso: 4,
    nome: 'valor que nao divide exato, completo',
    original: 1000,
    eventos: [
      baixa('b1', '2026-01-10', 333),
      baixa('b2', '2026-02-10', 333),
      baixa('b3', '2026-03-10', 334),
    ],
    esperado: { pago: 1000, aberto: 0, data: '2026-03-10', ativas: ['b1', 'b2', 'b3'] },
  },
  {
    financeCaso: 5,
    nome: 'data = a MAIOR, nao a ultima do array nem a menor',
    original: 3000,
    eventos: [
      baixa('b1', '2026-03-25', 1000),
      baixa('b2', '2026-01-05', 1000),
      baixa('b3', '2026-02-14', 1000),
    ],
    esperado: { pago: 3000, aberto: 0, data: '2026-03-25', ativas: ['b2', 'b3', 'b1'] },
  },
  {
    financeCaso: 6,
    nome: 'empate de data ordena por id',
    original: 20,
    eventos: [baixa('b2', '2026-03-01', 10), baixa('b1', '2026-03-01', 10)],
    esperado: { pago: 20, aberto: 0, data: '2026-03-01', ativas: ['b1', 'b2'] },
  },
  {
    financeCaso: 7,
    nome: 'estorno desativa a baixa citada, inclusive a data',
    original: 1000,
    eventos: [baixa('b1', '2026-03-25', 1000), estorno('e1', 'b1', '2026-03-26', 1000)],
    esperado: { pago: 0, aberto: 1000, data: null, ativas: [] },
  },
  {
    financeCaso: 8,
    nome: 'estorno e nova baixa',
    original: 1000,
    eventos: [
      baixa('b1', '2026-03-25', 1000),
      estorno('e1', 'b1', '2026-03-26', 1000),
      baixa('b2', '2026-03-28', 1000),
    ],
    esperado: { pago: 1000, aberto: 0, data: '2026-03-28', ativas: ['b2'] },
  },
  {
    financeCaso: 9,
    nome: 'estorno da baixa mais recente devolve a data anterior',
    original: 1000,
    eventos: [
      baixa('b1', '2026-01-10', 500),
      baixa('b2', '2026-02-10', 500),
      estorno('e1', 'b2', '2026-02-11', 500),
    ],
    esperado: { pago: 500, aberto: 500, data: '2026-01-10', ativas: ['b1'] },
  },
  {
    financeCaso: 10,
    nome: 'ordem do array nao importa',
    original: 1000,
    eventos: [
      estorno('e1', 'b1', '2026-03-26', 1000),
      baixa('b1', '2026-03-25', 1000),
      baixa('b2', '2026-03-28', 1000),
    ],
    esperado: { pago: 1000, aberto: 0, data: '2026-03-28', ativas: ['b2'] },
  },
  {
    financeCaso: 11,
    nome: 'pago acima do original nao e truncado e aberto nao fica negativo',
    original: 1000,
    eventos: [baixa('b1', '2026-03-01', 1000), baixa('b2', '2026-03-02', 1000)],
    esperado: { pago: 2000, aberto: 0, data: '2026-03-02', ativas: ['b1', 'b2'] },
  },
  {
    financeCaso: 12,
    nome: 'original zero',
    original: 0,
    eventos: [],
    esperado: { pago: 0, aberto: 0, data: null, ativas: [] },
  },
  {
    financeCaso: 14,
    nome: 'estorno citando id desconhecido',
    original: 1000,
    eventos: [baixa('b1', '2026-03-01', 1000), estorno('e1', 'x', '2026-03-02', 1000)],
    esperado: { erro: 'EstornoSemBaixa' },
  },
  {
    financeCaso: 15,
    nome: 'estorno de um estorno',
    original: 1000,
    eventos: [
      baixa('b1', '2026-03-01', 1000),
      estorno('e1', 'b1', '2026-03-02', 1000),
      estorno('e2', 'e1', '2026-03-03', 1000),
    ],
    esperado: { erro: 'EstornoSemBaixa' },
  },
  {
    financeCaso: 16,
    nome: 'dois estornos da mesma baixa',
    original: 1000,
    eventos: [
      baixa('b1', '2026-03-01', 1000),
      estorno('e1', 'b1', '2026-03-02', 1000),
      estorno('e2', 'b1', '2026-03-03', 1000),
    ],
    esperado: { erro: 'BaixaJaEstornada' },
  },
  {
    financeCaso: 17,
    nome: 'estorno com valor diferente',
    original: 1000,
    eventos: [baixa('b1', '2026-03-01', 1000), estorno('e1', 'b1', '2026-03-02', 999)],
    esperado: { erro: 'EstornoValorDivergente' },
  },
  {
    financeCaso: 18,
    nome: 'ids repetidos',
    original: 2000,
    eventos: [baixa('b1', '2026-03-01', 1000), baixa('b1', '2026-03-02', 1000)],
    esperado: { erro: 'IdDuplicado' },
  },
  {
    financeCaso: 19,
    nome: 'valorCentavos invalido: zero',
    original: 1000,
    eventos: [baixa('b1', '2026-03-01', 0)],
    esperado: { erro: 'CentavosInvalidos' },
  },
  {
    financeCaso: 19,
    nome: 'valorCentavos invalido: negativo',
    original: 1000,
    eventos: [baixa('b1', '2026-03-01', -100)],
    esperado: { erro: 'CentavosInvalidos' },
  },
  {
    financeCaso: 19,
    nome: 'valorCentavos invalido: decimal',
    original: 1000,
    eventos: [baixa('b1', '2026-03-01', 10.5)],
    esperado: { erro: 'CentavosInvalidos' },
  },
  {
    financeCaso: 19,
    nome: 'valorCentavos invalido: NaN',
    original: 1000,
    eventos: [baixa('b1', '2026-03-01', NaN)],
    esperado: { erro: 'CentavosInvalidos' },
  },
  {
    financeCaso: 19,
    nome: 'valorCentavos invalido: Infinity',
    original: 1000,
    eventos: [baixa('b1', '2026-03-01', Infinity)],
    esperado: { erro: 'CentavosInvalidos' },
  },
  {
    financeCaso: 19,
    nome: 'valorCentavos invalido: acima do inteiro seguro',
    original: 1000,
    eventos: [baixa('b1', '2026-03-01', 2 ** 53)],
    esperado: { erro: 'CentavosInvalidos' },
  },
  {
    financeCaso: 20,
    nome: 'original invalido: negativo',
    original: -1,
    eventos: [],
    esperado: { erro: 'CentavosInvalidos' },
  },
  {
    financeCaso: 20,
    nome: 'original invalido: decimal',
    original: 10.5,
    eventos: [],
    esperado: { erro: 'CentavosInvalidos' },
  },
  {
    financeCaso: 21,
    nome: 'data invalida: mes sem zero',
    original: 1000,
    eventos: [baixa('b1', '2026-3-05', 1000)],
    esperado: { erro: 'DataInvalida' },
  },
  {
    financeCaso: 21,
    nome: 'data invalida: dia 30 de fevereiro',
    original: 1000,
    eventos: [baixa('b1', '2026-02-30', 1000)],
    esperado: { erro: 'DataInvalida' },
  },
  {
    financeCaso: 21,
    nome: 'data invalida: mes 13',
    original: 1000,
    eventos: [baixa('b1', '2026-13-01', 1000)],
    esperado: { erro: 'DataInvalida' },
  },
  {
    financeCaso: 21,
    nome: 'data invalida: formato brasileiro',
    original: 1000,
    eventos: [baixa('b1', '25/03/2026', 1000)],
    esperado: { erro: 'DataInvalida' },
  },
  {
    financeCaso: 21,
    nome: 'data invalida: vazia',
    original: 1000,
    eventos: [baixa('b1', '', 1000)],
    esperado: { erro: 'DataInvalida' },
  },
  {
    financeCaso: 21,
    nome: 'data invalida: com hora e fuso',
    original: 1000,
    eventos: [baixa('b1', '2026-03-05T00:00:00Z', 1000)],
    esperado: { erro: 'DataInvalida' },
  },
  {
    financeCaso: 21,
    nome: 'bissexto aceito',
    original: 1000,
    eventos: [baixa('b1', '2024-02-29', 1000)],
    esperado: { pago: 1000, aberto: 0, data: '2024-02-29', ativas: ['b1'] },
  },
  {
    financeCaso: 22,
    nome: 'evento malformado: baixa com estornaBaixaId',
    original: 1000,
    eventos: [
      { id: 'b1', tipo: 'baixa', estornaBaixaId: 'x', data: '2026-03-01', valorCentavos: 1000 } as unknown as LiquidacaoEvento,
    ],
    esperado: { erro: 'EventoInvalido' },
  },
  {
    financeCaso: 22,
    nome: 'evento malformado: estorno sem estornaBaixaId',
    original: 1000,
    eventos: [
      { id: 'e1', tipo: 'estorno', estornaBaixaId: null, data: '2026-03-01', valorCentavos: 1000 } as unknown as LiquidacaoEvento,
    ],
    esperado: { erro: 'EventoInvalido' },
  },
  {
    financeCaso: 22,
    nome: 'evento malformado: tipo desconhecido',
    original: 1000,
    eventos: [
      { id: 'p1', tipo: 'pagamento', estornaBaixaId: null, data: '2026-03-01', valorCentavos: 1000 } as unknown as LiquidacaoEvento,
    ],
    esperado: { erro: 'EventoInvalido' },
  },
  {
    financeCaso: 22,
    nome: 'evento malformado: id vazio',
    original: 1000,
    eventos: [
      { id: '', tipo: 'baixa', estornaBaixaId: null, data: '2026-03-01', valorCentavos: 1000 } as unknown as LiquidacaoEvento,
    ],
    esperado: { erro: 'EventoInvalido' },
  },
];

describe('liquidacao parity with Finance', () => {
  it.each(PARIDADE_FINANCE)('Finance case $financeCaso: $nome', ({ original, eventos, esperado }) => {
    if ('erro' in esperado) {
      const erro = capturar(() => reduzirLiquidacao({ valorOriginalCentavos: original, eventos })) as LiquidacaoErro;
      expect(erro).toBeInstanceOf(LiquidacaoErro);
      expect(erro.codigo).toBe(esperado.erro);
      return;
    }
    const resultado = reduzirLiquidacao({ valorOriginalCentavos: original, eventos });
    expect({
      pagoCentavos: resultado.pagoCentavos,
      abertoCentavos: resultado.abertoCentavos,
      dataUltimoPagamento: resultado.dataUltimoPagamento,
      ids: resultado.baixasAtivas.map((b) => b.id),
    }).toEqual({
      pagoCentavos: esperado.pago,
      abertoCentavos: esperado.aberto,
      dataUltimoPagamento: esperado.data,
      ids: esperado.ativas,
    });
  });

  it('covers every Finance reducer oracle case', () => {
    expect([...new Set(PARIDADE_FINANCE.map((c) => c.financeCaso))].sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22,
    ]);
  });
});

describe('reduzirLiquidacao - invariants', () => {
  it('does not mutate its input and copies the active baixas (Finance 13)', () => {
    const b2 = Object.freeze(baixa('b2', '2026-03-25', 1000));
    const b1 = Object.freeze(baixa('b1', '2026-01-05', 1000));
    const eventos = Object.freeze([b2, b1]);
    const resultado = reduzirLiquidacao({ valorOriginalCentavos: 2000, eventos });
    expect(eventos[0]).toBe(b2);
    expect(eventos[1]).toBe(b1);
    expect(resultado.baixasAtivas[0]).not.toBe(b1);
    expect(resultado.baixasAtivas[1]).not.toBe(b2);
  });

  it('LiquidacaoErro is not a RangeError (Finance 23)', () => {
    const erro = capturar(() =>
      reduzirLiquidacao({
        valorOriginalCentavos: 1000,
        eventos: [
          baixa('b1', '2026-03-01', 1000),
          estorno('e1', 'b1', '2026-03-02', 1000),
          estorno('e2', 'b1', '2026-03-03', 1000),
        ],
      }),
    ) as LiquidacaoErro;
    expect(erro).toBeInstanceOf(LiquidacaoErro);
    expect(erro).not.toBeInstanceOf(RangeError);
    expect(erro.name).toBe('LiquidacaoErro');
  });
});

describe('validarNovaBaixa', () => {
  const base = {
    valorOriginalCentavos: 1000,
    eventos: [] as readonly LiquidacaoEvento[],
    statusLinha: 'open' as const,
    statusVenda: 'won' as const,
    dataPagamento: '2026-03-26',
    hojeSaoPaulo: '2026-03-26',
  };

  it('accepts today and returns the whole open amount', () => {
    expect(validarNovaBaixa(base)).toEqual({ ok: true, valorCentavos: 1000, data: '2026-03-26' });
  });

  it('accepts a past day', () => {
    expect(validarNovaBaixa({ ...base, dataPagamento: '2026-03-10' })).toEqual({
      ok: true,
      valorCentavos: 1000,
      data: '2026-03-10',
    });
  });

  it('refuses tomorrow as paid_on_in_future', () => {
    expect(validarNovaBaixa({ ...base, dataPagamento: '2026-03-27' })).toEqual({
      ok: false,
      codigo: 'paid_on_in_future',
    });
  });

  it('refuses a malformed day as invalid_paid_on', () => {
    expect(validarNovaBaixa({ ...base, dataPagamento: '2026-02-30' })).toEqual({
      ok: false,
      codigo: 'invalid_paid_on',
    });
    expect(validarNovaBaixa({ ...base, dataPagamento: '26/03/2026' })).toEqual({
      ok: false,
      codigo: 'invalid_paid_on',
    });
  });

  it('refuses a row that is already paid by its facts', () => {
    expect(
      validarNovaBaixa({ ...base, eventos: [baixa('b1', '2026-03-01', 1000)] }),
    ).toEqual({ ok: false, codigo: 'already_paid' });
  });

  it('trusts the facts over a stale status cache', () => {
    expect(validarNovaBaixa({ ...base, statusLinha: 'paid', eventos: [] })).toEqual({
      ok: true,
      valorCentavos: 1000,
      data: '2026-03-26',
    });
    expect(
      validarNovaBaixa({
        ...base,
        statusLinha: 'open',
        eventos: [baixa('b1', '2026-03-01', 1000)],
      }),
    ).toEqual({ ok: false, codigo: 'already_paid' });
  });

  it('settles again after a reversal', () => {
    expect(
      validarNovaBaixa({
        ...base,
        eventos: [baixa('b1', '2026-03-01', 1000), estorno('e1', 'b1', '2026-03-02', 1000)],
      }),
    ).toEqual({ ok: true, valorCentavos: 1000, data: '2026-03-26' });
  });

  it('refuses a void row as row_void', () => {
    expect(validarNovaBaixa({ ...base, statusLinha: 'void' })).toEqual({
      ok: false,
      codigo: 'row_void',
    });
  });

  it('refuses a proposta that is not won', () => {
    for (const statusVenda of ['draft', 'open', 'lost', 'cancelled'] as const) {
      expect(validarNovaBaixa({ ...base, statusVenda })).toEqual({
        ok: false,
        codigo: 'sale_not_won',
      });
    }
  });

  it('checks in a fixed order', () => {
    expect(
      validarNovaBaixa({
        ...base,
        statusVenda: 'open',
        statusLinha: 'void',
        dataPagamento: '2026-03-27',
      }),
    ).toEqual({ ok: false, codigo: 'sale_not_won' });
    expect(
      validarNovaBaixa({ ...base, statusLinha: 'void', dataPagamento: '2026-03-27' }),
    ).toEqual({ ok: false, codigo: 'row_void' });
    expect(
      validarNovaBaixa({
        ...base,
        dataPagamento: '2026-03-27',
        eventos: [baixa('b1', '2026-03-01', 1000)],
      }),
    ).toEqual({ ok: false, codigo: 'paid_on_in_future' });
  });

  it('a zero-amount row has nothing to settle', () => {
    expect(validarNovaBaixa({ ...base, valorOriginalCentavos: 0 })).toEqual({
      ok: false,
      codigo: 'already_paid',
    });
  });

  it('throws on a malformed today', () => {
    const erro = capturar(() => validarNovaBaixa({ ...base, hojeSaoPaulo: '2026-3-26' })) as LiquidacaoErro;
    expect(erro).toBeInstanceOf(LiquidacaoErro);
    expect(erro.codigo).toBe('DataInvalida');
  });

  it('throws on a corrupt history', () => {
    const erro = capturar(() =>
      validarNovaBaixa({
        ...base,
        eventos: [
          baixa('b1', '2026-03-01', 1000),
          estorno('e1', 'b1', '2026-03-02', 1000),
          estorno('e2', 'b1', '2026-03-03', 1000),
        ],
      }),
    ) as LiquidacaoErro;
    expect(erro).toBeInstanceOf(LiquidacaoErro);
    expect(erro.codigo).toBe('BaixaJaEstornada');
  });
});

describe('validarEstorno', () => {
  it('reverses an active baixa on today with its own amount', () => {
    expect(
      validarEstorno({
        baixaId: 'b1',
        eventos: [baixa('b1', '2026-03-01', 1000)],
        hojeSaoPaulo: '2026-03-26',
      }),
    ).toEqual({ ok: true, estornaBaixaId: 'b1', valorCentavos: 1000, data: '2026-03-26' });
  });

  it('refuses an unknown id as not_found', () => {
    expect(
      validarEstorno({
        baixaId: 'x',
        eventos: [baixa('b1', '2026-03-01', 1000)],
        hojeSaoPaulo: '2026-03-26',
      }),
    ).toEqual({ ok: false, codigo: 'not_found' });
  });

  it('refuses the id of an estorno as not_found', () => {
    expect(
      validarEstorno({
        baixaId: 'e1',
        eventos: [baixa('b1', '2026-03-01', 1000), estorno('e1', 'b1', '2026-03-02', 1000)],
        hojeSaoPaulo: '2026-03-26',
      }),
    ).toEqual({ ok: false, codigo: 'not_found' });
  });

  it('refuses a baixa already reversed', () => {
    expect(
      validarEstorno({
        baixaId: 'b1',
        eventos: [baixa('b1', '2026-03-01', 1000), estorno('e1', 'b1', '2026-03-02', 1000)],
        hojeSaoPaulo: '2026-03-26',
      }),
    ).toEqual({ ok: false, codigo: 'already_reversed' });
  });

  it('throws on a malformed today', () => {
    const erro = capturar(() =>
      validarEstorno({ baixaId: 'b1', eventos: [baixa('b1', '2026-03-01', 1000)], hojeSaoPaulo: '' }),
    ) as LiquidacaoErro;
    expect(erro).toBeInstanceOf(LiquidacaoErro);
    expect(erro.codigo).toBe('DataInvalida');
  });
});

describe('statusCacheDaLinha and temBaixaAtiva', () => {
  it('void stays void even with an active baixa', () => {
    const liquidacao = reduzirLiquidacao({
      valorOriginalCentavos: 1000,
      eventos: [baixa('b1', '2026-03-01', 1000)],
    });
    expect(statusCacheDaLinha('void', liquidacao)).toBe('void');
  });

  it('paid only when an active baixa leaves nothing open', () => {
    const cheia = reduzirLiquidacao({
      valorOriginalCentavos: 1000,
      eventos: [baixa('b1', '2026-03-01', 1000)],
    });
    expect(statusCacheDaLinha('open', cheia)).toBe('paid');

    const estornada = reduzirLiquidacao({
      valorOriginalCentavos: 1000,
      eventos: [baixa('b1', '2026-03-01', 1000), estorno('e1', 'b1', '2026-03-02', 1000)],
    });
    expect(statusCacheDaLinha('paid', estornada)).toBe('open');

    const vazia = reduzirLiquidacao({ valorOriginalCentavos: 0, eventos: [] });
    expect(statusCacheDaLinha('open', vazia)).toBe('open');
  });

  it('temBaixaAtiva', () => {
    expect(temBaixaAtiva([])).toBe(false);
    expect(temBaixaAtiva([baixa('b1', '2026-03-01', 1000)])).toBe(true);
    expect(
      temBaixaAtiva([baixa('b1', '2026-03-01', 1000), estorno('e1', 'b1', '2026-03-02', 1000)]),
    ).toBe(false);
    expect(
      temBaixaAtiva([
        baixa('b1', '2026-03-01', 1000),
        estorno('e1', 'b1', '2026-03-02', 1000),
        baixa('b2', '2026-03-03', 500),
      ]),
    ).toBe(true);
  });

  it('eventoDeSettlement maps a DB row and lets the reducer validate it', () => {
    const evento = eventoDeSettlement({
      id: 's1',
      type: 'baixa',
      reversesSettlementId: null,
      paidOn: '2026-03-01',
      amountBrl: 1000,
    });
    expect(reduzirLiquidacao({ valorOriginalCentavos: 1000, eventos: [evento] }).pagoCentavos).toBe(1000);

    const invalido = eventoDeSettlement({
      id: 's1',
      type: 'baixa',
      reversesSettlementId: 's0',
      paidOn: '2026-03-01',
      amountBrl: 1000,
    });
    const erro = capturar(() =>
      reduzirLiquidacao({ valorOriginalCentavos: 1000, eventos: [invalido] }),
    ) as LiquidacaoErro;
    expect(erro).toBeInstanceOf(LiquidacaoErro);
    expect(erro.codigo).toBe('EventoInvalido');
  });
});

describe('source guard', () => {
  it('liquidacao.ts reads no clock, no float, no locale and imports nothing', () => {
    const fonte = readFileSync(new URL('../liquidacao.ts', import.meta.url), 'utf8');
    const proibidos = [
      /^\s*import\s/m,
      /new\s+Date\s*\(/,
      /Date\.now\s*\(/,
      /parseFloat\s*\(/,
      /\bNumber\s*\(/,
      /toFixed\s*\(/,
      /\.toISOString\s*\(/,
      /\.getUTC/,
      /\bIntl\b/,
      /Math\.round\s*\(/,
      /localeCompare/,
      /todayInSaoPaulo/,
    ];
    for (const re of proibidos) {
      expect(fonte).not.toMatch(re);
    }
    expect(fonte).toMatch(/export function reduzirLiquidacao\(/);
  });

  it('sanity: the forbidden patterns actually match what they are meant to catch', () => {
    expect('Number.isSafeInteger(x)').not.toMatch(/\bNumber\s*\(/);
    expect('x = new Date(1)').toMatch(/new\s+Date\s*\(/);
  });
});

describe('package boundary', () => {
  it('the root index re-exports the reducer', async () => {
    const raiz = await import('../index.js');
    expect(raiz.reduzirLiquidacao).toBe(reduzirLiquidacao);
    expect(raiz.LiquidacaoErro).toBe(LiquidacaoErro);
    expect(raiz.validarNovaBaixa).toBe(validarNovaBaixa);
    expect(raiz.validarEstorno).toBe(validarEstorno);
  });

  it('package.json exports the ./liquidacao subpath', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(pkg.exports['./liquidacao']).toEqual({
      types: './dist/liquidacao.d.ts',
      import: './dist/liquidacao.js',
    });
  });
});
