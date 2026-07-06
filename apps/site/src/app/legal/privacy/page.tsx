import type { Metadata } from 'next';
import { getT } from '@/i18n';
import { LegalLayout } from '@/components/LegalLayout';

export function generateMetadata(): Metadata {
  const t = getT();
  return {
    title: `${t.legal.privacy.title} — ${t.app.name}`,
    description: t.legal.privacy.title,
  };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default function PrivacyPage() {
  const t = getT();
  return (
    <LegalLayout title={t.legal.privacy.title} lastUpdated={t.legal.privacy.lastUpdated}>
      <Section title="1. Controlador dos dados">
        <p>
          O controlador dos dados pessoais tratados nesta plataforma é a FXL (CNPJ
          00.000.000/0001-00), com sede em São Paulo/SP. Contato:{' '}
          <a href="mailto:privacy@fxl.com.br" className="underline">
            privacy@fxl.com.br
          </a>
          .
        </p>
      </Section>

      <Section title="2. Dados coletados">
        <p>Coletamos os seguintes dados pessoais quando você se cadastra como Finder:</p>
        <ul className="list-disc pl-6">
          <li>Nome completo (display name)</li>
          <li>E-mail de contato</li>
          <li>CPF</li>
          <li>Telefone</li>
          <li>Chave PIX e tipo de chave</li>
          <li>Endereço de cobrança</li>
          <li>
            Dados de telemetria de cliques (via cookies de rastreamento, ver seção 8) quando você
            compartilha seus links de indicação
          </li>
        </ul>
      </Section>

      <Section title="3. Finalidade do tratamento">
        <p>Os dados são tratados para as seguintes finalidades:</p>
        <ul className="list-disc pl-6">
          <li>Pagamento de comissões de indicação</li>
          <li>Operação e manutenção da plataforma FXL Sales</li>
          <li>Prevenção a fraudes e abusos</li>
        </ul>
      </Section>

      <Section title="4. Base legal">
        <p>
          O tratamento dos dados essenciais tem como base legal a execução de contrato (Art. 7º, V,
          da Lei nº 13.709/2018 — LGPD). O envio de comunicações de marketing tem como base o seu
          consentimento livre e específico (Art. 7º, I), que pode ser revogado a qualquer momento.
        </p>
      </Section>

      <Section title="5. Compartilhamento de dados">
        <p>
          Seus dados não são vendidos nem compartilhados com terceiros, exceto com o provedor de
          autenticação Clerk, estritamente necessário para a operação de login e identidade na
          plataforma.
        </p>
      </Section>

      <Section title="6. Retenção">
        <p>
          Os dados são mantidos durante a vigência da sua relação com a plataforma e, após o
          encerramento, por até 5 (cinco) anos para fins contábeis e legais, conforme a legislação
          aplicável.
        </p>
      </Section>

      <Section title="7. Direitos do titular">
        <p>
          Você pode, a qualquer momento, solicitar o acesso, a correção, a exclusão, a
          portabilidade dos seus dados e a revogação do consentimento. Para exercer seus direitos,
          escreva para{' '}
          <a href="mailto:privacy@fxl.com.br" className="underline">
            privacy@fxl.com.br
          </a>
          .
        </p>
      </Section>

      <Section title="8. Cookies">
        <p>
          Utilizamos um cookie de rastreamento de cliques denominado <code>fxl_ref</code>, do tipo
          HttpOnly, com vida útil de 90 dias, exclusivamente para atribuir corretamente as
          indicações aos respectivos Finders.
        </p>
      </Section>

      <Section title="9. Contato do Encarregado (DPO)">
        <p>
          Em caso de dúvidas sobre o tratamento dos seus dados, entre em contato com nosso
          Encarregado de Proteção de Dados:{' '}
          <a href="mailto:privacy@fxl.com.br" className="underline">
            privacy@fxl.com.br
          </a>
          .
        </p>
      </Section>
    </LegalLayout>
  );
}
