import type { SheetKey } from './types.js';

export type CellKind =
  | { type: 'text'; max: number }
  | { type: 'money' }
  | { type: 'int'; min: number; max: number }
  | { type: 'pct' }
  | { type: 'day' }
  | { type: 'enum'; options: readonly { label: string; value: string }[] }
  | { type: 'bool' }
  | { type: 'list'; max: number };

export type ListSource =
  | 'areas'
  | 'funcoes'
  | 'produtos'
  | 'pessoas'
  | 'vendedores'
  | 'finders'
  | 'clientes'
  | 'etapas'
  | 'enum';

export type ColumnDef = {
  key: string;
  header: string;
  kind: CellKind;
  required: boolean;
  help: string;
  example: string | number | null;
  list?: ListSource;
  /** Template hint (slice 08): the dropdown must ACCEPT values outside the list (Excel errorStyle 'information'). */
  freeText?: boolean;
};

export type SheetDef = { key: SheetKey; tab: string; columns: readonly ColumnDef[]; maxRows: number };

export const LEIAME_TAB = 'Leia-me';
export const LISTAS_TAB = 'Listas';
export const MAX_TOTAL_ROWS = 5000;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_RETURNED_ISSUES = 500;

export const SHEET_KEYS = [
  'areas',
  'funcoes',
  'produtos',
  'custosProduto',
  'pessoas',
  'clientes',
  'etapas',
  'leads',
  'propostas',
  'itens',
  'profissionais',
  'parcelas',
  'pagamentos',
] as const satisfies readonly SheetKey[];

export const PRODUCT_KIND_OPTIONS = [
  { label: 'Produto', value: 'product' },
  { label: 'Serviço', value: 'service' },
] as const;
export const PAYMENT_METHOD_OPTIONS = [
  { label: 'Pix', value: 'pix' },
  { label: 'Cartão', value: 'card' },
  { label: 'Boleto', value: 'boleto' },
  { label: 'Transferência', value: 'transfer' },
] as const;
export const SALE_STATUS_OPTIONS = [
  { label: 'Rascunho', value: 'draft' },
  { label: 'Aberta', value: 'open' },
  { label: 'Ganha', value: 'won' },
  { label: 'Perdida', value: 'lost' },
  { label: 'Cancelada', value: 'cancelled' },
] as const;
/** Labels a bool column accepts on output (template dropdown); input is wider, see cells.ts. */
export const BOOL_LABELS = { true: 'Sim', false: 'Não' } as const;

