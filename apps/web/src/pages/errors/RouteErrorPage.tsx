import { useRouteError } from 'react-router-dom';
import { Button } from '@/components/ui/button';

/**
 * errorElement for every top-level route. Replaces React Router's default
 * "Unexpected Application Error!" page with a recoverable screen.
 */
export function RouteErrorPage() {
  const error = useRouteError();
  const message = error instanceof Error ? error.message : '';
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">Algo deu errado</h1>
      <p className="max-w-md text-muted-foreground">
        Ocorreu um erro inesperado ao carregar esta página. Recarregue para tentar novamente.
      </p>
      {message ? (
        <p className="max-w-md font-mono text-xs text-muted-foreground">{message}</p>
      ) : null}
      <Button variant="outline" onClick={() => window.location.reload()}>
        Recarregar
      </Button>
    </div>
  );
}
