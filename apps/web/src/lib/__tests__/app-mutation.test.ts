import { QueryClient, QueryClientProvider, type UseMutationResult } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { NO_CACHE_EFFECT, useAppMutation, type AppMutationOptions } from '../app-mutation';

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
}

/**
 * Captures the mutation object under a real QueryClientProvider with
 * renderToString, the same non-DOM hook capture idiom used by
 * src/admin/products/__tests__/useProducts.test.ts.
 */
function captureMutation<TData, TError, TVariables, TContext>(
  queryClient: QueryClient,
  options: AppMutationOptions<TData, TError, TVariables, TContext>,
): UseMutationResult<TData, TError, TVariables, TContext> {
  let mutation: UseMutationResult<TData, TError, TVariables, TContext> | undefined;

  function CaptureMutation() {
    mutation = useAppMutation<TData, TError, TVariables, TContext>(options);
    return null;
  }

  renderToString(
    createElement(QueryClientProvider, { client: queryClient }, createElement(CaptureMutation)),
  );

  if (!mutation) throw new Error('useAppMutation did not render');
  return mutation;
}

describe('useAppMutation', () => {
  it('invalidates every declared query key after a successful mutation', async () => {
    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const mutation = captureMutation<{ ok: boolean }, Error, void, unknown>(queryClient, {
      mutationFn: async () => ({ ok: true }),
      invalidates: [['a'], ['b', 'c']],
    });

    await mutation.mutateAsync();

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['a'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['b', 'c'] });
  });

  it('invalidates every declared query key after a failed mutation', async () => {
    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const mutation = captureMutation<{ ok: boolean }, Error, void, unknown>(queryClient, {
      mutationFn: async () => {
        throw new Error('network failed');
      },
      invalidates: [['a'], ['b', 'c']],
    });

    await expect(mutation.mutateAsync()).rejects.toThrow('network failed');

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['a'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['b', 'c'] });
  });

  it('resolves a function invalidates spec against the mutation variables', async () => {
    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const mutation = captureMutation<{ ok: boolean }, Error, { id: string }, unknown>(queryClient, {
      mutationFn: async () => ({ ok: true }),
      invalidates: ({ variables }) => [['x', variables.id]],
    });

    await mutation.mutateAsync({ id: 'p1' });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['x', 'p1'] });
  });

  it('runs a caller-supplied onSettled after invalidating', async () => {
    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const onSettled = vi.fn();
    const mutation = captureMutation<{ ok: boolean }, Error, { id: string }, unknown>(queryClient, {
      mutationFn: async () => ({ ok: true }),
      invalidates: [['a']],
      onSettled,
    });

    await mutation.mutateAsync({ id: 'p1' });

    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith(
      { ok: true },
      null,
      { id: 'p1' },
      undefined,
      expect.anything(),
    );
    expect(invalidateSpy.mock.invocationCallOrder[0]!).toBeLessThan(
      onSettled.mock.invocationCallOrder[0]!,
    );
  });

  it('does not invalidate anything for a NO_CACHE_EFFECT mutation', async () => {
    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const mutation = captureMutation<{ ok: boolean }, Error, void, unknown>(queryClient, {
      mutationFn: async () => ({ ok: true }),
      invalidates: NO_CACHE_EFFECT,
    });

    await mutation.mutateAsync();

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('preserves onMutate context through to onError', async () => {
    const queryClient = createQueryClient();
    const onError = vi.fn();
    const mutation = captureMutation<{ ok: boolean }, Error, void, { token: number }>(queryClient, {
      mutationFn: async () => {
        throw new Error('rollback me');
      },
      onMutate: async () => ({ token: 1 }),
      onError,
      invalidates: [['a']],
    });

    await expect(mutation.mutateAsync()).rejects.toThrow('rollback me');

    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      undefined,
      { token: 1 },
      expect.anything(),
    );
  });
});
