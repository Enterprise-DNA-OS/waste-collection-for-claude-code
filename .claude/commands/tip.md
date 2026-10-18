---
description: Record a tip docket: facility, docket number, net tonnes. The cost comes from the facility's rate for the day, and the tonnes over what the bin includes go on the invoice.
---

1. Read the docket the operator gives you: facility, docket number, net tonnes (and the charge if it differs from the rate).
2. For a skip or hook load: `node scripts/waste.mjs tip J-... --facility=SVL --docket=NO --tonnes=2.34 --json`. For a front lift run: `tip R-... --stream=GEN --facility=SVL --docket=NO --tonnes= --json`.
3. Say back the charge, the excess tonnes and what the job now leaves after the tip.
4. Refusals are rules: a docket already recorded, a facility with no rate for the stream (`tip-rate set`), or reportable priority waste at a facility not licensed for it.
