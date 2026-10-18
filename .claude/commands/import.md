---
description: Bring the business across from AMCS Wastedge (or any system whose customer, site, service and bin lists download as CSV), test run first.
---

1. Read `docs/replace-wastedge.md` for what to export, what maps and what starts fresh.
2. Look at the headers of each file first. The importer matches common column names; if a file uses others, rename the header row in a copy (never the operator's original) and say what you renamed.
3. Test run: `node scripts/waste.mjs import wastedge --customers=customers.csv --sites=sites.csv --services=services.csv --bins=bins.csv --dry-run --json`. Read every skipped row out loud: each one is a question about the old data.
4. Run it for real, then again: the second pass must create nothing new.
5. Then: bins out on hire today are booked with `book` and marked delivered with the right bin; tip rates and prices are entered from the facility notices and the price list; `attention`.
