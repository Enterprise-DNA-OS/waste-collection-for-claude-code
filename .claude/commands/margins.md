---
description: What each customer and each load leaves after tip fees, from the dockets. The number the incumbent's revenue report never shows.
---

1. Run `node scripts/waste.mjs margins --json` (add `--days=`).
2. Present by customer, thinnest margin first, then the five thinnest skip and hook loads.
3. Explain each thin one from the data: a price set before a tip rate rise (`price-check`), heavy loads (excess per tonne set too low), or a lift price that never moved.
4. End with the one or two prices worth changing and the command: `price set "CUSTOMER" --bin= --stream= --hire=`.
