# Frame - hide archived cadastros, and purge the unreferenced ones after 30 days

Milestone: v2.6.0
Trunk: `master` (promotion mode)
Gate 1: answered by the user in chat (two explicit choices, recorded below)

## What was asked

> The archived items should not appear anywhere then the "Histórico de arquivamentos", and also in 30
> days the items archived must be deleted.

## What was decided, and why the literal ask was not built

Both requests were put to the user with the constraints spelled out. They chose:

1. **Hidden from the lists and the pickers only** - NOT from records that already reference them.
   A proposta from March that used a produto archived in April must still render that produto's name;
   a profissional cost row pointing at an archived função must still say whose money it is. Hiding
   there would turn historical propostas into gaps and make cost rows read as money owed to nobody.
2. **Purge after 30 days only when nothing references the item.** Anything used in a proposta stays
   archived indefinitely and is reported as skipped.

The second choice is the load-bearing one, and it is grounded in the FK topology, verified live
against the database rather than assumed:

| Child reference | `confdeltype` | Effect of a hard delete |
|---|---|---|
| `sales_ops_sale_items.product_id` | `a` NO ACTION | **blocks** |
| `sales_ops_sales.seller_person_id` / `finder_person_id` | `a` NO ACTION | **blocks** |
| `sales_ops_sale_professionals.person_id` | `a` NO ACTION | **blocks** |
| `sales_ops_sale_professionals.funcao_id` | `r` RESTRICT | **blocks** |
| `sales_ops_person_funcoes.funcao_id` | `r` RESTRICT | **blocks** |
| `sales_ops_product_funcao_costs.funcao_id` | `r` RESTRICT | **blocks** |
| `sales_ops_products.area_id`, `sale_items.area_id` | `a` NO ACTION | **blocks** |
| `sales_ops_product_funcao_costs.product_id` | `c` CASCADE | deletes the produto's own default cost rows |
| `sales_ops_person_funcoes.person_id` | `c` CASCADE | deletes the pessoa's own função assignments |

So a blanket purge would have thrown an FK violation on precisely the records with history, and
cascaded child rows away on the rest. **The database is therefore the arbiter**: the job attempts the
delete and treats a `23503` foreign-key violation as "still referenced, skip". That is deliberate -
it means the rule can never drift out of sync with the schema, and no new `ON DELETE CASCADE` is
added anywhere.

The two CASCADE edges that remain are the item's OWN configuration (a produto's default cost rows, a
pessoa's função assignments), not shared history, so losing them with the item is correct.

## Slices

| Slice | Surface |
|---|---|
| 01-hide-archived-from-lists | web - archived rows leave the four cadastro lists |
| 02-purge-unreferenced-archived | api - `archived_at`, the nightly purge, the `cadastro.purged` ledger action |
| 03-history-handles-purged | web - the history renders a purge and stops offering Restaurar for a gone entity |

## Acceptance criteria

1. An archived produto, área, função or pessoa does not appear in its cadastro list, and did not
   already appear in any picker.
2. It still renders on records that reference it - a sale item's produto name, a person's função
   chip, a profissional cost row's função.
3. `Restaurar` exists only in `Histórico de arquivamentos`, because a row-level restore control in a
   list the row no longer appears in would be unreachable.
4. An archived item whose `archived_at` is older than 30 days and which nothing references is hard
   deleted by the nightly job, and the deletion appends a `cadastro.purged` ledger entry.
5. An archived item that IS referenced is never deleted, is left archived, and is counted as skipped.
6. A system função is never purged. An item archived less than 30 days ago is never purged.
7. After a purge the history still reads correctly - the entity label comes from the ledger snapshot,
   not from the row that no longer exists - and `Restaurar` is not offered for it.

## Scope limits

- No new `ON DELETE CASCADE` anywhere. The existing FK rules are the safety mechanism.
- No purge of propostas, receivables or payables. Only the four cadastros.
- No UI to trigger a purge on demand, and no way to change the 30 days from the UI.
- Cliente remains out of scope entirely - it still has no `status` column.

## Must not break

- Archived rows stay resolvable on records that already reference them (CLAUDE.md).
- `verifyChain` stays valid after purge traffic.
- Tenant isolation: the purge runs per org and never crosses one.
- The audit ledger is append-only; a purge appends, it never deletes ledger rows.