export const WORKBOOK_SHEETS = [
  {
    key: 'areas',
    tab: 'Áreas',
    maxRows: 500,
    columns: [
      { key: 'nome', header: 'Nome', kind: { type: 'text', max: 120 }, required: true, example: 'Tecnologia', help: 'Nome da área, por exemplo Tecnologia ou Marketing.' },
    ],
  },
  {
    key: 'funcoes',
    tab: 'Funções',
    maxRows: 200,
    columns: [
      { key: 'nome', header: 'Nome', kind: { type: 'text', max: 120 }, required: true, example: 'Desenvolvedor', help: 'Nome da função que uma pessoa exerce; Vendedor e Finder já existem e não precisam ser criados.' },
    ],
  },
  {
    key: 'produtos',
    tab: 'Produtos',
    maxRows: 1000,
    columns: [
      { key: 'nome', header: 'Nome', kind: { type: 'text', max: 140 }, required: true, example: 'Sistema de gestão', help: 'Nome do produto ou serviço.' },
      { key: 'tipo', header: 'Tipo', kind: { type: 'enum', options: PRODUCT_KIND_OPTIONS }, required: false, list: 'enum', example: 'Produto', help: 'Produto ou Serviço; em branco vale Produto.' },
      { key: 'codigo', header: 'Código', kind: { type: 'int', min: 0, max: 99 }, required: false, example: null, help: 'Número do código (0 a 99); em branco, o próximo número livre é usado.' },
      { key: 'area', header: 'Área', kind: { type: 'text', max: 120 }, required: true, list: 'areas', example: 'Tecnologia', help: 'Área do produto, já cadastrada ou criada na aba Áreas.' },
      { key: 'valor', header: 'Valor (R$)', kind: { type: 'money' }, required: false, example: 'R$ 5.000,00', help: 'Preço de setup de um Produto ou valor base de um Serviço; em branco ou zero significa valor variável.' },
      { key: 'temMensalidade', header: 'Tem mensalidade', kind: { type: 'bool' }, required: false, list: 'enum', example: 'Sim', help: 'Sim quando o produto cobra mensalidade recorrente.' },
      { key: 'mensalidade', header: 'Mensalidade (R$)', kind: { type: 'money' }, required: false, example: 'R$ 300,00', help: 'Valor mensal padrão, usado quando Tem mensalidade é Sim.' },
      { key: 'comissaoRecorrente', header: 'Comissão sobre recorrência', kind: { type: 'bool' }, required: false, list: 'enum', example: 'Não', help: 'Sim quando a comissão também incide sobre as mensalidades.' },
      { key: 'comissionaFinder', header: 'Comissiona finder', kind: { type: 'bool' }, required: false, list: 'enum', example: 'Sim', help: 'Sim quando o produto paga comissão a quem indicou a venda.' },
      { key: 'comissaoVendedorPct', header: 'Comissão do vendedor (%)', kind: { type: 'pct' }, required: false, example: '10%', help: 'Comissão padrão do vendedor em percentual; preencha esta coluna ou a de valor fixo, não as duas.' },
      { key: 'comissaoVendedorBrl', header: 'Comissão do vendedor (R$)', kind: { type: 'money' }, required: false, example: null, help: 'Comissão padrão do vendedor em valor fixo; preencha esta coluna ou a de percentual, não as duas.' },
      { key: 'comissaoVendedorComFinderPct', header: 'Comissão do vendedor com finder (%)', kind: { type: 'pct' }, required: false, example: '8%', help: 'Comissão do vendedor quando há finder, em percentual; em branco vale a comissão do vendedor.' },
      { key: 'comissaoVendedorComFinderBrl', header: 'Comissão do vendedor com finder (R$)', kind: { type: 'money' }, required: false, example: null, help: 'Comissão do vendedor quando há finder, em valor fixo.' },
      { key: 'comissaoFinderPct', header: 'Comissão do finder (%)', kind: { type: 'pct' }, required: false, example: '3%', help: 'Comissão padrão do finder em percentual; preencha esta coluna ou a de valor fixo, não as duas.' },
      { key: 'comissaoFinderBrl', header: 'Comissão do finder (R$)', kind: { type: 'money' }, required: false, example: null, help: 'Comissão padrão do finder em valor fixo.' },
      { key: 'formaPagamento', header: 'Forma de pagamento padrão', kind: { type: 'enum', options: PAYMENT_METHOD_OPTIONS }, required: false, list: 'enum', example: 'Pix', help: 'Forma de pagamento sugerida nas propostas; em branco vale Pix.' },
      { key: 'entradaPct', header: 'Entrada padrão (%)', kind: { type: 'pct' }, required: false, example: null, help: 'Entrada sugerida em percentual do total; preencha esta coluna ou a de valor, não as duas.' },
      { key: 'entradaBrl', header: 'Entrada padrão (R$)', kind: { type: 'money' }, required: false, example: null, help: 'Entrada sugerida em valor fixo; preencha esta coluna ou a de percentual, não as duas.' },
      { key: 'parcelas', header: 'Parcelas padrão', kind: { type: 'int', min: 1, max: 120 }, required: false, example: 3, help: 'Número de parcelas do restante, de 1 a 120; em branco vale 1.' },
      { key: 'ciclosRecorrencia', header: 'Ciclos de recorrência', kind: { type: 'int', min: 1, max: 120 }, required: false, example: 12, help: 'Número de mensalidades, de 1 a 120; em branco a recorrência é por prazo indeterminado.' },
    ],
  },
  {
    key: 'custosProduto',
    tab: 'Custos por produto',
    maxRows: 2000,
    columns: [
      { key: 'produto', header: 'Produto', kind: { type: 'text', max: 140 }, required: true, list: 'produtos', example: 'Sistema de gestão', help: 'Produto que recebe o custo padrão, já cadastrado ou criado na aba Produtos.' },
      { key: 'funcao', header: 'Função', kind: { type: 'text', max: 120 }, required: true, list: 'funcoes', example: 'Desenvolvedor', help: 'Função que recebe o custo; Vendedor e Finder não entram aqui porque já têm comissão.' },
      { key: 'custoPct', header: 'Custo (%)', kind: { type: 'pct' }, required: false, example: '20%', help: 'Custo padrão em percentual do item; preencha esta coluna ou a de valor, não as duas.' },
      { key: 'custoBrl', header: 'Custo (R$)', kind: { type: 'money' }, required: false, example: null, help: 'Custo padrão em valor fixo; preencha esta coluna ou a de percentual, não as duas.' },
    ],
  },
  {
    key: 'pessoas',
    tab: 'Pessoas',
    maxRows: 2000,
    columns: [
      { key: 'nome', header: 'Nome', kind: { type: 'text', max: 120 }, required: true, example: 'Ana Souza', help: 'Nome da pessoa como aparece nas propostas.' },
      { key: 'email', header: 'E-mail', kind: { type: 'text', max: 254 }, required: false, example: 'ana@exemplo.com.br', help: 'E-mail de contato da pessoa.' },
      { key: 'funcoes', header: 'Funções', kind: { type: 'list', max: 20 }, required: true, list: 'funcoes', freeText: true, example: 'Vendedor; Desenvolvedor', help: 'Funções da pessoa separadas por ponto e vírgula, por exemplo Vendedor; Finder.' },
    ],
  },
  {
    key: 'clientes',
    tab: 'Clientes',
    maxRows: 5000,
    columns: [
      { key: 'nome', header: 'Nome', kind: { type: 'text', max: 160 }, required: true, example: 'Padaria Pão Quente', help: 'Nome do cliente como aparece nas propostas.' },
      { key: 'contato', header: 'Contato', kind: { type: 'text', max: 200 }, required: false, example: 'Marcos Pereira, (11) 98888-7777', help: 'Pessoa de contato, telefone ou e-mail.' },
      { key: 'razaoSocial', header: 'Razão social', kind: { type: 'text', max: 200 }, required: false, example: 'Padaria Pão Quente Ltda.', help: 'Razão social do cliente.' },
      { key: 'documento', header: 'CNPJ/CPF', kind: { type: 'text', max: 32 }, required: false, example: '12.345.678/0001-90', help: 'CNPJ ou CPF do cliente, digitado como texto.' },
      { key: 'endereco', header: 'Endereço', kind: { type: 'text', max: 400 }, required: false, example: 'Rua das Flores, 100, São Paulo - SP', help: 'Endereço completo do cliente.' },
      { key: 'representante', header: 'Representante legal', kind: { type: 'text', max: 200 }, required: false, example: 'Marcos Pereira', help: 'Nome do representante legal.' },
      { key: 'documentoRepresentante', header: 'CPF do representante', kind: { type: 'text', max: 32 }, required: false, example: '123.456.789-00', help: 'CPF do representante legal, digitado como texto.' },
    ],
  },
  {
    key: 'etapas',
    tab: 'Etapas',
    maxRows: 50,
    columns: [
      { key: 'nome', header: 'Nome', kind: { type: 'text', max: 120 }, required: true, example: 'Diagnóstico', help: 'Nome de uma nova etapa do funil de leads, criada depois das etapas existentes.' },
    ],
  },
  {
    key: 'leads',
    tab: 'Leads',
    maxRows: 5000,
    columns: [
      { key: 'contato', header: 'Contato', kind: { type: 'text', max: 140 }, required: true, example: 'Carlos Lima', help: 'Nome da pessoa de contato do lead.' },
      { key: 'empresa', header: 'Empresa', kind: { type: 'text', max: 200 }, required: true, list: 'clientes', freeText: true, example: 'Padaria Pão Quente', help: 'Nome da empresa; quando é um cliente cadastrado, o lead fica ligado a ele.' },
      { key: 'valorEstimado', header: 'Valor estimado (R$)', kind: { type: 'money' }, required: false, example: 'R$ 12.000,00', help: 'Valor estimado do negócio.' },
      { key: 'descricao', header: 'Descrição', kind: { type: 'text', max: 4000 }, required: false, example: 'Quer trocar o sistema de caixa.', help: 'Observações sobre o lead.' },
      { key: 'vendedor', header: 'Vendedor', kind: { type: 'text', max: 120 }, required: false, list: 'vendedores', example: 'Ana Souza', help: 'Pessoa com a função Vendedor responsável pelo lead; em branco o lead fica sem vendedor.' },
      { key: 'produtos', header: 'Produtos', kind: { type: 'list', max: 50 }, required: false, list: 'produtos', freeText: true, example: 'Sistema de gestão', help: 'Produtos de interesse separados por ponto e vírgula; nomes fora do cadastro ficam como texto.' },
      { key: 'etapa', header: 'Etapa', kind: { type: 'text', max: 120 }, required: false, list: 'etapas', example: 'Diagnóstico', help: 'Etapa do funil; em branco o lead entra na primeira etapa, e a etapa de conversão não é aceita.' },
      { key: 'motivoPerda', header: 'Motivo da perda', kind: { type: 'text', max: 500 }, required: false, example: null, help: 'Obrigatório quando a etapa é a de leads perdidos.' },
    ],
  },
  {
    key: 'propostas',
    tab: 'Propostas',
    maxRows: 2000,
    columns: [
      { key: 'ref', header: 'Ref', kind: { type: 'text', max: 40 }, required: true, example: 'P1', help: 'Identificador que você escolhe para a proposta; as abas de itens, profissionais, parcelas e pagamentos usam o mesmo Ref.' },
      { key: 'cliente', header: 'Cliente', kind: { type: 'text', max: 160 }, required: true, list: 'clientes', example: 'Padaria Pão Quente', help: 'Cliente da proposta, já cadastrado ou criado na aba Clientes.' },
      { key: 'vendedor', header: 'Vendedor', kind: { type: 'text', max: 120 }, required: true, list: 'vendedores', example: 'Ana Souza', help: 'Pessoa com a função Vendedor.' },
      { key: 'finder', header: 'Finder', kind: { type: 'text', max: 120 }, required: false, list: 'finders', example: null, help: 'Pessoa com a função Finder que indicou a venda, se houver.' },
      { key: 'situacao', header: 'Situação', kind: { type: 'enum', options: SALE_STATUS_OPTIONS }, required: false, list: 'enum', example: 'Ganha', help: 'Rascunho, Aberta, Ganha, Perdida ou Cancelada; em branco vale Aberta.' },
      { key: 'dataBase', header: 'Data base', kind: { type: 'day' }, required: true, example: '15/01/2026', help: 'Data de referência da proposta, no formato dd/mm/aaaa.' },
      { key: 'dataGanho', header: 'Data de ganho', kind: { type: 'day' }, required: false, example: '20/01/2026', help: 'Dia em que a proposta foi ganha; obrigatória quando a situação é Ganha e nunca no futuro.' },
      { key: 'produto', header: 'Produto', kind: { type: 'text', max: 140 }, required: false, list: 'produtos', example: null, help: 'Produto de uma proposta simples; deixe em branco quando a proposta usa a aba Itens da proposta.' },
      { key: 'quantidade', header: 'Quantidade', kind: { type: 'int', min: 1, max: 100000 }, required: false, example: null, help: 'Quantidade do produto da proposta simples; em branco vale 1.' },
      { key: 'valorUnitario', header: 'Valor unitário (R$)', kind: { type: 'money' }, required: false, example: null, help: 'Valor negociado do produto da proposta simples; em branco usa o valor do cadastro.' },
      { key: 'formaPagamento', header: 'Forma de pagamento', kind: { type: 'enum', options: PAYMENT_METHOD_OPTIONS }, required: false, list: 'enum', example: 'Pix', help: 'Forma de pagamento das parcelas geradas; em branco usa o padrão do produto.' },
      { key: 'entradaBrl', header: 'Entrada (R$)', kind: { type: 'money' }, required: false, example: null, help: 'Valor de entrada quando as parcelas são geradas; deixe em branco ao usar a aba Parcelas.' },
      { key: 'numeroParcelas', header: 'Número de parcelas', kind: { type: 'int', min: 1, max: 120 }, required: false, example: null, help: 'Número de parcelas geradas para o restante; deixe em branco ao usar a aba Parcelas.' },
      { key: 'mensalidade', header: 'Mensalidade (R$)', kind: { type: 'money' }, required: false, example: 'R$ 300,00', help: 'Valor da recorrência mensal; em branco usa o padrão do produto e zero significa sem recorrência.' },
      { key: 'inicioRecorrencia', header: 'Início da recorrência', kind: { type: 'day' }, required: false, example: '20/02/2026', help: 'Primeiro vencimento da recorrência; em branco é um mês depois da data base.' },
      { key: 'ciclosRecorrencia', header: 'Ciclos da recorrência', kind: { type: 'int', min: 1, max: 120 }, required: false, example: 12, help: 'Número de mensalidades; em branco usa o padrão do produto ou prazo indeterminado.' },
      { key: 'comissaoVendedorPct', header: 'Comissão do vendedor (%)', kind: { type: 'pct' }, required: false, example: null, help: 'Comissão do vendedor nesta proposta; em branco usa o padrão do produto ou da configuração.' },
      { key: 'comissaoFinderPct', header: 'Comissão do finder (%)', kind: { type: 'pct' }, required: false, example: null, help: 'Comissão do finder nesta proposta; em branco usa o padrão do produto ou da configuração.' },
      { key: 'impostoPct', header: 'Imposto (%)', kind: { type: 'pct' }, required: false, example: null, help: 'Imposto sobre a proposta; em branco usa o padrão da configuração.' },
      { key: 'outrosCustos', header: 'Outros custos (R$)', kind: { type: 'money' }, required: false, example: null, help: 'Outros custos da proposta, pagos de uma vez.' },
      { key: 'observacoes', header: 'Observações', kind: { type: 'text', max: 2000 }, required: false, example: 'Migrada da planilha antiga.', help: 'Anotações livres sobre a proposta.' },
    ],
  },
  {
    key: 'itens',
    tab: 'Itens da proposta',
    maxRows: 5000,
    columns: [
      { key: 'ref', header: 'Ref', kind: { type: 'text', max: 40 }, required: true, example: 'P1', help: 'Ref da proposta na aba Propostas.' },
      { key: 'produto', header: 'Produto', kind: { type: 'text', max: 140 }, required: false, list: 'produtos', example: 'Sistema de gestão', help: 'Produto do item; deixe em branco para um item avulso.' },
      { key: 'descricao', header: 'Descrição', kind: { type: 'text', max: 140 }, required: false, example: null, help: 'Nome do item avulso, obrigatório quando Produto está em branco.' },
      { key: 'area', header: 'Área', kind: { type: 'text', max: 120 }, required: false, list: 'areas', example: null, help: 'Área do item avulso, obrigatória quando Produto está em branco.' },
      { key: 'quantidade', header: 'Quantidade', kind: { type: 'int', min: 1, max: 100000 }, required: false, example: 1, help: 'Quantidade do item; em branco vale 1.' },
      { key: 'valorUnitario', header: 'Valor unitário (R$)', kind: { type: 'money' }, required: false, example: 'R$ 5.000,00', help: 'Valor negociado por unidade; em branco usa o valor do cadastro do produto.' },
    ],
  },
  {
    key: 'profissionais',
    tab: 'Profissionais da proposta',
    maxRows: 5000,
    columns: [
      { key: 'ref', header: 'Ref', kind: { type: 'text', max: 40 }, required: true, example: 'P1', help: 'Ref da proposta na aba Propostas.' },
      { key: 'funcao', header: 'Função', kind: { type: 'text', max: 120 }, required: true, list: 'funcoes', example: 'Desenvolvedor', help: 'Função do profissional no projeto.' },
      { key: 'pessoa', header: 'Pessoa', kind: { type: 'text', max: 120 }, required: true, list: 'pessoas', example: 'Ana Souza', help: 'Pessoa que exerce a função; ela recebe a função se ainda não a tiver.' },
      { key: 'custo', header: 'Custo (R$)', kind: { type: 'money' }, required: false, example: 'R$ 1.000,00', help: 'Custo alocado ao profissional; em branco usa o custo padrão do produto para a função.' },
      { key: 'divisaoCusto', header: 'Divisão do custo (%)', kind: { type: 'text', max: 1000 }, required: false, example: null, help: 'Percentuais do custo por parcela separados por ponto e vírgula e somando 100, por exemplo 50; 50; em branco divide proporcionalmente.' },
    ],
  },
  {
    key: 'parcelas',
    tab: 'Parcelas',
    maxRows: 5000,
    columns: [
      { key: 'ref', header: 'Ref', kind: { type: 'text', max: 40 }, required: true, example: 'P1', help: 'Ref da proposta na aba Propostas.' },
      { key: 'vencimento', header: 'Vencimento', kind: { type: 'day' }, required: true, example: '20/01/2026', help: 'Data de vencimento da parcela, no formato dd/mm/aaaa.' },
      { key: 'valor', header: 'Valor (R$)', kind: { type: 'money' }, required: true, example: 'R$ 5.000,00', help: 'Valor da parcela; a soma das parcelas deve ser igual ao total dos itens.' },
      { key: 'formaPagamento', header: 'Forma de pagamento', kind: { type: 'enum', options: PAYMENT_METHOD_OPTIONS }, required: false, list: 'enum', example: 'Pix', help: 'Forma de pagamento da parcela; em branco usa a da proposta.' },
    ],
  },
  {
    key: 'pagamentos',
    tab: 'Pagamentos',
    maxRows: 5000,
    columns: [
      { key: 'ref', header: 'Ref', kind: { type: 'text', max: 40 }, required: true, example: 'P1', help: 'Ref de uma proposta Ganha na aba Propostas.' },
      { key: 'parcela', header: 'Parcela', kind: { type: 'text', max: 20 }, required: true, example: '1/1', help: 'Rótulo da parcela paga, como 1/3 para parcelas ou M2/12 para mensalidades; formate a coluna como texto.' },
      { key: 'dataPagamento', header: 'Data do pagamento', kind: { type: 'day' }, required: true, example: '20/01/2026', help: 'Dia em que a parcela foi paga, nunca no futuro.' },
      { key: 'repassesPagos', header: 'Repasses pagos', kind: { type: 'bool' }, required: false, list: 'enum', example: 'Sim', help: 'Sim para dar baixa também nas comissões e custos ligados a esta parcela no mesmo dia.' },
    ],
  },
] as const satisfies readonly SheetDef[];

/** Column key union of one sheet, derived from WORKBOOK_SHEETS (compile-time typo guard for planners). */
export type ColumnKey<K extends SheetKey> = Extract<
  (typeof WORKBOOK_SHEETS)[number],
  { key: K }
>['columns'][number]['key'];

export function getSheetDef(key: SheetKey): SheetDef {
  const def: SheetDef | undefined = WORKBOOK_SHEETS.find((s) => s.key === key);
  if (!def) throw new Error(`unknown sheet ${String(key)}`);
  return def;
}

export function getColumnDef(sheet: SheetKey, key: string): ColumnDef {
  const col = getSheetDef(sheet).columns.find((c) => c.key === key);
  if (!col) throw new Error(`unknown column ${sheet}.${key}`);
  return col;
}
