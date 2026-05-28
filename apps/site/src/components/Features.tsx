import { BarChart3, Link2, Wallet } from 'lucide-react';
import { getT } from '@/i18n';

const icons = [Link2, BarChart3, Wallet] as const;

export function Features() {
  const t = getT();

  return (
    <section id="features" className="border-b">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight">{t.features.title}</h2>
        </div>
        <div className="mt-16 grid grid-cols-1 gap-8 md:grid-cols-3">
          {t.features.items.map((feature, i) => {
            const Icon = icons[i] ?? Link2;
            return (
              <div key={feature.title} className="rounded-lg border bg-card p-8">
                <Icon className="size-6 text-primary" />
                <h3 className="mt-6 text-lg font-semibold">{feature.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{feature.body}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
