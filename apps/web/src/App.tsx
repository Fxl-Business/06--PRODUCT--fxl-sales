import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { AppAuthProvider } from './auth/react';
import { router } from './router';
import './i18n';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      retry: 1,
    },
  },
});

/**
 * `QueryClientProvider` is OUTSIDE `AppAuthProvider`, and that nesting is load-bearing
 * rather than incidental: the auth provider reads this client with `useQueryClient()`
 * so it can flush the exact client its own subtree reads on logout, on an in-page
 * signed-out to signed-in transition and on every workspace switch. Importing the
 * singleton into `auth/react.tsx` instead would be a module cycle, and passing it as a
 * prop would create a second declaration of which client is in play.
 *
 * Pinned by `App.tsx mounts QueryClientProvider outside AppAuthProvider` in
 * `src/__tests__/route-error-and-auth-context.test.tsx`.
 */
export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppAuthProvider>
        <RouterProvider router={router} />
      </AppAuthProvider>
    </QueryClientProvider>
  );
}
