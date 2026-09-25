import { X } from 'lucide-react';
import { MUTATION_ERROR_COPY, salesOpsMutationErrorMessage } from './mutation-error-copy';

/**
 * The one page-level surface for a refused sales-ops mutation (PC23 403, or a 409
 * lock). It sits on the current screen and never replaces it: `ForbiddenPanel`
 * stays the app gate for the bootstrap read.
 */
export function MutationErrorBanner({
  error,
  lines,
  onDismiss,
}: {
  error: unknown;
  /** Detail lines under the message (the rows that blocked a write); never ids. */
  lines?: readonly string[];
  onDismiss: () => void;
}) {
  if (error === null || error === undefined) return null;
  return (
    <div
      className="mb-4 flex items-start gap-3 rounded-[10px] border border-[#f1c9c4] bg-[#fdf2f1] px-4 py-3 text-[13.5px] font-semibold text-[#c93d32]"
      data-mutation-error
      role="alert"
    >
      <div className="min-w-0 flex-1 leading-[1.4]">
        <span>{salesOpsMutationErrorMessage(error)}</span>
        {lines && lines.length > 0 ? (
          <ul className="mt-1 list-disc pl-5 font-medium" data-mutation-error-lines>
            {lines.map((line, index) => (
              <li key={`${index}-${line}`}>{line}</li>
            ))}
          </ul>
        ) : null}
      </div>
      <button
        aria-label={MUTATION_ERROR_COPY.dismiss}
        className="flex-none rounded-md p-0.5 text-[#c93d32] hover:bg-[#f8e0dd]"
        onClick={onDismiss}
        type="button"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
