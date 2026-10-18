---
description: Make this system yours in plain language. Add a field, rename stages, change a rule, add a column to a document. Writes the migration, applies it, updates the commands that touch it.
---

The operator will describe a change in their own words, for example "add a PO number to every hire", "we need an 8 m3 skip size", "Coastline is on 30-day terms", "put the site manager's name on the run sheet", "we are in New South Wales, check asbestos against the IWTS rule".

1. A house number (the margin target after tipping, the road permit window, the unbilled days, the expiry warning) is a setting, not a migration: `node scripts/waste.mjs settings`, then `setting set KEY VALUE`. Say the old and new value.
2. Otherwise read `CLAUDE.md`, the current schema in `supabase/migrations/`, and any command or document that touches the thing being changed. Say back in one line what you are about to change and where.
3. Write the next numbered migration in `supabase/migrations/` (never edit an applied one). Keep names plain and lowercase. Default new columns sensibly so existing rows stay valid.
4. Run `npm run migrate`. If it fails, fix the SQL and run it again.
5. Update every place the change shows up: the CLI output, the affected slash commands, `views.json`, the document templates, the import mapping, and the README command table.
6. Run `npm test`. Add an assertion for the new behaviour if the change is visible in a command's output.
7. Update `brand.json` if the change is a branding one (business name, logo, colours) instead of a schema one, and rerun `npm run docs` or `npm run view` to show it.

Report in three lines: what changed, the migration file, the commands that now show it. Never delete a column or a table without an explicit yes in this session.
