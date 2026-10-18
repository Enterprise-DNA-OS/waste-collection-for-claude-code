<h1 align="center">Waste Collection for Claude Code</h1>

<p align="center">
  <strong>The open-source waste collection and skip bin system that is just a database and Claude Code.</strong>
</p>

<p align="center">
  Created by <a href="https://www.enterprisedna.co"><strong>Enterprise DNA</strong></a>. Free and open source. Works with Claude Code, Codex, OpenCode or Cursor.
</p>

<!-- three-doors -->
<table align="center">
  <tr>
    <td align="center"><strong>Do it yourself</strong><br/>Clone it, run it, own it. Free, MIT.<br/><a href="#quick-start">Quick start</a></td>
    <td align="center"><strong>We customise it</strong><br/>Your fields, your rules, your AMCS Wastedge data brought across.<br/><a href="https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=wastedge">Book a call</a></td>
    <td align="center"><strong>We run it for you</strong><br/>Installed, connected and operated inside Omni. Setup fee, then a retainer.<br/><a href="https://enterprisedna.co/omni/instead-of/wastedge?utm_source=github&utm_medium=readme&utm_campaign=wastedge">How it works</a></td>
  </tr>
</table>

<p align="center">
  <a href="#what-is-this">What is this</a> &bull;
  <a href="#why-no-front-end">Why no front end</a> &bull;
  <a href="#quick-start">Quick start</a> &bull;
  <a href="#the-commands">Commands</a> &bull;
  <a href="#instead-of-wastedge">Instead of AMCS Wastedge</a> &bull;
  <a href="#want-it-installed-and-run-for-you">Installed for you</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node-20+-339933?style=flat-square" alt="Node 20+" />
  <img src="https://img.shields.io/badge/PostgreSQL-any-336791?style=flat-square" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/PGlite-embedded-3ecf8e?style=flat-square" alt="PGlite" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License" />
</p>

---

## What is this

