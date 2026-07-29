import {
  useMutation,
  useQueryClient,
  type QueryKey,
  type UseMutationOptions,
  type UseMutationResult,
} from '@tanstack/react-query';

/**
 * The one door for write operations in apps/web. `useMutation` is imported here
 * and nowhere else - eslint.config.js bans the direct import everywhere else so a
 * new mutation cannot ship without declaring the cache it refreshes.
 */

/**
 * Sentinel for mutations that change nothing the query cache holds - blob
 * downloads and read-only server verifications. Anything that writes a row
 * MUST list the keys it owns instead.
 */
export const NO_CACHE_EFFECT = Symbol('no-cache-effect');

/** Non-empty on purpose: `invalidates: []` must not type-check. */
type NonEmptyKeys = readonly [QueryKey, ...QueryKey[]];

export type InvalidateSpec<TData, TVariables> =
  | NonEmptyKeys
  | ((context: { variables: TVariables; data: TData | undefined }) => readonly QueryKey[])
  | typeof NO_CACHE_EFFECT;

export type AppMutationOptions<TData, TError, TVariables, TOnMutateResult> = UseMutationOptions<
  TData,
  TError,
  TVariables,
  TOnMutateResult
> & {
  /**
   * Query keys this mutation owns. Every listed key is invalidated by prefix
   * match after the mutation settles - on success AND on failure, so a rolled
   * back optimistic write always re-syncs with the server.
   */
  invalidates: InvalidateSpec<TData, TVariables>;
};

export function useAppMutation<
  TData = unknown,
  TError = Error,
  TVariables = void,
  TOnMutateResult = unknown,
>(
  options: AppMutationOptions<TData, TError, TVariables, TOnMutateResult>,
): UseMutationResult<TData, TError, TVariables, TOnMutateResult> {
  const queryClient = useQueryClient();
  const { invalidates, onSettled, ...rest } = options;
  return useMutation<TData, TError, TVariables, TOnMutateResult>({
    ...rest,
    onSettled: (data, error, variables, onMutateResult, context) => {
      if (invalidates !== NO_CACHE_EFFECT) {
        const keys =
          typeof invalidates === 'function' ? invalidates({ variables, data }) : invalidates;
        for (const queryKey of keys) {
          void queryClient.invalidateQueries({ queryKey });
        }
      }
      return onSettled?.(data, error, variables, onMutateResult, context);
    },
  });
}
