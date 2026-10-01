import { useState } from 'react';
import { initials } from './calculations';

/**
 * The account's face, shared by every account surface: the sales ops shell's account
 * menu, `MissingEntitlementPanel` and `NoRolePage`. The Hub avatar when the token
 * carries one, the initials otherwise. Display-only and decorative: the name beside it
 * is the accessible text, so `alt` is empty. A URL that fails to load falls back to the
 * initials instead of leaving a broken image, and the fallback is keyed on the URL so a
 * later token with a new avatar gets a fresh attempt.
 *
 * It imports only `initials` from `./calculations` and none of the surfaces that render
 * it, so any of them can import it without a cycle. What to show when the account has
 * neither a name nor an email stays each caller's decision.
 */
export function AccountAvatar({ avatarUrl, name }: { avatarUrl?: string; name: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = Boolean(avatarUrl) && failedUrl !== avatarUrl;

  return (
    <span
      className="sales-ops-num flex size-10 flex-none items-center justify-center overflow-hidden rounded-[11px] bg-[#eaa81a] text-[14px] font-bold text-[#18181b]"
      data-account-avatar
    >
      {showImage ? (
        <img
          alt=""
          className="size-full object-cover"
          onError={() => setFailedUrl(avatarUrl ?? null)}
          referrerPolicy="no-referrer"
          src={avatarUrl}
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}
