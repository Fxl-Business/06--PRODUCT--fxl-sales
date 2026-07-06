import type { Metadata } from 'next';
import { getT } from '@/i18n';
import { LegalLayout } from '@/components/LegalLayout';

export function generateMetadata(): Metadata {
  const t = getT();
  return {
    title: `${t.legal.terms.title} — ${t.app.name}`,
    description: t.legal.terms.title,
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

export default function TermsPage() {
  const t = getT();
  return (
    <LegalLayout title={t.legal.terms.title} lastUpdated={t.legal.terms.lastUpdated}>
      <Section title="1. Objeto">
        <p>
          Estes Termos regem o uso da plataforma FXL Sales, um programa de afiliados B2B que
          permite a indicadores (Finders) divulgar as soluções FXL e receber comissões pelas vendas
          decorrentes de suas indicações.
        </p>
      </Section>

      <Section title="2. Cadastro e aprovação">
        <p>
          O cadastro é público e gratuito. Toda solicitação passa por aprovação manual da equipe
          FXL. A FXL reserva-se o direito de aprovar ou recusar qualquer cadastro a seu critério.
        </p>
      </Section>

      <Section title="3. Obrigações do Finder">
        <ul className="list-disc pl-6">
          <li>Fornecer informações verdadeiras, completas e atualizadas</li>
          <li>Não realizar auto-indicação (self-referral)</li>
          <li>Cumprir a legislação aplicável e estes Termos</li>
        </ul>
      </Section>

      <Section title="4. Comissões">
        <p>
          As comissões seguem as regras de comissão vigentes para cada produto, disponíveis no
          painel do Finder. O pagamento é feito via PIX após o período de garantia (hold) aplicável.
        </p>
      </Section>

      <Section title="5. Vedações">
        <p>São expressamente vedados:</p>
        <ul className="list-disc pl-6">
          <li>Fraude de qualquer natureza</li>
          <li>Spam e práticas de divulgação abusivas</li>
          <li>Representações enganosas sobre os produtos FXL</li>
        </ul>
      </Section>

      <Section title="6. Suspensão e cancelamento">
        <p>
          A FXL pode suspender ou cancelar o acesso de qualquer Finder que viole estes Termos, sem
          prejuízo das comissões legitimamente já apuradas.
        </p>
      </Section>

      <Section title="7. Propriedade intelectual">
        <p>
          Todos os direitos sobre a plataforma, marca e materiais FXL Sales pertencem à FXL. Nada
          nestes Termos transfere tais direitos ao Finder.
        </p>
      </Section>

      <Section title="8. Lei aplicável">
        <p>
          Estes Termos são regidos pela legislação brasileira. Fica eleito o foro da Comarca de São
          Paulo/SP para dirimir quaisquer controvérsias.
        </p>
      </Section>
    </LegalLayout>
  );
}
