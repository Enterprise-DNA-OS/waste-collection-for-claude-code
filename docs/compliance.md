# The rule book /compliance checks

Six rules, each with its source, what a breach looks like in the data, and where the CLI already refuses at the gate. `node scripts/waste.mjs compliance` runs them all; add a rule key to run one.

Nothing here is legal advice. It is the rule book the operator has pointed the system at, with sources, and the operator changes it to match their licences, their state and their councils. When a rule moves, update the rule here and the check in `scripts/waste.mjs` together. The defaults are written for Victoria; the New South Wales and New Zealand equivalents are noted below each rule.

Margins (what a price leaves after tipping, the unbilled window) are house rules, not law. They live in `settings` and on the attention list, not here.

## 1. `waste-tracker`: reportable priority waste has a Waste Tracker record before it moves

Anyone who handles reportable priority waste (asbestos, contaminated soil and the other codes) must tell EPA Victoria every time it changes hands, with the information listed in Schedule 7 of the regulations, through Waste Tracker. EPA's message to transporters is "you must track before you transport". **Source: Environment Protection Act 2017 (Vic); Environment Protection Regulations 2021, Schedule 7; EPA Victoria, Waste Tracker (epa.vic.gov.au).** The producer (your customer, or an accredited consigner) creates the record; the transporter updates it at pickup and drop-off.

Breach in the data: a hire of a stream marked `rpw` that is booked or out with no `waste_tracker_ref`, or one collected without it. **Gate: `run assign` refuses to put its swap or collection on a run, and `done` refuses to mark it moved, until the record number is on file (`tracker H-... --ref=`). No force flag.** The attention list puts it at rank 1.

NSW: asbestos loads over 100 kg or 10 square metres of sheeting are tracked in the EPA's Integrated Waste Tracking Solution, by both the transporter and the receiving facility (Protection of the Environment Operations (Waste) Regulation 2014, clauses 76 and 79). Mark the stream `rpw` and record the IWTS movement ID in the same field.

## 2. `transport-permission`: only a permitted truck carries reportable priority waste

Transporting most reportable priority waste needs a permission from EPA Victoria: an A10a permit for the high-risk codes, an A10b registration for the rest. EPA runs snap roadside inspections checking for both the Waste Tracker record and the permission. **Source: Environment Protection Regulations 2021 (Vic), permissions to transport reportable priority waste; EPA Victoria, Waste Tracker and transport permissions.**

Breach in the data: a booked reportable priority waste swap or collection on a run whose truck has no `epa_permission_ref`, or one that ends before the run date. **Gate: `run assign` refuses it. A tip of reportable priority waste is refused at any facility not marked `accepts_rpw`.** The attention list warns 30 days before a permission ends (`fleet truck REGO --permission-to=` records the renewal).

## 3. `road-permit`: a skip on a council road has a permit covering every day it is there

A skip on council land (the road, the nature strip) needs a council permit, usually applied for by the skip company, for a set window, and the skip must be removed on the date set. The City of Monash, for example, issues skip bin permits for at most one week on local roads, requires an accredited supplier to apply two days ahead, and says a longer stay is a new permit; Wellington City Council allows up to 14 days. **Source: council local laws and permit conditions, for example City of Monash, Skip Bin Permit (monash.vic.gov.au); Wellington City Council, skip bins (wellington.govt.nz).** The window lives in `settings` (`road_permit_max_days`, default 7).

Breach in the data: a road hire that is out with no permit, past its `permit_until`, or with a window longer than the setting; or a road hire booked with no permit. **Gate: `done` refuses a road delivery with no permit covering the day, and `permit` and `book` refuse a window longer than the setting. No force flag.** The attention list names a permit ending tomorrow with no collection booked.

## 4. `driver-licence`: every run has a driver with a current licence of the truck's class

A heavy vehicle needs a licence of its class: LR, MR, HR, HC or MC, each covering the classes below it. A skip loader on two axles over 8 tonnes is MR; a three-axle hook lift or front lift is HR. **Source: Road Safety Act 1986 (Vic) and Road Safety (Drivers) Regulations 2019; the classes are national.** NZ: the Land Transport (Driver Licensing) Rule 1999, classes 2 to 5.

Breach in the data: a planned run with jobs whose driver's class ranks below the truck's, whose licence ends before the run, or with no driver. **Gate: `run driver` refuses the driver, and `run assign` refuses jobs onto a run whose driver does not cover it.** The attention list warns 30 days before a licence ends.

## 5. `registration`: no run on an unregistered truck

**Source: Road Safety Act 1986 (Vic), registration of motor vehicles.** Breach in the data: a planned run with jobs on a truck whose `rego_expires_on` is before the run date. **Gate: `run assign` refuses jobs onto it.** The attention list warns 30 days ahead.

## 6. `tip-records`: every load tipped has its docket

The docket is the record of two things: what the tip cost you, and the tonnes the customer is charged for. Business records are kept for five years. **Source: Income Tax Assessment Act 1936 s 262A (records kept five years).** NZ: Tax Administration Act 1994 s 22 (seven years).

Held by design: `tip` refuses without a docket number and tonnes, refuses a docket number already recorded at that facility, and there is no delete path for tips, jobs or invoices. The live risk is a swap or collection marked done with no docket: no tonnes, no excess charge, no cost. The check names them; `tip J-... --docket= --tonnes=` closes them while the docket is still in the truck.

## Licensing and returns in New Zealand

Auckland Council licenses waste collectors and collects their tonnage data: the Waste Management and Minimisation Bylaw 2019 required a collector's licence, and the Waste Minimisation and Management Bylaw 2026 (in force from 27 July 2026) keeps collector licensing and data collection. Returns go to the council by email with the licence number, tonnes, operator type, activity and the month reported. **Source: Auckland Council, waste management and minimisation bylaw and "How to report your waste volumes" (aucklandcouncil.govt.nz).** An Auckland operator adds a monthly `council-return` rule with `/customise`: the tonnes for the month come straight from `diversion`.
