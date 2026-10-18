---
description: The Monday review, written from five commands: what needs a decision, the bins and runs, margins and prices, money owed, and the paper.
---

1. Run, `--json` each: `node scripts/waste.mjs attention`, `bins`, `margins --days=7`, `price-check`, `invoices --open`, `compliance`.
2. Write the review in five short sections, prose plus small tables, nothing invented:
   - **Today's decisions.** The attention list, worst first, one action each. Reportable priority waste without its paper is the first line of the whole review.
   - **Bins and runs.** Bins out past their days, road skips near their permit end, missed lifts, jobs on no run.
   - **Margins.** Last week by customer after tip fees, tip rate changes, prices under target.
   - **Money.** Overdue invoices, unbilled work, customers on hold.
   - **Paper.** Compliance breaches, permissions, licences and rego ending in 30 days.
3. End with at most five actions for the week, each one command or one conversation.
4. On paper: `npm run view` renders the week, money and diversion pages.
