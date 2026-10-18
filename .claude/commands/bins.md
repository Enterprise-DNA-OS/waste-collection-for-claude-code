---
description: Every bin that is out: how long, how far past what the hire covers, whether it is on the road and until when, and whether a collection is booked. Also the yard by bin type.
---

1. Run `node scripts/waste.mjs bins --json` (`--over` for only those past their days, `--yard` for stock by type).
2. Lead with bins past their days and road skips near or past their permit. Each is money (extra days) or a fine.
3. Offer the action: `collect H-... --on=`, `swap`, or a call to the customer (`draft permit H-...`).
