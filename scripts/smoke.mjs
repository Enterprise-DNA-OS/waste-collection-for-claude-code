#!/usr/bin/env node
// End-to-end smoke test on a throwaway embedded database.
// Runs migrate, seed, then every CLI command that matters, and asserts on the JSON.
// Passes on Windows and Linux. No network, no Postgres install.
//
// The seed is relative to current_date, so every assertion here holds whatever
// day you run it. Run refs are read back from the CLI, never computed here.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = mkdtempSync(path.join(tmpdir(), 'waste-smoke-'));
const scratch = mkdtempSync(path.join(tmpdir(), 'waste-smoke-files-'));
const env = { ...process.env, DATA_DIR: dataDir };
delete env.DATABASE_URL; // the smoke test always runs embedded

let step = 0;
function run(label, args, { json = true, expectFail = false } = {}) {
  step++;
  const argv = [path.join(root, 'scripts', args[0]), ...args.slice(1), ...(json && !expectFail ? ['--json'] : [])];
  const res = spawnSync(process.execPath, argv, { cwd: root, env, encoding: 'utf8' });
  const ok = expectFail ? res.status === 1 : res.status === 0;
  if (!ok) {
    console.error(`\nFAIL step ${step} (${label}): exit ${res.status}\n--- stdout\n${res.stdout}\n--- stderr\n${res.stderr}`);
    process.exit(1);
  }
  console.log(`  ok  ${String(step).padStart(2)}  ${label}`);
  if (!json || expectFail) return { stdout: res.stdout, stderr: res.stderr };
  try {
    return JSON.parse(res.stdout);
  } catch {
    console.error(`\nFAIL step ${step} (${label}): output is not JSON\n${res.stdout}\n${res.stderr}`);
    process.exit(1);
  }
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`\nFAIL assertion: ${msg}`);
    process.exit(1);
  }
}

const n = (v) => Number(v ?? 0);
const W = (...a) => ['waste.mjs', ...a];

