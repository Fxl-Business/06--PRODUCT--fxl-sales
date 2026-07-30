import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourcePath = fileURLToPath(new URL('../SalesOpsApp.tsx', import.meta.url));
const source = readFileSync(sourcePath, 'utf8');

describe('sale wizard UI contract', () => {
  it('keeps the proposal dialog aligned with the Nova proposta wizard shell', () => {
    expect(source).toContain('Nova proposta');
    expect(source).toContain('Editar proposta');
    expect(source).toContain(
      'Cliente, itens, pagamento e custos - salve como rascunho a qualquer momento',
    );
    expect(source).toContain("label: 'Proposta'");
    expect(source).toContain("label: 'Pagamento'");
    expect(source).toContain('Custos e margem');
    expect(source).toContain('Revisão');
    expect(source).toContain('Essa proposta teve um finder');
    expect(source).toContain('Cadastrar produto');
    expect(source).toContain('+ item avulso');
    expect(source).toContain('Plano de pagamento');
    /*
      Only strings this file is the sole home of are pinned here. The declarative
      header's own labels (`Tipo de entrada`, `Parcelas restantes`, `Número de ciclos`,
      `Deixe em branco para prazo indeterminado`) are shared verbatim with the produto
      cadastro's default-plan editor further up this same file, so a substring
      assertion on them would pass even if step 2 lost them entirely. Those are pinned
      by DOM queries in `sale-wizard-payment-plan.test.tsx` instead, where they can
      actually fail.
    */
    expect(source).toContain('Parcelas a receber');
    expect(source).toContain('Plano ajustado manualmente');
    expect(source).toContain('Regerar plano');
    expect(source).toContain('Manter parcelas');
    expect(source).toContain('A soma das parcelas precisa ser igual ao total da proposta.');
    expect(source).toContain('por prazo indeterminado');
    expect(source).toContain('Previsão de contas a pagar');
    /*
      Overrides. `Alterado manualmente` and `Restaurar padrão` are the visible
      contract that a cadastro number is a default the operator may take over;
      `Custos profissionais` and `Outros custos` are the Revisão breakdown that
      replaced the single opaque `Custos + imposto` line.
    */
    expect(source).toContain('Alterado manualmente');
    expect(source).toContain('Restaurar padrão');
    expect(source).toContain('Custos profissionais');
    expect(source).toContain('Selecione a função de cada profissional alocado.');
    expect(source).not.toContain('Custos + imposto');
    // The two free-text escape hatches Profissionais alocados used to carry.
    expect(source).not.toContain('Digite manualmente');
    expect(source).not.toContain("role: 'Operacional'");
    expect(source).toContain('Passo {wizardStep} de 4');
    expect(source).toContain('Avançar');
    expect(source).toContain('Salvar proposta');
    expect(source).toContain('Salvar rascunho');
    expect(source).not.toContain('Fechamento da venda');
    expect(source).not.toContain('Nova venda');
    expect(source).not.toContain('Salvar incompleto');
    expect(source).not.toContain('Confirmar venda');
    expect(source).not.toContain('Passo {wizardStep} de 3');
    expect(source).not.toContain('Salvar venda');
    /*
      The manual plan controls the declarative builder replaced. Each of these was a
      real string in this file before the builder landed, so every negative below is
      about markup that was removed rather than markup that never existed - the
      positive assertions above are the matching control.
    */
    expect(source).not.toContain('Dividir em');
    expect(source).not.toContain('+ parcela');
    expect(source).not.toContain('Adicionar recorrência');
    expect(source).not.toContain('Número de parcelas');
    expect(source).not.toContain('Remover parcela');
    /*
      The `Prazo indeterminado` checkbox is gone, blank ciclos being the only
      expression of it, so the error copy that pointed at the checkbox is gone too.
      The checkbox's own absence from step 2 is asserted in the DOM by
      `sale-wizard-payment-plan.test.tsx`, because the green summary keeps the phrase
      `, por prazo indeterminado` and a substring negative here would fail on it.
    */
    expect(source).not.toContain('marque prazo indeterminado');
  });

  it('keeps every picker on the Combobox with no native picker markup left behind', () => {
    // Positive control: the pickers really are Comboboxes, so the negatives below are
    // about a migration that happened rather than about markup that never existed.
    expect(source).toContain("from '@/components/ui/combobox'");
    expect(source).toContain('<Combobox');

    expect(source).not.toContain('<select');
    expect(source).not.toContain('<option');
    expect(source).not.toContain('<datalist');
    // The only way to reach a datalist is an `Input list=` attribute, so ban that too.
    expect(source).not.toContain('list="');
    expect(source).not.toContain('NativeSelect');
  });
});
