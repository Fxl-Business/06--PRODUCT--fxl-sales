# Verify 08-web-lead-form-unico attempt 2: PASS

- Future birthday: max only on nascimento date input (DateRenderer via isBirthDateDefinition), validation refuses day > today, today passed in from LeadForm (todayInSaoPaulo), pure logic never reads the clock. Tests: lead-form.test.ts (future, today ok, other date field ok), lead-form.test.tsx (max attr, other field null, Salvar blocked).
- Vendedor Escape case: real Dialog, positive control included. Scratch copy without useInlineLayer in combobox: 3 Escape tests red (cliente, options, vendedor). Scratch copy with future check disabled: birthday tests red.
- Title test asserts h2 = Novo lead.
- No other behaviour change in diff (apps/web only LeadForm, LeadFormFields, lead-form.ts, tests, one doc line).
- Full web suite: 137 files, 1812/1812 pass. Lint 0. Type-check 0. Worktree status clean.
