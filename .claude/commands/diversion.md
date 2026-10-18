---
description: Tonnes by customer and month, and the share kept out of landfill. The figure customers ask for in their own sustainability reports.
---

1. Run `node scripts/waste.mjs diversion [CUSTOMER] [--month=YYYY-MM] --json`.
2. Present per customer, lowest diversion first. Say plainly where it comes from: the tip dockets, with front lift runs shared across their lifts by bins lifted.
3. For the customer's own copy: `npm run docs -- waste-report` writes a branded report per account customer.
