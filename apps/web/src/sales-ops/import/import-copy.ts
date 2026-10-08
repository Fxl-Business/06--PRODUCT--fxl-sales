import { isAuthFailure, isForbiddenFailure } from '@/lib/require-token';
import { MUTATION_ERROR_COPY } from '../mutation-error-copy';

export const IMPORT_COPY = {
  intro:
    'Use os modelos para trazer cadastros, leads e propostas de uma vez. A importação só cria registros novos: nada existente é alterado.',
  step1Title: '1. Baixe o modelo',
  step1Text:
    'O modelo em branco já traz as listas com os cadastros atuais da organização. O modelo com exemplo mostra uma linha preenchida em cada aba.',
  downloadBlank: 'Baixar modelo em branco',
  downloadExample: 'Baixar modelo com exemplo',
  step2Title: '2. Envie a planilha preenchida',
  step2Text: 'Apenas arquivos .xlsx de até 5 MB. Abas vazias são ignoradas.',
  chooseFile: 'Escolher arquivo',
  noFile: 'Nenhum arquivo escolhido',
  validate: 'Validar planilha',
  validating: 'Validando...',
  step3Title: '3. Confira e importe',
  countsSheet: 'Aba',
  countsToCreate: 'Registros a criar',
  countsCreated: 'Registros criados',
  nothingToImport: 'A planilha não tem linhas para importar.',
  nothingNew: 'Nenhum registro novo para criar.',
  recognizedClients: (n: number) =>
    n === 1
      ? '1 cliente da aba Clientes já está no cadastro (mesmo CNPJ/CPF ou mesmo nome) e não será criado de novo nem alterado; as outras abas usam o cliente existente.'
      : `${n} clientes da aba Clientes já estão no cadastro (mesmo CNPJ/CPF ou mesmo nome) e não serão criados de novo nem alterados; as outras abas usam os clientes existentes.`,
  recognizedClientsDone: (n: number) =>
    n === 1
      ? '1 cliente da aba Clientes já estava no cadastro e foi reaproveitado, sem alteração.'
      : `${n} clientes da aba Clientes já estavam no cadastro e foram reaproveitados, sem alteração.`,
  errorsTitle: (n: number) => (n === 1 ? '1 erro' : `${n} erros`),
  warningsTitle: (n: number) => (n === 1 ? '1 aviso' : `${n} avisos`),
  errorsBlock:
    'Corrija os erros na planilha e valide novamente. Enquanto houver erros, nada pode ser importado.',
  truncated:
    'A lista mostra os primeiros 500 problemas. Corrija estes e valide novamente para ver os demais.',
  readyOk: 'Nenhum erro encontrado. Os avisos acima não impedem a importação.',
  readyClean: 'Nenhum erro encontrado.',
  allOrNothing:
    'A importação é tudo ou nada: se qualquer linha for recusada na gravação, nada é criado. Ela só cria registros novos e nunca altera cadastros existentes.',
  import: 'Importar',
  importing: 'Importando...',
  confirmTitle: 'Importar planilha?',
  confirmText: (total: number) =>
    `Serão criados ${total} registros nesta organização, de uma vez. Se qualquer linha for recusada, nada é criado. Registros existentes nunca são alterados.`,
  confirmCancel: 'Voltar',
  confirmAction: 'Importar',
  successTitle: 'Importação concluída',
  successText: 'Os registros abaixo foram criados e já aparecem nas outras telas.',
  another: 'Importar outra planilha',
  tooLargeLocal: 'O arquivo passa do limite de 5 MB. Divida a planilha em partes menores.',
  notXlsxLocal: 'Escolha um arquivo .xlsx.',
} as const;

/**
 * Classification keys on the HTTP status only, never on the body `code` or `reason`.
 * The 409 branch additionally shows the server's row message when present.
 */
export function importErrorMessage(error: unknown): string {
  if (isForbiddenFailure(error)) return MUTATION_ERROR_COPY.adminRequired;
  if (isAuthFailure(error)) {
    return 'Sua sessão do FXL Hub expirou ou não pôde ser renovada. Atualize a página para entrar novamente.';
  }
  const status =
    typeof error === 'object' && error !== null ? (error as { status?: unknown }).status : null;
  if (status === 400) {
    return 'O arquivo não é uma planilha .xlsx válida. Baixe o modelo e tente novamente.';
  }
  if (status === 413) return IMPORT_COPY.tooLargeLocal;
  if (status === 409) {
    const body = (error as { body?: unknown }).body;
    const detail =
      typeof body === 'object' &&
      body !== null &&
      typeof (body as { message?: unknown }).message === 'string'
        ? (body as { message: string }).message.trim()
        : '';
    if (detail) {
      const sentence = /[.!?]$/.test(detail) ? detail : `${detail}.`;
      return `Nada foi importado: ${sentence} Valide a planilha novamente e tente outra vez.`;
    }
    return 'Nada foi importado: um registro foi recusado durante a gravação. Valide a planilha novamente e tente outra vez.';
  }
  if (status === 422) {
    return 'Nada foi importado: a planilha ou os cadastros da organização mudaram desde a validação. Corrija os erros abaixo e valide novamente.';
  }
  return MUTATION_ERROR_COPY.generic;
}