console.log(`smoke: data dir ${dataDir}`);
try {
  run('migrate', ['migrate.mjs'], { json: false });
  run('migrate again (idempotent)', ['migrate.mjs'], { json: false });
  run('seed', ['seed.mjs'], { json: false });
  run('seed again (idempotent)', ['seed.mjs'], { json: false });
  run('help', W('help'), { json: false });

  // ---- the numbers -----------------------------------------------------------

  const stats = run('stats', W('stats'));
  assert(stats.customers === 11, `eleven customers (${stats.customers})`);
  assert(stats.bins_out === 5 && stats.hires_booked === 2, `five bins out, two booked (${stats.bins_out}, ${stats.hires_booked})`);
  assert(stats.rank_one === 1 && stats.over_hire === 1 && stats.prices_under === 1, `one rank-1 item, one over hire, one price under (${stats.rank_one}, ${stats.over_hire}, ${stats.prices_under})`);
  assert(stats.invoices_overdue === 2 && stats.missed_open === 1, `two overdue invoices, one missed lift (${stats.invoices_overdue}, ${stats.missed_open})`);

  const attention = run('attention', W('attention'));
  assert(attention[0].rank === 1 && attention[0].reason === 'RPW NO TRACKER' && attention[0].label === 'H-2005', `asbestos with no tracker leads (${JSON.stringify(attention[0])})`);
  const reasons = attention.map((a) => a.reason);
  for (const r of ['PERMIT EXPIRED', 'NO PERMIT', 'ON HOLD BOOKED', 'PERMIT ENDS', 'MISSED LIFT', 'NO TIP DOCKET', 'OVER HIRE', 'PRICE UNDER TIP COST',
    'TIP RATE UP', 'PERMISSION EXPIRING', 'REGO EXPIRING', 'LICENCE EXPIRING', 'UNBILLED', 'INVOICE OVERDUE', 'CONTAMINATION NOT CHARGED']) {
    assert(reasons.includes(r), `attention names ${r}`);
  }
  const missed = attention.find((a) => a.reason === 'MISSED LIFT').label;

  const tomorrow = run('today --date=tomorrow', W('today', '--date=tomorrow'));
  const skRun = tomorrow.runs.find((r) => r.vehicle_kind === 'skip loader');
  const hkRun = tomorrow.runs.find((r) => r.vehicle_kind === 'hook lift');
  assert(skRun && hkRun, 'tomorrow has a skip loader run and a hook lift run');
  const asb = skRun.jobs.find((j) => j.ref === 'J-H-2005-C');
  assert(asb && asb.flags.includes('NO TRACKER'), 'the asbestos collection is on tomorrow\'s skip run, flagged NO TRACKER');
  const todayRuns = run('today', W('today'));
  const skToday = todayRuns.runs.find((r) => r.vehicle_kind === 'skip loader').ref;

  const bins = run('bins', W('bins'));
  assert(bins.length === 5 && bins[0].ref === 'H-2007' && n(bins[0].days_over) === 5, `five bins out, the longest five days over (${bins.length})`);
  const yard = run('bins --yard', W('bins', '--yard'));
  assert(yard.find((y) => y.code === 'SK6').repair === 1 || n(yard.find((y) => y.code === 'SK6').repair) === 1, 'one SK6 in repair');
  const card = run('customer Coastline', W('customer', 'Coastline'));
  assert(card.sites.length === 3 && card.prices.length === 2, `Coastline has three sites and two prices (${card.sites.length}, ${card.prices.length})`);
  run('customers', W('customers'));
  run('customer ambiguous lists and exits 1', W('customer', 'Mo'), { expectFail: true });
  assert(run('services', W('services')).length === 6, 'six services');
  run('runs', W('runs'));
  const fleet = run('fleet', W('fleet'));
  assert(fleet.vehicles.length === 3 && fleet.drivers.length === 4, 'three trucks, four drivers');
  run('renew the skip loader EPA permission', W('fleet', 'truck', '1CL-4KS', '--permission-to=+365'));
  run('renew Priya\'s licence', W('fleet', 'driver', 'Priya', '--licence-to=+1800'));
  run('a made-up licence class: refused', W('fleet', 'driver', 'Priya', '--class=XX'), { expectFail: true });

  const margins = run('margins', W('margins'));
  assert(margins.by_customer.length >= 6 && margins.thinnest_loads[0].hire === 'H-2003', `the thinnest load is H-2003 (${margins.thinnest_loads[0]?.hire})`);
  const pc = run('price-check', W('price-check'));
  assert(pc.length === 1 && pc[0].ref === 'RC-C1001-SK10-GEN' && pc[0].price_for_target_cents === 57500, `Coastline's 10 m3 price is under, $575 restores it (${JSON.stringify(pc[0])})`);
  assert(run('price-check --all', W('price-check', '--all')).length > 10, 'every hire price checks');
  const rates = run('tip-rates', W('tip-rates'));
  assert(n(rates.find((r) => r.stream === 'GEN' && r.facility === 'Southvale Landfill').change_pct) === 8.9, 'general waste up 8.9%');
  const div = run('diversion Seabreeze', W('diversion', 'Seabreeze'));
  assert(div.length >= 1 && n(div[0].diversion_pct) < 20, 'the school diverts under a fifth');

  const comp = run('compliance', W('compliance'));
  assert(comp.find((c) => c.rule === 'waste-tracker').status === 'BREACH', 'waste tracker breach on the asbestos hire');
  assert(comp.find((c) => c.rule === 'road-permit').breaches.some((b) => b.record === 'H-2007'), 'the expired road permit is a breach');
  assert(comp.find((c) => c.rule === 'tip-records').status === 'BREACH', 'a collection with no docket is a breach');

  // ---- the gates ---------------------------------------------------------------

  run('done asbestos with no tracker: refused', W('done', 'J-H-2005-C'), { expectFail: true });
  const refused = run('asbestos on the hook lift: refused', W('run', 'assign', 'J-H-2005-C', hkRun.ref), { expectFail: true });
  assert(/skip loader/.test(refused.stderr) && /Waste Tracker/.test(refused.stderr) && /EPA permission/.test(refused.stderr), 'every refusal reason named at once');
  run('book for a customer on hold: refused', W('book', 'Kowal', '--bin=SK6', '--stream=GRN'), { expectFail: true });
  run('a nine-day road permit: refused', W('book', 'Ruth', '--bin=SK4', '--on=+3', '--road', '--permit=BAY-SKP-1', '--until=+12'), { expectFail: true });
  run('an MR driver on the HR hook lift: refused', W('run', 'driver', hkRun.ref, 'Priya'), { expectFail: true });
  run('tracker on general waste: refused', W('tracker', 'H-2002', '--ref=WT-1'), { expectFail: true });

  const tr = run('tracker H-2005', W('tracker', 'H-2005', '--ref=WT-2026-118845'));
  assert(tr.waste_tracker_ref === 'WT-2026-118845', 'tracker recorded');
  assert(run('compliance waste-tracker', W('compliance', 'waste-tracker'))[0].status === 'PASS', 'waste tracker passes once recorded');

  // ---- the day's work ---------------------------------------------------------

  run('road delivery before its permit: refused', W('done', 'J-H-2010-D', '--on=today'), { expectFail: true });
  run('permit H-2010', W('permit', 'H-2010', '--ref=BAY-SKP-1102', '--until=+6'));
  run('done in the future: refused', W('done', 'J-H-2010-D'), { expectFail: true });
  const del = run('deliver H-2010 today with B-404', W('deliver', 'J-H-2010-D', '--on=today', '--bin=B-404'));
  assert(del.done_on && !del.needs_tip, 'delivered, no tip needed');
  assert(run('bins after delivery', W('bins')).length === 6, 'six bins out');

  const col = run('collect H-2007 today', W('collect', 'H-2007', '--on=today'));
  assert(col.job === 'J-H-2007-C', `collect job J-H-2007-C (${col.job})`);
  run('done J-H-2007-C', W('done', 'J-H-2007-C'));
  const tip1 = run('tip J-H-2007-C', W('tip', 'J-H-2007-C', '--facility=SVL', '--docket=SV-121602', '--tonnes=0.9'));
  assert(tip1.charges.total_cents === 42000 && n(tip1.charges.excess_tonnes) === 0, `345 hire plus 5 extra days at 15 = 420 (${JSON.stringify(tip1.charges)})`);
  run('the same docket twice: refused', W('tip', 'J-H-2007-C', '--facility=SVL', '--docket=SV-121602', '--tonnes=0.9'), { expectFail: true });

  const tip2 = run('tip the collection with no docket', W('tip', 'J-H-2011-C', '--facility=SVL', '--docket=SV-121540', '--tonnes=1.92'));
  assert(Math.abs(n(tip2.charges.excess_tonnes) - 0.42) < 0.001 && tip2.charges.total_cents === 52240, `0.42 t over at 220 on a 430 hire = 522.40 (${JSON.stringify(tip2.charges)})`);

  run('asbestos onto today\'s skip run', W('run', 'assign', 'J-H-2005-C', skToday));
  run('done asbestos collection', W('done', 'J-H-2005-C'));
  run('asbestos to the general landfill: refused', W('tip', 'J-H-2005-C', '--facility=SVL', '--docket=X1', '--tonnes=0.6'), { expectFail: true });
  const tip3 = run('asbestos to the licensed landfill', W('tip', 'J-H-2005-C', '--facility=RLA', '--docket=RL-2201', '--tonnes=0.6'));
  assert(tip3.charge_cents === 23400, `0.6 t at 390 = 234 (${tip3.charge_cents})`);

  const rb = run('rebook the missed lift', W('rebook', missed, '--on=tomorrow'));
  assert(rb.job === `${missed}-R`, 'rebooked as -R');
  run('miss the rebooked lift', W('miss', rb.job, '--why=Gate locked again'));
  run('rebook it again', W('rebook', rb.job, '--on=+2'));

  run('charge the plasterboard', W('charge', 'J-H-2012-C', '--amount=80'));
  const contam = attention.find((a) => a.reason === 'CONTAMINATION NOT CHARGED' && a.label.startsWith('L-')).label;
  run('waive the school contamination', W('charge', contam, '--amount=0'));

  const after = run('attention after the fixes', W('attention'));
  const afterReasons = after.map((a) => a.reason);
  for (const gone of ['PERMISSION EXPIRING', 'LICENCE EXPIRING']) assert(!afterReasons.includes(gone), `${gone} cleared by renewing`);
  assert(after[0].rank > 1, `nothing at rank 1 now (${after[0].reason})`);
  for (const gone of ['NO TIP DOCKET', 'CONTAMINATION NOT CHARGED', 'PERMIT EXPIRED', 'OVER HIRE', 'RPW NO TRACKER']) assert(!afterReasons.includes(gone), `${gone} cleared`);
  assert(!after.some((a) => a.reason === 'MISSED LIFT' && a.label === missed), 'the first missed lift is followed up');

  // ---- money ---------------------------------------------------------------------

  const dry = run('bill --dry-run', W('bill', '--dry-run'));
  assert(dry.dry_run && dry.drafts.length >= 6 && dry.held_back.length === 0, `drafts for six or more customers, nothing held back (${dry.drafts.length}, ${dry.held_back.length})`);
  const before = run('invoices before billing', W('invoices'));
  assert(before.invoices.length === 3, 'a test run saves nothing');
  const bill = run('bill', W('bill'));
  assert(bill.drafts.length === dry.drafts.length, 'the real run drafts the same');
  const carnegie = bill.drafts.find((d) => d.customer === 'Carnegie Fitouts');
  assert(carnegie && carnegie.total_cents === 70400 + 42000 + 8000, `Carnegie: 704 + 420 + 80 contamination (${carnegie?.total_cents})`);
  assert(run('bill again finds nothing', W('bill')).drafts.length === 0, 'billing is once');
  const issued = run('invoice issue', W('invoice', 'issue', carnegie.invoice));
  assert(issued.due_on > issued.issued_on, 'due date after issue');
  const paid = run('invoice paid INV-2995', W('invoice', 'paid', 'INV-2995'));
  assert(paid.on_hold && paid.still_overdue === 0, 'paid, still on hold, nothing overdue');
  run('release Kowal', W('release', 'Kowal'));
  const kb = run('book Kowal once released', W('book', 'Kowal', '--bin=SK4', '--stream=GRN', '--on=+3'));
  run('cancel that booking', W('cancel', kb.hire, '--why=Customer changed their mind'));
  run('cancel with no reason: refused', W('cancel', 'H-2009'), { expectFail: true });
  run('hold Moorabbin Motors', W('hold', 'Moorabbin Motors', '--why=INV-2990 42 days overdue'));
  run('release Moorabbin Motors', W('release', 'Moorabbin Motors'));

  const ps = run('price set Coastline SK10 GEN 575', W('price', 'set', 'Coastline', '--bin=SK10', '--stream=GEN', '--hire=575'));
  assert(ps.was_cents === 52000 && n(ps.left_pct) >= 25, `repriced to target (${ps.left_pct})`);
  assert(run('price-check after repricing', W('price-check')).length === 0, 'no price under target');
  const tr2 = run('tip rate rise', W('tip-rate', 'set', 'SVL', 'GEN', '--rate=190'));
  assert(tr2.prices_under_target.some((p) => p.ref === 'RC-C1001-SK10-GEN'), 'a new rise names the prices it pushes under');

  // ---- paper, log, drafts --------------------------------------------------------

  run('setting set the margin target', W('setting', 'set', 'min_margin_after_tip_pct', '30'));
  assert(run('settings', W('settings')).find((x) => x.key === 'min_margin_after_tip_pct').value === '30', 'target is 30');
  run('a setting that is not a number: refused', W('setting', 'set', 'unbilled_days', 'soon'), { expectFail: true });
  run('log', W('log', 'Coastline', 'Mark agreed the new 10 m3 price from next month.'));
  assert(run('history', W('history', 'new 10 m3 price')).length === 1, 'the note is in the log');
  for (const [k, ref, file] of [['overdue', 'INV-2990', 'overdue-INV-2990.md'], ['price', 'Coastline', 'price-review-C-1001.md'], ['permit', 'H-2008', 'permit-H-2008.md']]) {
    const d = run(`draft ${k}`, W('draft', k, ref));
    assert(d.draft.endsWith(file) && existsSync(path.join(root, d.draft)), `drafted ${file}`);
    rmSync(path.join(root, d.draft));
  }
  run('draft overdue on a paid invoice: refused', W('draft', 'overdue', 'INV-2995'), { expectFail: true });

  // ---- import and export ---------------------------------------------------------

  writeFileSync(path.join(scratch, 'customers.csv'), 'Account No,Customer Name,Account Type,ABN,Contact,Email,Phone,Terms\r\nA100,Parkdale Plumbing Supplies,Account,12 345 678 901,Dee Wong,dee@pps.example,03 9000 2000,30 days\r\nA101,Mentone Bakehouse,Account,,Sofia Russo,orders@mentonebakehouse.example,,14\r\nA102,,Account,,,,,\r\n');
  writeFileSync(path.join(scratch, 'sites.csv'), 'Account No,Site Address,Suburb,Council,Access Notes\r\nA100,2 Warrigal Road,Parkdale,Kingston,Yard gate on the left\r\nA999,1 Nowhere St,Nowhere,,\r\n');
  writeFileSync(path.join(scratch, 'services.csv'), 'Account No,Site Address,Container Type,Waste Type,Qty,Collection Days,Lift Price\r\nA100,2 Warrigal Road,Front Lift 3m3,General Waste,2,"Mon, Thu",$82.00\r\nA100,2 Warrigal Road,Front Lift 3m3,Mystery,1,Tue,50\r\n');
  writeFileSync(path.join(scratch, 'bins.csv'), 'Asset No,Bin Type,Status\r\nB-701,6m3 Skip,Available\r\nB-702,Compactor 20m3,Available\r\n');
  const files = ['--customers', 'customers.csv', '--sites', 'sites.csv', '--services', 'services.csv', '--bins', 'bins.csv'].map((x, i) => (i % 2 ? path.join(scratch, x) : x));
  const pairs = []; for (let i = 0; i < files.length; i += 2) pairs.push(`${files[i]}=${files[i + 1]}`);
  const imDry = run('import wastedge --dry-run', W('import', 'wastedge', ...pairs, '--dry-run'));
  assert(imDry.created.customers === 1 && imDry.updated.customers === 1, `one new customer, one updated (${JSON.stringify(imDry.created)})`);
  assert(run('stats after a dry run', W('stats')).customers === 11, 'a dry run saves nothing');
  const im = run('import wastedge', W('import', 'wastedge', ...pairs));
  assert(im.created.customers === 1 && im.created.sites === 1 && im.created.services === 1 && im.created.bins === 1, `created ${JSON.stringify(im.created)}`);
  assert(im.skipped.length === 4, `four rows skipped and named (${JSON.stringify(im.skipped)})`);
  const im2 = run('import again (idempotent)', W('import', 'wastedge', ...pairs));
  assert(im2.created.customers === 0 && im2.created.bins === 0 && im2.created.services === 0 && im2.updated.services === 1, 'a second import creates nothing new');
  assert(run('services after import', W('services')).some((s) => s.customer === 'Parkdale Plumbing Supplies' && s.weekdays === 'Mon,Thu'), 'the imported service runs Mon and Thu');

  const ex = run('export', W('export', `--out=${path.join(scratch, 'out')}`));
  assert(n(ex.counts.customers) === 12 && readdirSync(path.join(scratch, 'out')).length === 18, 'eighteen files, twelve customers');

  run('view', ['view.mjs'], { json: false });
  run('docs', ['docs.mjs'], { json: false });
  run('unknown command exits 1', W('frobnicate'), { expectFail: true });

  console.log(`\nPASS  ${step} steps`);
} finally {
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
}
