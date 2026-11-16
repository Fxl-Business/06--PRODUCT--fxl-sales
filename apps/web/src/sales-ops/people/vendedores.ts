import type { SavePersonPayload } from '../api';
import { FUNCAO_SLUG_VENDEDOR } from '../calculations';
import type { SalesOpsFuncao, SalesOpsPerson } from '../types';

/**
 * Every user-facing string of the leads-edition Vendedores screen, in one place so
 * the tests can pin them and scan them. pt-BR, no em dash, and no word that belongs
 * to the full product (finder, comissão, proposta). Função belongs to this edition
 * since vários funis: an extra função decides which funis a vendedor works in.
 */
export const VENDEDORES_COPY = {
  pageTitle: {
    title: 'Vendedores',
    subtitle: 'Vendedores da equipe que podem receber leads na prospecção',
  },
  newAction: 'Novo vendedor',
  emptyTitle: 'Nenhum vendedor cadastrado',
  emptyText:
    'Cadastre os vendedores da equipe para atribuir leads a eles. Use o mesmo e-mail com que cada vendedor entra no sistema.',
  dialogTitle: 'Vendedor',
  dialogDescription: 'Cadastre o vendedor para atribuir leads a ele.',
  nameLabel: 'Nome',
  emailLabel: 'E-mail',
  emailHelper: 'Use o mesmo e-mail com que o vendedor entra no sistema.',
  extraFuncoesLabel: 'Funções extras',
  extraFuncoesPlaceholder: 'Adicionar função',
  extraFuncoesEmpty: 'Nenhuma função extra: o vendedor trabalha no funil padrão.',
  extraFuncoesHelper:
    'Cada função ligada a um funil em Funis e etapas dá acesso a esse funil. Vendedor é sempre mantido.',
  cancel: 'Cancelar',
  save: 'Salvar',
  editLabel: (name: string) => `Editar ${name}`,
  savingLabel: (name: string) => `Salvando ${name}`,
  inactivateLabel: (name: string) => `Inativar vendedor ${name}`,
  inactivateTitle: (name: string) => `Inativar o vendedor "${name}"?`,
  inactivateBody:
    'Ele sai da lista de vendedores dos leads, mas continua nos leads que já o utilizam e pode ser reativado nesta tela. Nada é apagado.',
  inactivateAction: 'Inativar vendedor',
  inactivateBack: 'Voltar',
  inactiveBadge: 'Inativo',
  reactivateLabel: (name: string) => `Reativar vendedor ${name}`,
} as const;

/** The org's system `vendedor` função id, or null when the catalogue has none yet. */
export function vendedorFuncaoId(funcoes: readonly SalesOpsFuncao[]): string | null {
  return (
    funcoes.find((funcao) => funcao.isSystem && funcao.slug === FUNCAO_SLUG_VENDEDOR)?.id ?? null
  );
}

/**
 * A vendedor's EXTRA funções: every função the pessoa holds that is not a system one.
 * They are what the dialog edits; the system vendedor is never shown as removable.
 */
export function extraFuncaoIdsOf(person: SalesOpsPerson | null): string[] {
  return (person?.funcoes ?? []).filter((funcao) => !funcao.isSystem).map((funcao) => funcao.id);
}

/**
 * The leads-edition person write. The server always keeps the system vendedor in this
 * edition (seeding the system funções when the org has none) and accepts the EXTRA
 * active, non-system funções after it. The vendedor id is still sent when the catalogue
 * knows it, so the optimistic row already carries the vendedor badge data the lead
 * board's seller picker filters on; with an empty catalogue only the extras are sent
 * and the server adds vendedor. Never an id the catalogue does not hold.
 */
export function buildVendedorPayload(input: {
  person: SalesOpsPerson | null;
  displayName: string;
  contactEmail: string;
  funcoes: readonly SalesOpsFuncao[];
  extraFuncaoIds?: readonly string[];
}): SavePersonPayload {
  const vendedorId = vendedorFuncaoId(input.funcoes);
  const extras = (input.extraFuncaoIds ?? []).filter((id) => id !== vendedorId);
  return {
    id: input.person?.id,
    displayName: input.displayName.trim(),
    contactEmail: input.contactEmail.trim() || undefined,
    // The stored status, never a value this dialog owns, exactly like PersonDialog.
    status: input.person?.status ?? 'active',
    funcaoIds: vendedorId ? [vendedorId, ...extras] : [...extras],
  };
}