Waste Collection for Claude Code does the job you pay AMCS Wastedge for, as a Postgres database and a set of agent commands. There is no web front end. You open the folder in [Claude Code](https://claude.com/claude-code) (or Codex, OpenCode, Cursor: see `AGENTS.md`) and ask for what you want in plain language. It runs the right query, and it can answer questions the AMCS Wastedge dashboard cannot.

AMCS publishes no price for Wastedge. It is sold as enterprise SaaS for Australian and New Zealand waste and recycling operators after a demo, with the weighbridge, the customer and broker portals and AMCS Pay as further modules ([amcsgroup.com/solutions/wastedge](https://www.amcsgroup.com/solutions/wastedge), checked October 2026). Whatever your quote says, it is a rent on your own customers, bins and dockets, every year.

Want the same thing with a web front end, or built on a different stack? That is a customisation, and it is exactly what Enterprise DNA does: [book a call](https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=wastedge).

This one is for skip bin, commercial collection and construction and demolition operators running a few trucks: the customers and their sites, waste streams, the facilities you tip at and what each charges a tonne, the bins, price lists, skip hires, scheduled front lift services, trucks, drivers, daily runs, tip dockets, invoices and a log. Underneath it is the number the dashboard never gives you: what each customer and each load leaves after the tip fee, from the dockets themselves. The Victorian rules are built in as gates with their sources cited: asbestos does not move without its EPA Waste Tracker record and a permitted truck, a skip does not go on the road without a council permit covering the day, and no driver goes out on a truck their licence does not cover. Accounting stays where it is; one export hands it the invoices.

## Why no front end

- The front end was only ever there because the database was hard to talk to. That is no longer true.
- Your data sits in plain Postgres tables you own. Any tool can read them. No export, no lock-in.
- No seats, no tiers, no add-ons. Read [docs/why-no-front-end.md](docs/why-no-front-end.md) for the honest trade-offs too.

## Quick start

Sixty seconds, no database install (an embedded Postgres runs inside Node):

```bash
git clone https://github.com/Enterprise-DNA-OS/waste-collection-for-claude-code.git
cd waste-collection-for-claude-code
npm install
npm run demo
```

Then open the folder in Claude Code and type `/attention`. The demo business has an asbestos skip due for collection tomorrow with no Waste Tracker record, a garage clean-out skip on the road three days past its council permit, a road delivery booked with no permit, a booking for a landscaper on credit hold, a medical centre lift missed because the gate was locked, a collection that came back with no tip docket, and a builder's 10 m3 price that the landfill's rise from $158 to $172 a tonne has cut to 17% after tipping. The answer shows you exactly how this system thinks.

### Use it with your own Postgres or Supabase

Copy `.env.example` to `.env`, set `DATABASE_URL`, then `npm run migrate`. Same commands, shared data, no per-seat fee.

## The commands

| Command | What it does |
|---|---|
| `/attention` | Everything that wants a decision, worst first. Reportable priority waste without its paper outranks everything |
| `/today` | The run sheets: each truck, driver, job and the paper each job needs |
| `/runs` | Put jobs on runs and drivers on trucks, with licence, rego and EPA permission gates |
| `/book` | A skip or hook lift hire, priced from the customer's list then the list price |
| `/deliver` `/swap` `/collect` | The day's work, with the road permit and Waste Tracker gates |
| `/permit` `/tracker` | Council road permits and EPA Waste Tracker records |
| `/tip` | A tip docket: tonnes, the facility's rate for the day, the excess on the invoice |
| `/lifts` | Front lift services, missed lifts and rebooking |
| `/bins` | Every bin out: days, days over, permit end, collection booked; the yard by type |
| `/margins` | What each customer and load leaves after tip fees |
| `/price-check` `/tip-rates` | Prices against today's tip rates, and the price that restores target |
| `/diversion` | Tonnes kept out of landfill by customer and month |
| `/customer` `/fleet` | A customer's whole card; trucks and drivers with their paper |
| `/bill` `/invoices` `/hold` | Draft invoices from the dockets, what is owed, credit holds |
| `/compliance` | The rule book run against the records, sources cited |
| `/weekly-review` | The Monday review written from six commands |
| `/log` `/draft` | Notes on the record; overdue, permit and price letters to `drafts/`, never sent |
| `/import` `/export` | Bring the business across from Wastedge, test run first; everything out as CSV |
| `/customise` | Change a field, a rule, a price setting, in plain language |
| `/new-view` | A new read-only dashboard page, described in plain language |

`npm run view` renders three branded dashboards (the week, money, diversion). `npm run docs` renders the paperwork: tax invoices, a waste and diversion report per account customer, and the run sheets for today and tomorrow.

## Instead of AMCS Wastedge

Export your customer list, site list, scheduled services and bin register from Wastedge (or any waste system whose reports land in CSV), then:

```bash
node scripts/waste.mjs import wastedge --customers=customers.csv --sites=sites.csv --services=services.csv --bins=bins.csv --dry-run
node scripts/waste.mjs import wastedge --customers=customers.csv --sites=sites.csv --services=services.csv --bins=bins.csv
```

The importer matches common column-name variants, runs as one transaction, is idempotent (re-running updates instead of duplicating), and names every row it skips. Wastedge has no published export layout, so check the headers first; mapping an unusual layout is part of what Enterprise DNA does. Tip rates and prices are entered from the facility notices and your price list, on purpose: they are the numbers your margin rests on. [docs/replace-wastedge.md](docs/replace-wastedge.md) covers exactly what carries over and what starts fresh.

### Ten questions your waste software dashboard cannot answer

Each is one plain-language ask away in Claude Code, because the record is a database you own:

1. Which customers' prices no longer cover the tip fee since the landfill put its rate up, and what price puts each back on target?
2. What did each customer leave us after tip fees last month, not just what we invoiced them?
3. Which skips are past the days their hire covers, and how much in extra days is that?
4. Which road skips run out of council permit before their collection is booked?
5. Which loads came in heaviest over what the bin includes, and did we charge the excess?
6. What share of each account customer's waste did we keep out of landfill this quarter, by stream?
7. Which front lift sites get missed most, and for what reason?
8. What is booked on a truck tomorrow that its driver's licence class does not cover?
9. Which collections came back with no tip docket, so we have no tonnes and no cost?
10. If general waste goes up another $15 a tonne, which prices cross under our target?

## Your first hour: ten things to ask for

1. "Walk me through everything on the attention list and what clears each one."
2. "What's on the trucks tomorrow, and is all the paper there?"
3. "Harbourline sent the Waste Tracker number for the asbestos job: WT-2026-118845."
4. "Book a 6 metre general waste skip for Ruth Okafor in Brighton on Tuesday, on the road."
5. "Jenny's skip came back: 0.9 tonnes at Southvale, docket SV-121602."
6. "Which of our prices don't cover the tip any more?"
7. "Write Coastline Homes a letter about their new skip price."
8. "Draft the invoices for everything done up to Friday."
9. "Change the margin target after tipping to 30%." (a one-line settings change)
10. "Add a page that shows each truck's jobs and tonnes by day for the last month."

## Architecture

```
waste-collection-for-claude-code/
  CLAUDE.md                 how the operator wants this run (routing table + house rules)
  AGENTS.md                 the same, for Codex / OpenCode / Cursor / Gemini CLI
  .claude/commands/         the slash commands
  scripts/                  the CLI the commands drive
  scripts/lib/db.mjs        one adapter: DATABASE_URL (pg) or embedded PGlite
  supabase/migrations/      plain SQL schema
  supabase/seed.sql         demo data
  docs/                     the thesis and the migration guide
```

## Built for coding agents

The database, CLI and command recipes work with Claude Code, Codex, OpenCode or Cursor. Ask your coding agent for a new command and have it implement and test the change against the same records.

## Contributing

Issues and pull requests are welcome. Keep the shape: plain SQL, a small CLI, a slash command per recurring job, no front end.

## Want it installed and run for you?

Enterprise DNA installs Waste Collection for Claude Code for your business, migrates your AMCS Wastedge data, connects it to the rest of your tools, and runs it for you as part of **Omni**, our managed Command Center. One setup fee, then a monthly retainer.

- Book a call: [enterprisedna.co/omni/book](https://enterprisedna.co/omni/book/?offer=replace-software&utm_source=github&utm_medium=readme&utm_campaign=wastedge)
- Read more: [enterprisedna.co/omni/instead-of/wastedge](https://enterprisedna.co/omni/instead-of/wastedge?utm_source=github&utm_medium=readme&utm_campaign=wastedge)

## License

MIT. Copyright (c) 2026 Enterprise DNA.
