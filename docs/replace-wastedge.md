# Moving off AMCS Wastedge

Switch in a day: export four lists, run one import twice (a test run, then the real one), enter your tip rates and prices, and book the bins that are out today. The old system can stay read-only for history until you are sure.

## 1. Export from Wastedge

Wastedge does not publish a fixed export layout, and what you can download depends on your modules and reports. Ask for, or download from your reports, these four as CSV:

| File | What it holds | Columns the importer looks for |
|---|---|---|
| `customers.csv` | Every account and casual customer | Account No, Customer Name, Account Type, ABN, Contact, Email, Phone, Terms |
| `sites.csv` | Every service address | Account No, Site Address, Suburb, Council, Access Notes |
| `services.csv` | Scheduled collections | Account No, Site Address, Container Type, Waste Type, Qty, Collection Days, Lift Price |
| `bins.csv` | The bin register | Asset No, Bin Type, Status |

Each column also matches common variants (Account Number, Customer Code, Address, LGA, Bin Size, Material, Service Days, Asset Number and more). If a file uses other names, rename the header row in a copy and keep the original as it came out.

## 2. Test run, then import

```bash
node scripts/waste.mjs import wastedge --customers=customers.csv --sites=sites.csv --services=services.csv --bins=bins.csv --dry-run
node scripts/waste.mjs import wastedge --customers=customers.csv --sites=sites.csv --services=services.csv --bins=bins.csv
```

The import runs as one transaction and names every row it skipped and why: a customer it cannot find, a bin type or waste stream it does not recognise, a service with no collection days. Run it a second time: it must create nothing new. Customers match on name, sites on address within a customer, services on site, bin, stream and days, bins on asset number.

## What maps

- **Customers**: name, kind (an account type of cash, casual, resident or COD becomes casual), ABN, contact, email, phone, terms in days.
- **Sites**: address, suburb, council and the access notes your drivers rely on.
- **Services**: bin type (matched on code, name, or the size and kind in words such as "Front Lift 3m3"), stream (general, mixed recycling, cardboard, green, concrete and brick, asbestos), quantity, collection days, lift price ex GST.
- **Bins**: asset number and type; damaged or in-repair bins arrive as repair.

## What does not carry over, on purpose

- **Tip rates and prices.** Enter them from the facility notices and your price list (`tip-rate set`, `price set`, or ask Claude Code to load your price list). They are the numbers every margin rests on, so they start from a source you can point to.
- **Bins out on hire today.** They arrive in the yard. Book each live hire (`book`) and mark its delivery done with the bin that is really there (`done J-... --bin=B-...`), with the road permit if it is on the road.
- **Waste Tracker records and road permits.** Recorded per hire as you book or confirm them, from the permit or the record number itself.
- **Invoice history and payments.** They stay in your accounts system. Open invoices you want chased here can be entered one by one; new invoices are drafted here from the dockets.
- **GPS tracks, proof-of-service photos and weighbridge captures.** The free version has no driver app or scale connection. Drivers' dockets are entered by the office, or Enterprise DNA connects your scale and builds a driver screen into your version.

## After the import

1. `node scripts/waste.mjs attention`: the first audit of the old data.
2. `price-check --all`: every price against today's tip rates.
3. `compliance`: the paper, before the first run goes out.
