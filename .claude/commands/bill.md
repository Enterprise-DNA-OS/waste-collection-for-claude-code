---
description: Draft the invoices for work done: hires with excess tonnes, extra days and contamination, and the month's front lifts per service. Drafts only.
---

1. Test run first: `node scripts/waste.mjs bill --to=DATE --dry-run --json`.
2. Read anything held back: contamination a driver noted with no price. Price it or waive it at 0 (`charge JOB --amount=`), then run the test again.
3. Run it for real without `--dry-run`. Render them to check: `npm run docs -- invoice`.
4. Issue each one the operator approves: `invoice issue INV-...`. Sending is done from the accounts system; this sends nothing.
