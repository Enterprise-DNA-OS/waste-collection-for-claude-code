---
description: Book a skip or hook lift hire: the customer, the site, the bin, the stream and the day. Prices come from the customer's own price list, then the list price.
---

1. Get from the operator: who, where (an existing site or a new address with suburb and council), bin size (SK4, SK6, SK10, HK15), what is going in (GEN, MIX, GRN, CON, ASB) and the delivery day. Ask whether it goes on the road.
2. Run `node scripts/waste.mjs book "CUSTOMER" --bin=SK6 --stream=GEN --on=DATE [--site=S-... | --address="..." --suburb= --council=] [--road --permit= --until=] [--declared="what they said"] --json`.
3. Say back the hire number, the price and which run it is on. Read every warning: a road skip needs its council permit before delivery; asbestos needs the customer's Waste Tracker record before collection.
4. Refused for credit hold: say why and what clears it (the overdue invoice). Do not book around it.
