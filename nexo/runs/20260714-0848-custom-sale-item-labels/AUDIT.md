# Authenticated browser follow-up

Automated rendered tests passed, but browser runtime discovery returned no available browser backend during this run.
Complete the following checks with an authenticated team account at `/operacional/vendas`.

- [ ] At 1440 by 900 and 1024 by 768, enter at least two FXL Custom rows and confirm product, quantity, unit-price, subtotal, delete, label, validation, scrolling, and footer alignment with no clipping, overlap, or horizontal page scroll.
- [ ] Advance with an invalid custom row and confirm both row-local error messages render without changing valid rows, then confirm review preserves entered label order and readable wrapping without changing totals, installments, commissions, or margin.
- [ ] Save a labeled sale through the real API, wait for bootstrap invalidation, refresh `/operacional/vendas`, and confirm the primary custom label remains visible from persisted `productNameSnapshot` rather than reverting to `FXL Custom`.
