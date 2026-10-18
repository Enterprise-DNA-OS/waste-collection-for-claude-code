---
description: Every hire price against today's tip rates: what it leaves after tipping the tonnes it includes, and the price that puts it back on target.
---

1. Run `node scripts/waste.mjs price-check --json` (`--all` for every price).
2. For each price under target: the customer, the bin, today's tip cost for the included tonnes, what is left, and the price for target.
3. Offer the repricing (`price set ...`) and the letter (`draft price "CUSTOMER"`, drafts only). Bookings already made keep their price.
