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
    expect(source).toContain('Dividir em');
    expect(source).toContain('A soma das parcelas precisa ser igual ao total da proposta.');
    expect(source).toContain('Adicionar recorrência');
    expect(source).toContain('Prazo indeterminado');
    expect(source).toContain('Previsão de contas a pagar');
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
  });
});
