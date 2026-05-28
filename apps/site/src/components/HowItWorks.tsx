import { getT } from '@/i18n';

export function HowItWorks() {
  const t = getT();

  return (
    <section id="howItWorks" className="border-b bg-muted/30">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight">{t.howItWorks.title}</h2>
        </div>
        <div className="mt-16 grid grid-cols-1 gap-12 md:grid-cols-4">
          {t.howItWorks.steps.map((step, i) => (
            <div key={step.title} className="relative">
              <span className="text-sm font-semibold text-primary">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className="mt-4 text-base font-semibold">{step.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{step.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
