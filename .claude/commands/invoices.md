---
description: What is invoiced, issued, overdue and paid, and the work done but not invoiced yet.
---

1. Run `node scripts/waste.mjs invoices --open --json`.
2. Lead with overdue, oldest first, then drafts waiting to be issued, then unbilled work.
3. Actions: `invoice paid INV-... --on=`, `invoice void INV-... --why=`, `draft overdue INV-...` for the reminder, `hold "CUSTOMER" --why=` when the operator decides to stop service.
