---
description: Put a customer on credit hold or release them. A customer on hold cannot be booked.
---

1. Hold: `node scripts/waste.mjs hold "CUSTOMER" --why="INV-... 40 days overdue" --json`. Release: `release "CUSTOMER" --json`.
2. A hold names any bookings already made: ask the operator whether to keep or cancel each.
3. When an invoice is paid the CLI says if the hold can come off. Releasing is the operator's call, never automatic.
