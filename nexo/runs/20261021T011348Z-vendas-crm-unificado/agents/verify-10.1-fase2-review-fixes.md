# Verify 10.1-fase2-review-fixes: PASS
- Oracle crm-pipeline-history: 22/22. API integration (serial): 59 files, 531/531. Web leads: 51 files, 512/512. api+web lint 0, type-check 0.
- Mutation probes (in place, restored via git checkout, status clean): each of R1-01..R1-05 reverted alone turned exactly its new test red.
- Scope: R1-04 adds `or(leadSellerCondition, ownerPersonId = caller pessoa)`; test asserts third seller 404. Tenant/org filters unchanged. Admin path untouched.
- Minor: neither CLAUDE.md nor nexo/knowledge/reference/kanban-de-leads.md state the two new rules (restore gives a disconnected stage its edges; follow-up owner may complete it).
- No em dash in diff.
