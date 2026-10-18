---
description: Trucks and drivers with their paper: registration, EPA permission to carry reportable priority waste, licence class and expiry.
---

1. Run `node scripts/waste.mjs fleet --json`.
2. Name anything ending within 30 days, the truck or driver, and what it stops: no asbestos runs without the permission, no runs at all without rego or a covering licence.
3. Renewals are done with VicRoads and EPA Victoria. When the new paper arrives, record it: `fleet truck REGO --rego-to= --permission= --permission-to=`, `fleet driver "NAME" --licence-to= --class=`. Never enter a date nobody has seen on the paper.
