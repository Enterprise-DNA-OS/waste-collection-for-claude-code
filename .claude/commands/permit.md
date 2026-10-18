---
description: Record a council permit for a skip on the road or nature strip, and see every road skip against its permit.
---

1. Record: `node scripts/waste.mjs permit H-... --ref=PERMIT_NO --until=LAST_DAY --json`. The window cannot be longer than `road_permit_max_days` in settings (7 by default, the local road limit most councils set). A longer stay is a new permit, so the refusal is the rule, not a bug.
2. Check them all: `bins --json` shows each road skip with its permit end; `compliance road-permit --json` lists the breaches.
3. A skip past its permit: book the collection today, or record the new permit the council issued. Draft the customer note with `draft permit H-...`.
