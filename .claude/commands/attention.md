---
description: Everything that wants a decision this morning, worst first. Reportable priority waste moving without its paper outranks everything, then the road, credit holds and drivers, then bins out too long, missed lifts and missing dockets, then money leaking and billing.
---

1. Run `node scripts/waste.mjs attention --json`.
2. Present it worst first, grouped by reason, in the operator's words. Lead with anything rank 1 or 2 (asbestos with no Waste Tracker record, a skip on the road past its permit, a booking for a customer on hold): those are today's first calls, say so plainly.
3. For each group, say the one action that clears it: `tracker H-... --ref=`, `collect H-... --on=today` or `permit H-... --ref= --until=`, `release` or `cancel`, `rebook L-... --on=`, `tip J-... --docket= --tonnes=`, `price-check`, `bill`, `draft overdue INV-...`, `charge J-... --amount=`.
4. Money items (PRICE UNDER TIP COST, TIP RATE UP) get one line of why from the data: which facility, which price, what it now leaves. Run `price-check --json` if you need it.
5. If the list is empty, say so in one line and stop.
