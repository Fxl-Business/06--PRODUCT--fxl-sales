import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourcePath = fileURLToPath(new URL('../SalesOpsApp.tsx', import.meta.url));
const source = readFileSync(sourcePath, 'utf8');

describe('sale wizard UI contract', () => {
  it('keeps the sale closing dialog aligned with the reference wizard shell', () => {
    expect(source).toContain('Cliente, itens e pagamento - só o primeiro passo é obrigatório');
    expect(source).toContain('Registro da venda');
    expect(source).toContain('Custos e margem');
    expect(source).toContain('Revisão');
    expect(source).toContain('Essa venda teve um finder');
    expect(source).toContain('Cadastrar produto');
    expect(source).toContain('Passo {wizardStep} de 3');
    expect(source).toContain('Avançar');
    expect(source).not.toContain('Salvar venda');
  });
});
