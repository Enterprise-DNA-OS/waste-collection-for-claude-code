# Waste Collection for Claude Code: operating instructions

This file is the brain. Claude Code reads it at the start of every session. It says who this is for, how work gets done, and the one right way to do each recurring job.

## Who this is for

- **Business:** [YOUR BUSINESS]
- **Operator:** [YOUR NAME], [your role]
- **What matters most:** [the one or two outcomes you care about]

Fill this in once. A worker with context knows. A worker without it guesses.

## How to work

1. **Take a brief, not a script.** The operator describes the outcome. You run the right command and present the answer.
2. **Read before you write.** Before drafting anything about a record, read its full history first.
3. **Plain language.** Short sentences. No filler. Numbers in tables.
4. **Silent success, loud problems.** No play-by-play. Say what broke and what you did about it.
5. **Stop at the line.** Anything that sends, deletes, or faces a customer waits for a yes in this session.

## Routing table: one right way for each recurring job

| When the operator asks for... | Use this |
|---|---|
| "what needs my attention", "what's wrong this morning" | `/attention` |
| "what's on tomorrow", "run sheets", "who's driving" | `/today` |
| "put that job on Priya's truck", "change the driver" | `/runs` |
| "book a skip for...", "new hire" | `/book` |
| "the skip went out", "mark that done" | `/deliver` |
| "swap the bin at..." | `/swap` |
| "collect the skip at..." | `/collect` |
| "here's the council permit", "which road skips run out" | `/permit` |
| "here's the Waste Tracker number" | `/tracker` |
| "here's the docket", "they tipped 2.3 tonnes" | `/tip` |
| "the gate was locked", "rebook the lift", "front lift round" | `/lifts` |
| "what bins are out", "how many 6s in the yard" | `/bins` |
| "are we making money", "margin after tip" | `/margins` |
| "do our prices still cover the tip" | `/price-check` |
| "Southvale is putting its rate up" | `/tip-rates` |
| "diversion report", "how much went to landfill" | `/diversion` |
| "pull up Coastline", "who owes us" | `/customer` |
| "when does the rego run out", "licences" | `/fleet` |
| "do the invoicing", "bill the month" | `/bill` |
| "what's overdue", "mark that paid" | `/invoices` |
| "put them on hold", "release the hold" | `/hold` |
| "are we compliant", "check the rules" | `/compliance` |
| "Monday review", "how was the week" | `/weekly-review` |
| "note that Mark said..." | `/log` |
| "chase that invoice", "write them about the price" | `/draft` |
| "bring our Wastedge data across" | `/import` |
| "export everything" | `/export` |
| "add a field", "change the margin target" | `/customise` |
| "a page that shows..." | `/new-view` |

If an ask fits nothing here, run the CLI directly (`node scripts/waste.mjs help`) and then propose a new command for it.

## Hard rules

- Never send email or messages from here. Draft to `drafts/`, a person sends.
- Never delete records without an explicit yes in this session. Prefer marking closed or archived.
- Never invent a record. If a name is ambiguous, list the candidates and ask.
- The database is the source of truth. If the answer is not in it, say so.
- Never invent a tonnage, a docket number, a permit number or a Waste Tracker record. Read it off the docket, permit or record the operator gives you, say it back, then record it.
- The gates (Waste Tracker, EPA permission, road permit, licence class, rego, credit hold, priced contamination) have no force flag. The fix is the record, never a workaround.
- Money is ex GST everywhere; GST is added on the tax invoice. Tonnes are net, off the docket.

## Where things live

- `scripts/` the CLI. `scripts/lib/db.mjs` picks `DATABASE_URL` (Postgres, Supabase) or the embedded database in `.data/`.
- `supabase/migrations/` the schema, plain SQL. `npm run migrate` applies it.
- `.claude/commands/` the slash commands. Add one every time the same ask comes twice.
- `docs/` the thesis and the guide for moving off AMCS Wastedge.

Built by Enterprise DNA. Installed and run for you as part of Omni: https://enterprisedna.co/omni/instead-of/wastedge
