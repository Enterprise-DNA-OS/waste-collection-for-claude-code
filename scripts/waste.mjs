#!/usr/bin/env node
// waste-collection-for-claude-code: the one CLI. Claude Code slash commands
// call this; so can you.
//
//   node scripts/waste.mjs <command> [args] [--flags] [--json]
//
// Run with no arguments (or `help`) for the command list.
//
// This is a skip bin and commercial collection business the way AMCS Wastedge
// sells it: customers and their sites, waste streams, facilities and their tip
// rates, bins, price lists, skip hires, scheduled front lift services, trucks,
// drivers, daily runs, jobs, tip dockets, invoices and a log. It sends nothing
// and connects to nothing: reminders and letters draft to drafts/, a person
// sends them.
//
// The gates, and there are no force flags:
//   * reportable priority waste (asbestos and the rest) does not go on a run,
//     and a collection is not marked done, without its EPA Waste Tracker record,
//     on a truck with a current EPA permission (Environment Protection Act 2017
//     and Environment Protection Regulations 2021, Victoria)
//   * a skip does not go on the road without a council permit covering the day,
//     and no permit window is longer than the council allows
//   * a driver goes on a run only with a current licence of the truck's class,
//     and a truck only with current registration
//   * a tip needs its docket number and tonnes, at a facility that takes the
//     stream; reportable priority waste only at a facility licensed for it
//   * nobody books for a customer on credit hold
//   * an invoice is not drafted over contamination nobody priced: charge it or
//     waive it at 0 first
//   * no deleting: hires and jobs cancel with a reason, invoices void

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { parseCsv, pick } from './lib/csv.mjs';
import { table, money, price, isoDate, truncate, heading } from './lib/format.mjs';

// ---------------------------------------------------------------------------
// Arguments, errors, small parsers

const BOOL_FLAGS = new Set(['json', 'help', 'all', 'dry-run', 'out', 'yard', 'open', 'over']);

function parseArgv(argv) {
  const args = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { flags.help = true; continue; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      let name;
      let value;
      if (eq > -1) { name = a.slice(2, eq); value = a.slice(eq + 1); }
      else {
        name = a.slice(2);
        const next = argv[i + 1];
        if (BOOL_FLAGS.has(name) || next === undefined || next.startsWith('--')) value = true;
        else value = argv[++i];
      }
      flags[name] = value;
    } else args.push(a);
  }
  return { args, flags };
}

class CliError extends Error {
  constructor(message, code = 1) { super(message); this.code = code; }
}

const num = (v) => Number(v ?? 0);
const str = (v) => (v === true || v === undefined || v === null ? '' : String(v));
const pct = (v) => (v === null || v === undefined ? '' : `${Number(v).toFixed(1)}%`);
let CUR = 'AUD';
const $ = (c) => money(c, CUR);
const $$ = (c) => price(c, CUR);
const t = (v) => (v === null || v === undefined || v === '' ? '' : `${Number(v).toFixed(2).replace(/\.?0+$/, '')} t`);

function parseMoney(v, what = 'amount') {
  if (v === undefined || v === null || v === true || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/[$,\s]/g, '').replace(/^(AU|NZ)/i, ''));
  if (!Number.isFinite(n) || n < 0) throw new CliError(`Cannot read ${what} "${v}". Use dollars, for example 495 or 45.50.`);
  return Math.round(n * 100);
}

function parseTonnes(v) {
  const n = Number(String(v ?? '').replace(/[t\s,]/gi, ''));
  if (!Number.isFinite(n) || n <= 0) throw new CliError(`Cannot read tonnes "${v}". Use the weight off the docket, for example 2.34.`);
  return n;
}

let TODAY = null;
function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function parseDate(v, what = 'date') {
  if (!v || v === true) return null;
  const s = String(v).trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (s === 'today') return TODAY;
  if (s === 'tomorrow') return addDays(TODAY, 1);
  if (s === 'yesterday') return addDays(TODAY, -1);
  const rel = s.match(/^([+-]\d+)d?$/);
  if (rel) return addDays(TODAY, Number(rel[1]));
  const slash = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/); // Australian and New Zealand write DD/MM/YYYY
  if (slash) {
    let year = Number(slash[3]);
    if (year < 100) year += 2000;
    const [day, month] = [Number(slash[1]), Number(slash[2])];
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  throw new CliError(`Cannot read ${what} "${v}". Use YYYY-MM-DD, DD/MM/YYYY, today, tomorrow or +3.`);
}
const dayLabel = (iso) => {
  if (!iso) return '';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]} ${String(iso).slice(8, 10)} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}`;
};

function out(flags, data, render) {
  if (flags.json) console.log(JSON.stringify(data, null, 2));
  else render(data);
}

async function setting(db, key, dflt) {
  const [r] = await db.query('select value from settings where key = $1', [key]);
  return r ? r.value : dflt;
}

async function logActivity(db, subject, text) {
  await db.query('insert into activity (subject, text) values ($1, $2)', [subject, text]);
}

// ---------------------------------------------------------------------------
// Finding things: refs, partial refs and names, case-insensitive. Ambiguous
// matches list the candidates and exit 1.

async function findOne(db, what, rows, q, label) {
  if (rows.length === 1) return rows[0];
  if (!rows.length) throw new CliError(`No ${what} matches "${q}".`);
  throw new CliError(`"${q}" matches ${rows.length} ${what}s. Say which:\n${rows.map((r) => `  ${label(r)}`).join('\n')}`);
}

async function findCustomer(db, q) {
  if (!q) throw new CliError('Name the customer (name or C-ref).');
  const exact = await db.query(`select * from customers where lower(ref) = lower($1) or lower(name) = lower($1)`, [q]);
  if (exact.length === 1) return exact[0];
  const rows = await db.query(`select * from customers where name ilike $1 or ref ilike $1 order by name`, [`%${q}%`]);
  return findOne(db, 'customer', rows, q, (r) => `${r.ref}  ${r.name}`);
}

async function findHire(db, q) {
  if (!q) throw new CliError('Name the hire (H-ref).');
  const rows = await db.query(`select h.*, bt.kind as bin_kind, bt.code as bin_code, st.rpw, st.code as stream_code, c.name as customer, c.credit_hold
                                 from hires h join bin_types bt on bt.id = h.bin_type_id join streams st on st.id = h.stream_id
                                 join customers c on c.id = h.customer_id
                                where lower(h.ref) = lower($1) or lower(h.ref) = lower('H-' || $1)`, [q]);
  if (rows.length) return rows[0];
  const like = await db.query(`select h.*, bt.kind as bin_kind, bt.code as bin_code, st.rpw, st.code as stream_code, c.name as customer, c.credit_hold
                                 from hires h join bin_types bt on bt.id = h.bin_type_id join streams st on st.id = h.stream_id
                                 join customers c on c.id = h.customer_id
                                where h.ref ilike $1 or c.name ilike $1 and h.status in ('booked', 'out') order by h.ref`, [`%${q}%`]);
  return findOne(db, 'hire', like, q, (r) => `${r.ref}  ${r.customer}  ${r.bin_code} ${r.stream_code}  ${r.status}`);
}

const JOB_SQL = `select j.*, st.rpw, st.code as stream_code, c.name as customer, h.ref as hire_ref, h.waste_tracker_ref, h.placement,
                        h.permit_ref, h.permit_until, coalesce(bt.kind, 'fel') as bin_kind, coalesce(bt.code, sbt.code) as bin_code, sv.ref as service_ref
                   from jobs j join streams st on st.id = j.stream_id join customers c on c.id = j.customer_id
                   left join hires h on h.id = j.hire_id left join bin_types bt on bt.id = h.bin_type_id
                   left join services sv on sv.id = j.service_id left join bin_types sbt on sbt.id = sv.bin_type_id`;

async function findJob(db, q) {
  if (!q) throw new CliError('Name the job (J- or L- ref).');
  const rows = await db.query(`${JOB_SQL} where lower(j.ref) = lower($1)`, [q]);
  if (rows.length) return rows[0];
  const like = await db.query(`${JOB_SQL} where j.ref ilike $1 order by j.scheduled_on desc limit 12`, [`%${q}%`]);
  return findOne(db, 'job', like, q, (r) => `${r.ref}  ${r.customer}  ${r.scheduled_on}  ${r.status}`);
}

async function findRun(db, q) {
  const rows = await db.query(`select r.*, v.kind as vehicle_kind, v.rego from runs r join vehicles v on v.id = r.vehicle_id
                                where lower(r.ref) = lower($1) or r.ref ilike $2 order by r.run_on`, [q, `%${q}%`]);
  const exact = rows.filter((r) => r.ref.toLowerCase() === String(q).toLowerCase());
  return exact.length ? exact[0] : findOne(db, 'run', rows, q, (r) => `${r.ref}  ${r.rego}`);
}

async function findFacility(db, q) {
  const rows = await db.query(`select * from facilities where lower(ref) = lower($1) or name ilike $2`, [q, `%${q}%`]);
  return findOne(db, 'facility', rows, q, (r) => `${r.ref}  ${r.name}`);
}

async function findStream(db, q) {
  const rows = await db.query(`select * from streams where lower(code) = lower($1) or name ilike $2`, [q, `%${q}%`]);
  const exact = rows.filter((r) => r.code.toLowerCase() === String(q).toLowerCase());
  return exact.length ? exact[0] : findOne(db, 'stream', rows, q, (r) => `${r.code}  ${r.name}`);
}

async function findBinType(db, q) {
  const rows = await db.query(`select * from bin_types where lower(code) = lower($1) or name ilike $2`, [q, `%${q}%`]);
  const exact = rows.filter((r) => r.code.toLowerCase() === String(q).toLowerCase());
  return exact.length ? exact[0] : findOne(db, 'bin type', rows, q, (r) => `${r.code}  ${r.name}`);
}

async function findDriver(db, q) {
  const rows = await db.query(`select * from drivers where name ilike $1 and status = 'active'`, [`%${q}%`]);
  return findOne(db, 'driver', rows, q, (r) => r.name);
}

// ---------------------------------------------------------------------------
// The run gate. Every reason a job cannot go on a run, all at once.

const TRUCK_FOR = { skip: 'skip loader', hook: 'hook lift', fel: 'front lift', mgb: 'side lift' };

async function runRefusals(db, job, runId) {
  const [r] = await db.query(`select r.*, v.kind as vehicle_kind, v.rego, v.licence_class as needs_class, v.rego_expires_on,
                                     v.epa_permission_ref, v.epa_permission_expires_on, d.name as driver, d.licence_class as driver_class,
                                     d.licence_expires_on, licence_rank(d.licence_class) >= licence_rank(v.licence_class) as class_ok
                                from runs r join vehicles v on v.id = r.vehicle_id left join drivers d on d.id = r.driver_id where r.id = $1`, [runId]);
  const no = [];
  if (r.status !== 'planned') no.push(`${r.ref} is closed.`);
  if (TRUCK_FOR[job.bin_kind] !== r.vehicle_kind) no.push(`A ${job.bin_code} needs a ${TRUCK_FOR[job.bin_kind]}; ${r.ref} is the ${r.vehicle_kind} (${r.rego}).`);
  if (!r.driver) no.push(`${r.ref} has no driver yet.`);
  else {
    if (!r.class_ok) no.push(`${r.driver} holds ${r.driver_class}; the ${r.rego} needs ${r.needs_class} or higher.`);
    if (r.licence_expires_on && r.licence_expires_on < r.run_on) no.push(`${r.driver}'s licence ends ${r.licence_expires_on}, before ${r.run_on}.`);
  }
  if (r.rego_expires_on && r.rego_expires_on < r.run_on) no.push(`${r.rego} registration ends ${r.rego_expires_on}, before ${r.run_on}.`);
  if (job.rpw && job.kind !== 'delivery') {
    if (!job.waste_tracker_ref) no.push(`${job.hire_ref || job.ref} is reportable priority waste with no Waste Tracker record. Record it first: tracker ${job.hire_ref} --ref=...`);
    if (!r.epa_permission_ref || (r.epa_permission_expires_on && r.epa_permission_expires_on < r.run_on)) no.push(`${r.rego} has no current EPA permission to carry reportable priority waste on ${r.run_on}.`);
  }
  return { run: r, refusals: no };
}

async function runFor(db, date, binKind) {
  const [r] = await db.query(`select r.id from runs r join vehicles v on v.id = r.vehicle_id where r.run_on = $1 and v.kind = $2 and v.status = 'active' order by r.ref limit 1`, [date, TRUCK_FOR[binKind]]);
  return r ? r.id : null;
}

// Put a job on the day's run for its truck if the gate allows; say why if not.
async function autoAssign(db, jobRef) {
  const job = await findJob(db, jobRef);
  const runId = await runFor(db, job.scheduled_on, job.bin_kind);
  if (!runId) return { assigned: null, why: [`No ${TRUCK_FOR[job.bin_kind]} run on ${job.scheduled_on}. Put it on one with: run assign ${job.ref} <run>`] };
  const { run, refusals } = await runRefusals(db, job, runId);
  if (refusals.length) return { assigned: null, why: refusals };
  await db.query('update jobs set run_id = $1 where id = $2', [runId, job.id]);
  return { assigned: run.ref, why: [] };
}

async function nextRef(db, tableName, prefix, width = 4) {
  const [r] = await db.query(`select coalesce(max(nullif(regexp_replace(ref, '\\D', '', 'g'), '')::int), 0) as n from ${tableName} where ref ~ $1`, [`^${prefix}\\d+$`]);
  return `${prefix}${String(Number(r.n) + 1).padStart(width, '0')}`;
}

// ---------------------------------------------------------------------------
// Reads

async function cmdStats(db, flags) {
  const [s] = await db.query(`
    select (select count(*) from customers where status = 'active') as customers,
           (select count(*) from hires where status = 'out') as bins_out,
           (select count(*) from hires where status = 'booked') as hires_booked,
           (select count(*) from services where status = 'active') as services,
           (select count(*) from v_attention) as attention,
           (select count(*) from v_attention where rank = 1) as rank_one,
           (select count(*) from v_hires where status = 'out' and days_over > 0) as over_hire,
           (select count(*) from v_price_check where left_pct < target_pct) as prices_under,
           (select count(*) from v_invoices where days_overdue > 0) as invoices_overdue,
           (select coalesce(sum(total_cents), 0) from v_unbilled) as unbilled_cents,
           (select count(*) from jobs where status = 'missed' and not followed_up) as missed_open`);
  const data = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, Number(v)]));
  out(flags, data, (d) => { console.log(heading('Numbers')); for (const [k, v] of Object.entries(d)) console.log(`  ${k.padEnd(18)} ${k.endsWith('cents') ? $(v) : v}`); });
}

async function cmdAttention(db, flags) {
  const rows = await db.query(`select rank, reason, label, who, place, detail, days from v_attention
                                where ($1::int is null or rank <= $1) order by rank, days desc nulls last, label`, [flags.rank ? Number(flags.rank) : null]);
  out(flags, rows, (r) => {
    console.log(heading('Needs a decision, worst first'));
    if (!r.length) return console.log('\n  Nothing. Every bin, truck, permit and invoice is where it should be.');
    for (const a of r) console.log(`\n  [${a.rank}] ${a.reason}  ${a.label}  ${a.who || ''}${a.place ? '  ' + a.place : ''}\n      ${a.detail}`);
  });
}

async function cmdToday(db, flags) {
  const date = parseDate(flags.date || 'today');
  const runs = await db.query(`select * from v_runs where run_on = $1 order by ref`, [date]);
  const jobs = await db.query(`select j.ref, j.kind, j.status, j.run_id, c.name as customer, s.address || ', ' || s.suburb as site, s.access_notes,
                                      coalesce(bt.code, sbt.code) as bin, st.code as stream, st.rpw, coalesce(sv.qty, 1) as qty,
                                      h.ref as hire, h.placement, h.permit_ref, h.permit_until, h.waste_tracker_ref, b.asset_no, j.missed_reason
                                 from jobs j join customers c on c.id = j.customer_id join sites s on s.id = j.site_id join streams st on st.id = j.stream_id
                                 left join hires h on h.id = j.hire_id left join bin_types bt on bt.id = h.bin_type_id left join bins b on b.id = h.bin_id
                                 left join services sv on sv.id = j.service_id left join bin_types sbt on sbt.id = sv.bin_type_id
                                where j.scheduled_on = $1 and j.status <> 'cancelled' order by j.kind, s.suburb, j.ref`, [date]);
  const flagsFor = (j) => [
    j.rpw && j.kind !== 'delivery' && !j.waste_tracker_ref ? 'NO TRACKER' : '',
    j.placement === 'road' && j.kind === 'delivery' && (!j.permit_ref || (j.permit_until && j.permit_until < date)) ? 'NO PERMIT' : '',
    j.placement === 'road' && j.permit_until && j.kind !== 'delivery' ? `permit to ${j.permit_until.slice(5)}` : '',
  ].filter(Boolean).join(', ');
  const data = { date, runs: runs.map((r) => ({ ...r, jobs: jobs.filter((j) => j.run_id === r.run_id).map((j) => ({ ...j, flags: flagsFor(j) })) })),
                 unassigned: jobs.filter((j) => !j.run_id).map((j) => ({ ...j, flags: flagsFor(j) })) };
  out(flags, data, (d) => {
    console.log(heading(`Run sheets for ${dayLabel(d.date)}`));
    for (const r of d.runs) {
      if (!r.jobs.length) continue;
      const paper = [r.driver_ok ? '' : 'DRIVER NOT COVERED', r.rego_ok ? '' : 'REGO LAPSED'].filter(Boolean).join(', ');
      console.log(`\n  ${r.ref}  ${r.vehicle} ${r.rego}  driver ${r.driver || 'none'} (${r.driver_class || '-'}, needs ${r.needs_class})${paper ? '  ' + paper : ''}`);
      console.log(table(r.jobs, [
        { key: 'ref', label: 'job' }, { key: 'kind', label: 'kind' }, { key: 'customer', label: 'customer', width: 26 },
        { key: 'site', label: 'site', width: 34 }, { key: 'bin', label: 'bin', format: (v, row) => (row.qty > 1 ? `${row.qty} x ${v}` : v) },
        { key: 'stream', label: 'stream' }, { key: 'status', label: 'status' }, { key: 'flags', label: 'check' },
      ]));
    }
    if (d.unassigned.length) {
      console.log('\n  On no run yet');
      console.log(table(d.unassigned, [{ key: 'ref', label: 'job' }, { key: 'kind', label: 'kind' }, { key: 'customer', label: 'customer' }, { key: 'site', label: 'site', width: 34 }, { key: 'bin', label: 'bin' }, { key: 'flags', label: 'check' }]));
    }
    if (!d.runs.some((r) => r.jobs.length) && !d.unassigned.length) console.log('\n  Nothing booked.');
  });
}

async function cmdBins(db, flags) {
  if (flags.yard) {
    const rows = await db.query(`select bt.code, bt.name, count(*) filter (where b.status = 'yard') as yard, count(*) filter (where b.status = 'out') as out,
                                        count(*) filter (where b.status = 'repair') as repair,
                                        (select count(*) from hires h where h.bin_type_id = bt.id and h.status = 'booked' and h.deliver_on <= current_date + 7) as booked_7d
                                   from bin_types bt left join bins b on b.bin_type_id = bt.id and b.status <> 'retired' group by bt.id, bt.code, bt.name order by bt.code`);
    return out(flags, rows, (r) => { console.log(heading('Bins by type')); console.log(table(r, [{ key: 'code', label: 'type' }, { key: 'name', label: 'bin' }, { key: 'yard', label: 'in yard', align: 'right' }, { key: 'out', label: 'out', align: 'right' }, { key: 'repair', label: 'repair', align: 'right' }, { key: 'booked_7d', label: 'booked 7d', align: 'right' }])); });
  }
  const rows = await db.query(`select ref, customer, address, suburb, council, bin, bin_type, stream, delivered_on, days_out, days_over, placement, permit_ref, permit_until,
                                      collect_booked_on, waste_tracker_ref, rpw
                                 from v_hires where status = 'out' and ($1::boolean is not true or days_over > 0) order by days_out desc`, [!!flags.over]);
  out(flags, rows, (r) => {
    console.log(heading('Bins out'));
    console.log(table(r, [
      { key: 'ref', label: 'hire' }, { key: 'bin', label: 'bin' }, { key: 'bin_type', label: 'type' }, { key: 'stream', label: 'stream' },
      { key: 'customer', label: 'customer', width: 24 }, { key: 'suburb', label: 'suburb' }, { key: 'days_out', label: 'days', align: 'right' },
      { key: 'days_over', label: 'over', align: 'right', format: (v) => (num(v) ? v : '') },
      { key: 'placement', label: 'where', format: (v, row) => (v === 'road' ? (row.permit_until ? `road to ${dayLabel(row.permit_until)}` : 'road, NO PERMIT') : 'private') },
      { key: 'collect_booked_on', label: 'collect', format: (v) => (v ? dayLabel(v) : '') },
    ]));
  });
}

async function cmdCustomers(db, flags) {
  const rows = await db.query(`select c.ref, c.name, c.kind, c.credit_hold,
                                      (select count(*) from hires h where h.customer_id = c.id and h.status in ('booked', 'out')) as open_hires,
                                      (select count(*) from services s where s.customer_id = c.id and s.status = 'active') as services,
                                      (select coalesce(sum(total_cents), 0) from v_invoices i where i.customer_ref = c.ref and i.status = 'issued') as owing_cents,
                                      (select coalesce(max(days_overdue), 0) from v_invoices i where i.customer_ref = c.ref) as worst_overdue
                                 from customers c where c.status = 'active' order by c.name`);
  out(flags, rows, (r) => { console.log(heading('Customers')); console.log(table(r, [{ key: 'ref', label: 'ref' }, { key: 'name', label: 'customer' }, { key: 'kind', label: 'kind' }, { key: 'open_hires', label: 'hires', align: 'right' }, { key: 'services', label: 'services', align: 'right' }, { key: 'owing_cents', label: 'owing', align: 'right', format: $ }, { key: 'worst_overdue', label: 'overdue', align: 'right', format: (v) => (num(v) ? `${v}d` : '') }, { key: 'credit_hold', label: 'hold', format: (v) => (v ? 'ON HOLD' : '') }])); });
}

async function cmdCustomer(db, q, flags) {
  const c = await findCustomer(db, q);
  const sites = await db.query(`select ref, address, suburb, council, access_notes from sites where customer_id = $1 and status = 'active' order by ref`, [c.id]);
  const hires = await db.query(`select ref, status, bin_type, stream, suburb, deliver_on, delivered_on, collected_on, days_out, billed_cents, tip_cents from v_hires where customer_ref = $1 order by deliver_on desc limit 12`, [c.ref]);
  const services = await db.query(`select sv.ref, bt.code as bin, st.code as stream, sv.qty, sv.weekdays, sv.lift_cents, sv.status, s.suburb from services sv join bin_types bt on bt.id = sv.bin_type_id join streams st on st.id = sv.stream_id join sites s on s.id = sv.site_id where sv.customer_id = $1 order by sv.ref`, [c.id]);
  const prices = await db.query(`select rc.ref, bt.code as bin, st.code as stream, rc.hire_cents, rc.lift_cents from rate_cards rc join bin_types bt on bt.id = rc.bin_type_id join streams st on st.id = rc.stream_id where rc.customer_id = $1 order by rc.ref`, [c.id]);
  const invoices = await db.query(`select ref, status, issued_on, due_on, total_cents, days_overdue from v_invoices where customer_ref = $1 order by ref desc limit 8`, [c.ref]);
  const diversion = await db.query(`select month, tonnes, diverted_tonnes, diversion_pct from v_diversion where customer_ref = $1 order by month desc limit 3`, [c.ref]);
  const notes = await db.query(`select at, text from activity where subject = $1 or subject in (select 'hire:' || ref from hires where customer_id = $2) order by at desc limit 6`, [`customer:${c.ref}`, c.id]);
  const data = { customer: c, sites, hires, services, prices, invoices, diversion, notes };
  out(flags, data, (d) => {
    console.log(heading(`${c.name} (${c.ref}, ${c.kind}${c.credit_hold ? ', ON CREDIT HOLD: ' + (c.hold_reason || '') : ''})`));
    console.log(`  ${[c.contact_name, c.email, c.phone].filter(Boolean).join(' · ')}  Terms ${c.terms_days} days.`);
    console.log('\n  Sites'); console.log(table(sites, [{ key: 'ref', label: 'site' }, { key: 'address', label: 'address' }, { key: 'suburb', label: 'suburb' }, { key: 'council', label: 'council' }, { key: 'access_notes', label: 'access', width: 40 }]));
    if (hires.length) { console.log('\n  Hires'); console.log(table(hires, [{ key: 'ref', label: 'hire' }, { key: 'status', label: 'status' }, { key: 'bin_type', label: 'bin' }, { key: 'stream', label: 'stream' }, { key: 'suburb', label: 'suburb' }, { key: 'delivered_on', label: 'delivered' }, { key: 'days_out', label: 'days', align: 'right' }, { key: 'billed_cents', label: 'charged', align: 'right', format: $ }, { key: 'tip_cents', label: 'tip cost', align: 'right', format: $ }])); }
    if (services.length) { console.log('\n  Services'); console.log(table(services, [{ key: 'ref', label: 'service' }, { key: 'qty', label: 'bins', align: 'right' }, { key: 'bin', label: 'type' }, { key: 'stream', label: 'stream' }, { key: 'weekdays', label: 'days' }, { key: 'lift_cents', label: 'per lift', align: 'right', format: $$ }, { key: 'status', label: 'status' }])); }
    if (prices.length) { console.log('\n  Their prices'); console.log(table(prices, [{ key: 'ref', label: 'price' }, { key: 'bin', label: 'bin' }, { key: 'stream', label: 'stream' }, { key: 'hire_cents', label: 'hire', align: 'right', format: $$ }])); }
    if (invoices.length) { console.log('\n  Invoices'); console.log(table(invoices, [{ key: 'ref', label: 'invoice' }, { key: 'status', label: 'status' }, { key: 'issued_on', label: 'issued' }, { key: 'due_on', label: 'due' }, { key: 'total_cents', label: 'ex GST', align: 'right', format: $$ }, { key: 'days_overdue', label: 'overdue', align: 'right', format: (v) => (num(v) ? `${v}d` : '') }])); }
    if (diversion.length) { console.log('\n  Diversion'); console.log(table(diversion, [{ key: 'month', label: 'month', format: (v) => String(v).slice(0, 7) }, { key: 'tonnes', label: 'tonnes', align: 'right' }, { key: 'diversion_pct', label: 'diverted', align: 'right', format: pct }])); }
    if (notes.length) { console.log('\n  Recent notes'); for (const n of notes) console.log(`  ${isoDate(n.at)}  ${truncate(n.text, 100)}`); }
  });
}

async function cmdServices(db, flags) {
  const rows = await db.query(`select sv.ref, c.name as customer, s.suburb, sv.qty, bt.code as bin, st.code as stream, sv.weekdays, sv.lift_cents, sv.status,
                                      (select min(scheduled_on) from jobs j where j.service_id = sv.id and j.status = 'booked') as next_lift,
                                      (select count(*) from jobs j where j.service_id = sv.id and j.status = 'missed' and j.scheduled_on >= current_date - 28) as missed_28d
                                 from services sv join customers c on c.id = sv.customer_id join sites s on s.id = sv.site_id
                                 join bin_types bt on bt.id = sv.bin_type_id join streams st on st.id = sv.stream_id order by c.name, sv.ref`);
  out(flags, rows, (r) => { console.log(heading('Scheduled services')); console.log(table(r, [{ key: 'ref', label: 'service' }, { key: 'customer', label: 'customer' }, { key: 'suburb', label: 'suburb' }, { key: 'qty', label: 'bins', align: 'right' }, { key: 'bin', label: 'type' }, { key: 'stream', label: 'stream' }, { key: 'weekdays', label: 'days' }, { key: 'lift_cents', label: 'per lift', align: 'right', format: $$ }, { key: 'next_lift', label: 'next', format: dayLabel }, { key: 'missed_28d', label: 'missed 4w', align: 'right', format: (v) => (num(v) ? v : '') }])); });
}

async function cmdRuns(db, flags) {
  const date = parseDate(flags.date || 'today');
  const rows = await db.query(`select ref, run_on, status, vehicle, rego, driver, driver_class, needs_class, driver_ok, rego_ok, rpw_ok, jobs from v_runs where run_on between $1 and $2::date + 1 order by run_on, ref`, [date, date]);
  out(flags, rows, (r) => { console.log(heading(`Runs ${dayLabel(date)} and the day after`)); console.log(table(r, [{ key: 'ref', label: 'run' }, { key: 'vehicle', label: 'truck' }, { key: 'rego', label: 'rego' }, { key: 'driver', label: 'driver' }, { key: 'driver_ok', label: 'licence', format: (v) => (v ? 'ok' : 'NOT COVERED') }, { key: 'rego_ok', label: 'rego', format: (v) => (v ? 'ok' : 'LAPSED') }, { key: 'rpw_ok', label: 'EPA', format: (v) => (v ? 'permitted' : '') }, { key: 'jobs', label: 'jobs', align: 'right' }, { key: 'status', label: 'status' }])); });
}

async function cmdFleet(db, flags) {
  const vehicles = await db.query(`select rego, name, kind, licence_class, rego_expires_on, rego_expires_on - current_date as rego_days, epa_permission_ref, epa_permission_expires_on, epa_permission_expires_on - current_date as permission_days, status from vehicles order by rego`);
  const drivers = await db.query(`select name, licence_class, licence_expires_on, licence_expires_on - current_date as licence_days, status from drivers where status = 'active' order by name`);
  out(flags, { vehicles, drivers }, (d) => {
    console.log(heading('Trucks'));
    console.log(table(d.vehicles, [{ key: 'rego', label: 'rego' }, { key: 'name', label: 'truck' }, { key: 'licence_class', label: 'needs' }, { key: 'rego_expires_on', label: 'rego to' }, { key: 'rego_days', label: 'days', align: 'right' }, { key: 'epa_permission_ref', label: 'EPA permission' }, { key: 'epa_permission_expires_on', label: 'to' }, { key: 'permission_days', label: 'days', align: 'right' }]));
    console.log(heading('Drivers'));
    console.log(table(d.drivers, [{ key: 'name', label: 'driver' }, { key: 'licence_class', label: 'class' }, { key: 'licence_expires_on', label: 'licence to' }, { key: 'licence_days', label: 'days', align: 'right' }]));
  });
}

async function cmdFleetSet(db, sub, args, flags) {
  if (sub === 'truck') {
    const [v] = await db.query('select * from vehicles where lower(rego) = lower($1)', [args[0] || '']);
    if (!v) throw new CliError(`No truck ${args[0] || ''}.`);
    const rego = parseDate(flags['rego-to'], 'rego date');
    const perm = parseDate(flags['permission-to'], 'permission date');
    if (!rego && !perm && !flags.permission) throw new CliError('fleet truck <rego> [--rego-to=DATE] [--permission=REF --permission-to=DATE]');
    await db.query(`update vehicles set rego_expires_on = coalesce($2, rego_expires_on), epa_permission_ref = coalesce($3, epa_permission_ref), epa_permission_expires_on = coalesce($4, epa_permission_expires_on) where id = $1`,
                   [v.id, rego, str(flags.permission) || null, perm]);
    await logActivity(db, `truck:${v.rego}`, `Paper updated:${rego ? ` rego to ${rego}` : ''}${flags.permission ? ` EPA permission ${flags.permission}` : ''}${perm ? ` to ${perm}` : ''}.`);
    return out(flags, { truck: v.rego, rego_expires_on: rego || v.rego_expires_on, epa_permission_expires_on: perm || v.epa_permission_expires_on }, (d) => console.log(`${d.truck}: rego to ${d.rego_expires_on || '-'}, EPA permission to ${d.epa_permission_expires_on || '-'}.`));
  }
  if (sub === 'driver') {
    const d = await findDriver(db, args[0] || '');
    const to = parseDate(flags['licence-to'], 'licence date');
    const cls = flags.class ? String(flags.class).toUpperCase() : null;
    if (cls && !['C', 'LR', 'MR', 'HR', 'HC', 'MC'].includes(cls)) throw new CliError('Licence class is one of C, LR, MR, HR, HC, MC.');
    if (!to && !cls) throw new CliError('fleet driver <name> [--licence-to=DATE] [--class=HR]');
    await db.query(`update drivers set licence_expires_on = coalesce($2, licence_expires_on), licence_class = coalesce($3, licence_class) where id = $1`, [d.id, to, cls]);
    await logActivity(db, `driver:${d.name}`, `Licence updated:${cls ? ` class ${cls}` : ''}${to ? ` to ${to}` : ''}.`);
    return out(flags, { driver: d.name, licence_class: cls || d.licence_class, licence_expires_on: to || d.licence_expires_on }, (x) => console.log(`${x.driver}: ${x.licence_class} to ${x.licence_expires_on}.`));
  }
  throw new CliError('fleet | fleet truck <rego> ... | fleet driver <name> ...');
}

async function cmdMargins(db, flags) {
  const days = Number(flags.days || 30);
  const byCustomer = await db.query(`select c.name as customer, count(*) as jobs, round(sum(t.tonnes), 2) as tonnes, sum(t.total_cents) as charged_cents,
                                            sum(t.tip_cents) as tip_cents, sum(t.margin_cents) as margin_cents,
                                            round(sum(t.margin_cents) * 100.0 / nullif(sum(t.total_cents), 0), 1) as margin_pct
                                       from v_job_totals t join customers c on c.id = t.customer_id
                                      where t.done_on >= current_date - $1::int group by c.name order by margin_pct nulls last`, [days]);
  const worst = await db.query(`select t.ref, h.ref as hire, c.name as customer, bt.code as bin, st.code as stream, t.tonnes, t.total_cents, t.tip_cents, t.margin_cents,
                                       round(t.margin_cents * 100.0 / nullif(t.total_cents, 0), 1) as margin_pct
                                  from v_job_totals t join jobs j on j.id = t.job_id join hires h on h.id = j.hire_id join customers c on c.id = t.customer_id
                                  join bin_types bt on bt.id = h.bin_type_id join streams st on st.id = h.stream_id
                                 where t.done_on >= current_date - $1::int order by margin_pct limit 5`, [days]);
  out(flags, { days, by_customer: byCustomer, thinnest_loads: worst }, (d) => {
    console.log(heading(`Margin after tip fees, last ${days} days`));
    console.log(table(d.by_customer, [{ key: 'customer', label: 'customer' }, { key: 'jobs', label: 'jobs', align: 'right' }, { key: 'tonnes', label: 'tonnes', align: 'right' }, { key: 'charged_cents', label: 'charged', align: 'right', format: $ }, { key: 'tip_cents', label: 'tip fees', align: 'right', format: $ }, { key: 'margin_cents', label: 'left', align: 'right', format: $ }, { key: 'margin_pct', label: 'margin', align: 'right', format: pct }]));
    console.log('\n  Thinnest skip and hook loads');
    console.log(table(d.thinnest_loads, [{ key: 'hire', label: 'hire' }, { key: 'customer', label: 'customer' }, { key: 'bin', label: 'bin' }, { key: 'stream', label: 'stream' }, { key: 'tonnes', label: 'tonnes', align: 'right' }, { key: 'total_cents', label: 'charged', align: 'right', format: $$ }, { key: 'tip_cents', label: 'tip fee', align: 'right', format: $$ }, { key: 'margin_pct', label: 'margin', align: 'right', format: pct }]));
    console.log('\n  Charged = hire, tonnes over what the bin includes, days over and contamination. Tip fees off the dockets. Ex GST.');
  });
}

async function cmdPriceCheck(db, flags) {
  const rows = await db.query(`select * from v_price_check order by left_pct`);
  for (const r of rows) {
    const needed = Number(r.tip_cost_cents) / (1 - Number(r.target_pct) / 100);
    r.price_for_target_cents = Math.ceil(needed / 500) * 500; // to the next $5
  }
  const under = rows.filter((r) => Number(r.left_pct) < Number(r.target_pct));
  out(flags, flags.all ? rows : under, (r) => {
    console.log(heading(flags.all ? 'Every hire price against today\'s tip rates' : 'Hire prices that no longer cover the tip'));
    if (!r.length) return console.log('\n  Every hire price leaves its target after tipping. Run with --all to see them all.');
    console.log(table(r, [{ key: 'ref', label: 'price' }, { key: 'customer', label: 'customer' }, { key: 'bin_type', label: 'bin' }, { key: 'stream', label: 'stream' }, { key: 'hire_cents', label: 'hire', align: 'right', format: $$ }, { key: 'included_tonnes', label: 'incl', align: 'right', format: t }, { key: 'tip_rate_cents', label: 'tip /t', align: 'right', format: $$ }, { key: 'tip_cost_cents', label: 'tip cost', align: 'right', format: $$ }, { key: 'left_pct', label: 'left', align: 'right', format: pct }, { key: 'price_for_target_cents', label: 'price for target', align: 'right', format: $$ }]));
  });
}

async function cmdTipRates(db, flags) {
  const rows = await db.query(`select facility, stream, stream_name, rate_cents, since, previous_cents, change_pct from v_tip_rates order by facility, stream`);
  out(flags, rows, (r) => { console.log(heading('Tip rates in force today')); console.log(table(r, [{ key: 'facility', label: 'facility' }, { key: 'stream', label: 'stream' }, { key: 'rate_cents', label: 'a tonne', align: 'right', format: $$ }, { key: 'since', label: 'since' }, { key: 'previous_cents', label: 'was', align: 'right', format: (v) => (v ? $$(v) : '') }, { key: 'change_pct', label: 'change', align: 'right', format: (v) => (v === null ? '' : `${Number(v) > 0 ? '+' : ''}${v}%`) }])); });
}

async function cmdDiversion(db, q, flags) {
  const month = flags.month ? `${String(flags.month).slice(0, 7)}-01` : null;
  const rows = await db.query(`select d.customer, d.customer_ref, d.month, d.tonnes, coalesce(d.diverted_tonnes, 0) as diverted_tonnes, d.diversion_pct
                                 from v_diversion d where ($1::text is null or d.customer ilike $1 or d.customer_ref ilike $1)
                                  and ($2::date is null or d.month = $2::date) order by d.month desc, d.diversion_pct`, [q ? `%${q}%` : null, month]);
  out(flags, rows, (r) => { console.log(heading('Tonnes and diversion from landfill, by customer and month')); console.log(table(r, [{ key: 'customer', label: 'customer' }, { key: 'month', label: 'month', format: (v) => String(v).slice(0, 7) }, { key: 'tonnes', label: 'tonnes', align: 'right' }, { key: 'diverted_tonnes', label: 'diverted', align: 'right' }, { key: 'diversion_pct', label: 'share', align: 'right', format: pct }])); console.log('\n  Front lift tonnes are the run\'s docket shared across its lifts by bins lifted.'); });
}

async function cmdInvoices(db, flags) {
  const rows = await db.query(`select ref, status, customer, issued_on, due_on, total_cents, days_overdue from v_invoices where ($1::boolean is not true or status in ('draft', 'issued')) order by ref desc`, [!!flags.open]);
  const unbilled = await db.query(`select customer, count(*) as jobs, sum(total_cents) as total_cents, min(done_on) as oldest from v_unbilled group by customer order by customer`);
  out(flags, { invoices: rows, unbilled }, (d) => {
    console.log(heading('Invoices'));
    console.log(table(d.invoices, [{ key: 'ref', label: 'invoice' }, { key: 'status', label: 'status' }, { key: 'customer', label: 'customer' }, { key: 'issued_on', label: 'issued' }, { key: 'due_on', label: 'due' }, { key: 'total_cents', label: 'ex GST', align: 'right', format: $$ }, { key: 'days_overdue', label: 'overdue', align: 'right', format: (v) => (num(v) ? `${v}d` : '') }]));
    console.log('\n  Done and not invoiced yet');
    console.log(table(d.unbilled, [{ key: 'customer', label: 'customer' }, { key: 'jobs', label: 'jobs', align: 'right' }, { key: 'total_cents', label: 'ex GST', align: 'right', format: $$ }, { key: 'oldest', label: 'oldest' }]));
  });
}

async function cmdSettings(db, sub, args, flags) {
  if (sub === 'set') {
    const [key, value] = args;
    const [cur] = await db.query('select * from settings where key = $1', [key || '']);
    if (!cur) throw new CliError(`No setting "${key || ''}". Run settings to see them.`);
    if (/_(pct|days)$/.test(key) && !Number.isFinite(Number(value))) throw new CliError(`${key} takes a number.`);
    await db.query('update settings set value = $2, updated_at = now() where key = $1', [key, String(value)]);
    await logActivity(db, 'settings', `${key} ${cur.value} to ${value}.`);
    return out(flags, { key, was: cur.value, value: String(value) }, (d) => console.log(`${d.key}: ${d.was} to ${d.value}.`));
  }
  const rows = await db.query('select key, value, note from settings order by key');
  out(flags, rows, (r) => { console.log(heading('Settings')); console.log(table(r, [{ key: 'key', label: 'setting' }, { key: 'value', label: 'value' }, { key: 'note', label: 'what it does' }])); });
}

async function cmdHistory(db, q, flags) {
  const rows = await db.query(`select at, subject, text from activity where subject ilike $1 or text ilike $1 order by at desc limit 30`, [`%${q || ''}%`]);
  out(flags, rows, (r) => { console.log(heading('Log')); for (const a of r) console.log(`  ${isoDate(a.at)}  ${a.subject.padEnd(18)} ${a.text}`); });
}

// ---------------------------------------------------------------------------
// Writes: bookings, the day's work, tips

async function rateFor(db, customerId, binTypeId, streamId) {
  const [r] = await db.query(`select * from rate_cards where bin_type_id = $2 and stream_id = $3 and (customer_id = $1 or customer_id is null)
                               order by (customer_id is null), effective_from desc limit 1`, [customerId, binTypeId, streamId]);
  return r;
}

async function cmdBook(db, args, flags) {
  const c = await findCustomer(db, args[0]);
  if (c.credit_hold) throw new CliError(`${c.name} is on credit hold${c.hold_reason ? ` (${c.hold_reason})` : ''}. Take payment or release the hold first: release "${c.name}".`);
  const bt = await findBinType(db, str(flags.bin) || 'SK6');
  if (bt.kind === 'fel') throw new CliError('Front lift bins are services, not hires. Ask for a new service instead.');
  const st = await findStream(db, str(flags.stream) || 'GEN');
  const on = parseDate(flags.on || 'tomorrow', 'delivery date');
  let site;
  if (flags.site) {
    const rows = await db.query(`select * from sites where customer_id = $1 and (lower(ref) = lower($2) or address ilike $3)`, [c.id, str(flags.site), `%${str(flags.site)}%`]);
    site = await findOne(db, 'site', rows, flags.site, (r) => `${r.ref}  ${r.address}, ${r.suburb}`);
  } else if (flags.address) {
    if (!flags.suburb) throw new CliError('A new site needs --address and --suburb (and --council if it is going on the road).');
    const ref = `${c.ref.replace('C-', 'S-')}${String.fromCharCode(65 + Number((await db.query('select count(*) as n from sites where customer_id = $1', [c.id]))[0].n))}`;
    [site] = await db.query(`insert into sites (ref, customer_id, address, suburb, council) values ($1, $2, $3, $4, $5) returning *`, [ref, c.id, str(flags.address), str(flags.suburb), str(flags.council) || null]);
  } else {
    const rows = await db.query(`select * from sites where customer_id = $1 and status = 'active'`, [c.id]);
    site = await findOne(db, 'site', rows, c.name, (r) => `${r.ref}  ${r.address}, ${r.suburb}  (say --site=)`);
  }
  const rate = await rateFor(db, c.id, bt.id, st.id);
  if (!rate || rate.hire_cents === null) throw new CliError(`No price for a ${bt.code} of ${st.code}. Add one to the price list first.`);
  const placement = flags.road ? 'road' : str(flags.placement) || 'private';
  const permitUntil = parseDate(flags.until, 'permit end');
  if (permitUntil) await checkPermitWindow(db, on, permitUntil);
  const ref = await nextRef(db, 'hires', 'H-');
  const [h] = await db.query(`insert into hires (ref, customer_id, site_id, bin_type_id, stream_id, deliver_on, placement, permit_ref, permit_until, waste_tracker_ref, declared, hire_cents, extra_day_cents, excess_tonne_cents)
                               values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning *`,
                              [ref, c.id, site.id, bt.id, st.id, on, placement, str(flags.permit) || null, permitUntil, str(flags.tracker) || null, str(flags.declared) || null, rate.hire_cents, rate.extra_day_cents, rate.excess_tonne_cents]);
  const jobRef = `J-${ref}-D`;
  await db.query(`insert into jobs (ref, kind, hire_id, customer_id, site_id, stream_id, scheduled_on) values ($1, 'delivery', $2, $3, $4, $5, $6)`, [jobRef, h.id, c.id, site.id, st.id, on]);
  const a = await autoAssign(db, jobRef);
  await logActivity(db, `hire:${ref}`, `Booked ${bt.name} of ${st.name.toLowerCase()} for ${c.name} at ${site.address}, ${site.suburb}, delivery ${on}.`);
  const warnings = [...a.why];
  if (placement === 'road' && !h.permit_ref) warnings.push(`It is going on the road: record the council permit before delivery: permit ${ref} --ref=... --until=...`);
  if (st.rpw && !h.waste_tracker_ref) warnings.push(`${st.name} is reportable priority waste: the customer (the producer) creates the Waste Tracker record before collection. Record it: tracker ${ref} --ref=...`);
  const data = { hire: ref, customer: c.name, site: `${site.address}, ${site.suburb}`, bin: bt.code, stream: st.code, deliver_on: on, hire_cents: rate.hire_cents, price_from: rate.ref, delivery_job: jobRef, run: a.assigned, warnings };
  out(flags, data, (d) => {
    console.log(`Booked ${d.hire}: ${bt.name} of ${st.name.toLowerCase()} for ${d.customer}, ${d.site}, delivery ${dayLabel(d.deliver_on)}. ${$$(d.hire_cents)} ex GST (${d.price_from}).`);
    console.log(d.run ? `  On run ${d.run}.` : '  Not on a run yet.');
    for (const w of d.warnings) console.log(`  ! ${w}`);
  });
}

async function checkPermitWindow(db, from, until) {
  const max = Number(await setting(db, 'road_permit_max_days', 7));
  const span = (new Date(`${until}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000;
  if (span < 0) throw new CliError(`The permit ends ${until}, before the bin goes out on ${from}.`);
  if (span > max) throw new CliError(`A ${span}-day permit window is longer than the ${max} days the council allows on a local road. Record the permit the council actually issued; a longer stay is a new permit.`);
}

async function cmdPermit(db, args, flags) {
  const h = await findHire(db, args[0]);
  if (!flags.ref || !flags.until) throw new CliError('permit <hire> --ref=<council permit number> --until=<last day>');
  const until = parseDate(flags.until, 'permit end');
  const from = h.status === 'out' ? (TODAY > h.delivered_on ? TODAY : h.delivered_on) : h.deliver_on;
  await checkPermitWindow(db, from, until);
  await db.query(`update hires set placement = 'road', permit_ref = $2, permit_until = $3 where id = $1`, [h.id, str(flags.ref), until]);
  await logActivity(db, `hire:${h.ref}`, `Council permit ${flags.ref} recorded, on the road until ${until}.`);
  out(flags, { hire: h.ref, permit_ref: str(flags.ref), permit_until: until }, (d) => console.log(`${d.hire}: permit ${d.permit_ref} to ${dayLabel(d.permit_until)}.`));
}

async function cmdTracker(db, args, flags) {
  const h = await findHire(db, args[0]);
  if (!h.rpw) throw new CliError(`${h.ref} is ${h.stream_code}, not reportable priority waste. It needs no Waste Tracker record.`);
  if (!flags.ref) throw new CliError('tracker <hire> --ref=<Waste Tracker record number from the producer>');
  await db.query('update hires set waste_tracker_ref = $2 where id = $1', [h.id, str(flags.ref)]);
  await logActivity(db, `hire:${h.ref}`, `Waste Tracker record ${flags.ref} recorded.`);
  // Anything waiting on the record can now go on its run.
  const waiting = await db.query(`select ref from jobs where hire_id = $1 and status = 'booked' and run_id is null`, [h.id]);
  const assigned = [];
  for (const w of waiting) { const a = await autoAssign(db, w.ref); assigned.push({ job: w.ref, run: a.assigned, why: a.why }); }
  out(flags, { hire: h.ref, waste_tracker_ref: str(flags.ref), assigned }, (d) => {
    console.log(`${d.hire}: Waste Tracker ${d.waste_tracker_ref} on record.`);
    for (const a of d.assigned) console.log(a.run ? `  ${a.job} now on ${a.run}.` : `  ${a.job} still off a run: ${a.why.join(' ')}`);
  });
}

async function bookHireJob(db, kind, args, flags) {
  const h = await findHire(db, args[0]);
  if (h.status !== 'out') throw new CliError(`${h.ref} is ${h.status}; only a bin that is out can be ${kind === 'swap' ? 'swapped' : 'collected'}.`);
  const on = parseDate(flags.on || 'tomorrow', `${kind} date`);
  const [{ n }] = await db.query(`select count(*) as n from jobs where hire_id = $1 and kind = $2`, [h.id, kind]);
  const [open] = await db.query(`select ref from jobs where hire_id = $1 and kind = $2 and status = 'booked'`, [h.id, kind]);
  if (open) throw new CliError(`${h.ref} already has ${open.ref} booked. Move it with: run assign ${open.ref} <run>, or cancel it.`);
  const ref = kind === 'collect' ? `J-${h.ref}-C${Number(n) ? Number(n) + 1 : ''}` : `J-${h.ref}-S${Number(n) + 1}`;
  await db.query(`insert into jobs (ref, kind, hire_id, customer_id, site_id, stream_id, scheduled_on) values ($1, $2, $3, $4, $5, $6, $7)`, [ref, kind, h.id, h.customer_id, h.site_id, h.stream_id, on]);
  const a = await autoAssign(db, ref);
  await logActivity(db, `hire:${h.ref}`, `${kind === 'swap' ? 'Swap' : 'Collection'} booked for ${on}.`);
  const warnings = [...a.why];
  if (h.placement === 'road' && h.permit_until && h.permit_until < on) warnings.push(`The council permit ends ${h.permit_until}, before ${on}. Collect sooner or record a new permit.`);
  out(flags, { job: ref, hire: h.ref, on, run: a.assigned, warnings }, (d) => {
    console.log(`${d.job}: ${kind} of ${d.hire} booked for ${dayLabel(d.on)}${d.run ? ` on ${d.run}` : ', on no run yet'}.`);
    for (const w of d.warnings) console.log(`  ! ${w}`);
  });
}

async function cmdRunAssign(db, args, flags) {
  const job = await findJob(db, args[0]);
  const run = await findRun(db, args[1] || str(flags.run));
  if (job.status !== 'booked') throw new CliError(`${job.ref} is ${job.status}.`);
  const { refusals } = await runRefusals(db, job, run.id);
  if (refusals.length) throw new CliError(`${job.ref} cannot go on ${run.ref}:\n${refusals.map((r) => `  - ${r}`).join('\n')}`);
  await db.query('update jobs set run_id = $2, scheduled_on = $3 where id = $1', [job.id, run.id, run.run_on]);
  out(flags, { job: job.ref, run: run.ref, on: run.run_on }, (d) => console.log(`${d.job} on ${d.run} (${dayLabel(d.on)}).`));
}

async function cmdRunDriver(db, args, flags) {
  const run = await findRun(db, args[0]);
  const d = await findDriver(db, args[1] || str(flags.driver));
  const [v] = await db.query('select * from vehicles where id = $1', [run.vehicle_id]);
  const [{ ok }] = await db.query('select licence_rank($1) >= licence_rank($2) as ok', [d.licence_class, v.licence_class]);
  const no = [];
  if (!ok) no.push(`${d.name} holds ${d.licence_class}; the ${v.rego} needs ${v.licence_class} or higher.`);
  if (d.licence_expires_on && d.licence_expires_on < run.run_on) no.push(`${d.name}'s licence ends ${d.licence_expires_on}, before ${run.run_on}.`);
  if (no.length) throw new CliError(`${d.name} cannot drive ${run.ref}:\n${no.map((r) => `  - ${r}`).join('\n')}`);
  await db.query('update runs set driver_id = $2 where id = $1', [run.id, d.id]);
  out(flags, { run: run.ref, driver: d.name }, (x) => console.log(`${x.run}: ${x.driver} driving.`));
}

async function cmdRunDone(db, args, flags) {
  const run = await findRun(db, args[0]);
  const rows = await db.query(`update jobs set status = 'done', done_on = $2 where run_id = $1 and kind = 'lift' and status = 'booked' returning ref`, [run.id, run.run_on]);
  await db.query(`update runs set status = 'closed' where id = $1`, [run.id]);
  out(flags, { run: run.ref, lifts_done: rows.length }, (d) => console.log(`${d.run} closed: ${d.lifts_done} lift(s) marked done. Record the run's tip dockets: tip ${d.run} --stream=... --facility=... --docket=... --tonnes=...`));
}

async function cmdDone(db, args, flags) {
  const job = await findJob(db, args[0]);
  if (job.status !== 'booked') throw new CliError(`${job.ref} is already ${job.status}.`);
  const on = parseDate(flags.on || job.scheduled_on, 'date done');
  if (on > TODAY) throw new CliError(`${on} has not happened yet. Mark a job done on the day it is done.`);
  const [h] = job.hire_id ? await db.query('select * from hires where id = $1', [job.hire_id]) : [null];
  if (job.rpw && job.kind !== 'delivery' && !h.waste_tracker_ref) throw new CliError(`${job.ref} is reportable priority waste with no Waste Tracker record. It cannot be marked moved. Record it first: tracker ${h.ref} --ref=...`);
  if (job.kind === 'delivery') {
    if (h.placement === 'road' && (!h.permit_ref || !h.permit_until || h.permit_until < on)) throw new CliError(`${h.ref} goes on the road and there is no council permit covering ${on}. Record it first: permit ${h.ref} --ref=... --until=...`);
    let binId = h.bin_id;
    if (flags.bin) {
      const [b] = await db.query(`select * from bins where lower(asset_no) = lower($1)`, [str(flags.bin)]);
      if (!b) throw new CliError(`No bin ${flags.bin}.`);
      if (b.bin_type_id !== h.bin_type_id) throw new CliError(`${b.asset_no} is not a ${job.bin_code}.`);
      if (b.status !== 'yard') throw new CliError(`${b.asset_no} is ${b.status}, not in the yard.`);
      binId = b.id;
    }
    if (!binId) {
      const [b] = await db.query(`select id from bins where bin_type_id = $1 and status = 'yard' order by asset_no limit 1`, [h.bin_type_id]);
      if (!b) throw new CliError(`No ${job.bin_code} in the yard. Collect one first, or swap the booking to another size.`);
      binId = b.id;
    }
    await db.query(`update bins set status = 'out' where id = $1`, [binId]);
    await db.query(`update hires set status = 'out', delivered_on = $2, bin_id = $3 where id = $1`, [h.id, on, binId]);
  }
  if (job.kind === 'collect') {
    await db.query(`update hires set status = 'collected', collected_on = $2 where id = $1`, [h.id, on]);
    if (h.bin_id) await db.query(`update bins set status = 'yard' where id = $1`, [h.bin_id]);
  }
  await db.query(`update jobs set status = 'done', done_on = $2, contamination = coalesce($3, contamination) where id = $1`, [job.id, on, str(flags.contamination) || null]);
  const needsTip = job.kind === 'swap' || job.kind === 'collect';
  out(flags, { job: job.ref, done_on: on, needs_tip: needsTip }, (d) => {
    console.log(`${d.job} done ${dayLabel(d.done_on)}.`);
    if (d.needs_tip) console.log(`  Record the tip docket: tip ${d.job} --facility=... --docket=... --tonnes=...`);
  });
}

async function cmdMiss(db, args, flags) {
  const job = await findJob(db, args[0]);
  if (job.status !== 'booked') throw new CliError(`${job.ref} is ${job.status}.`);
  if (!flags.why) throw new CliError('miss <job> --why="gate locked"');
  await db.query(`update jobs set status = 'missed', missed_reason = $2 where id = $1`, [job.id, str(flags.why)]);
  out(flags, { job: job.ref, missed: str(flags.why) }, (d) => console.log(`${d.job} missed: ${d.missed}. Rebook it: rebook ${d.job} --on=...`));
}

async function cmdRebook(db, args, flags) {
  const job = await findJob(db, args[0]);
  if (job.status !== 'missed') throw new CliError(`${job.ref} is ${job.status}, not missed.`);
  const on = parseDate(flags.on || 'tomorrow', 'rebook date');
  const ref = `${job.ref}-R`;
  await db.query(`insert into jobs (ref, kind, hire_id, service_id, customer_id, site_id, stream_id, scheduled_on, notes)
                  select $2, kind, hire_id, service_id, customer_id, site_id, stream_id, $3, 'Rebooked after ' || ref || ' was missed' from jobs where id = $1`, [job.id, ref, on]);
  await db.query('update jobs set followed_up = true where id = $1', [job.id]);
  const a = await autoAssign(db, ref);
  out(flags, { job: ref, from: job.ref, on, run: a.assigned, why: a.why }, (d) => { console.log(`${d.job} booked for ${dayLabel(d.on)}${d.run ? ` on ${d.run}` : ''}.`); for (const w of d.why) console.log(`  ! ${w}`); });
}

async function cmdCancel(db, args, flags) {
  if (!flags.why) throw new CliError('cancel <hire or job> --why="..."');
  const q = args[0] || '';
  if (/^j-|^l-/i.test(q)) {
    const job = await findJob(db, q);
    if (job.status !== 'booked') throw new CliError(`${job.ref} is ${job.status}.`);
    await db.query(`update jobs set status = 'cancelled', cancel_reason = $2, run_id = null where id = $1`, [job.id, str(flags.why)]);
    return out(flags, { cancelled: job.ref }, (d) => console.log(`${d.cancelled} cancelled.`));
  }
  const h = await findHire(db, q);
  if (h.status !== 'booked') throw new CliError(`${h.ref} is ${h.status}. A bin that is out is collected, not cancelled.`);
  await db.query(`update hires set status = 'cancelled', cancel_reason = $2 where id = $1`, [h.id, str(flags.why)]);
  await db.query(`update jobs set status = 'cancelled', cancel_reason = $2, run_id = null where hire_id = $1 and status = 'booked'`, [h.id, str(flags.why)]);
  await logActivity(db, `hire:${h.ref}`, `Cancelled: ${flags.why}`);
  out(flags, { cancelled: h.ref }, (d) => console.log(`${d.cancelled} cancelled.`));
}

async function cmdTip(db, args, flags) {
  const target = args[0];
  if (!flags.docket || !flags.tonnes) throw new CliError('tip <job or run> --docket=<number off the docket> --tonnes=<net weight> [--facility=] [--stream=]');
  const tonnes = parseTonnes(flags.tonnes);
  let job = null;
  let run = null;
  let streamId;
  let on;
  if (/^r-/i.test(target || '')) {
    run = await findRun(db, target);
    if (!flags.stream) throw new CliError('A run tip needs --stream (GEN, MIX, CARD...).');
    streamId = (await findStream(db, str(flags.stream))).id;
    const [{ n }] = await db.query(`select count(*) as n from jobs where run_id = $1 and stream_id = $2 and kind = 'lift' and status = 'done'`, [run.id, streamId]);
    if (!Number(n)) throw new CliError(`${run.ref} has no done lifts of ${flags.stream}. Close the run first: run done ${run.ref}`);
    on = run.run_on;
  } else {
    job = await findJob(db, target);
    if (!['swap', 'collect'].includes(job.kind)) throw new CliError(`${job.ref} is a ${job.kind}. Tips are recorded against a swap, a collection, or a front lift run.`);
    if (job.status !== 'done') throw new CliError(`${job.ref} is ${job.status}. Mark it done first: done ${job.ref}`);
    streamId = job.stream_id;
    on = job.done_on;
    run = job.run_id ? { id: job.run_id } : null;
  }
  const [st] = await db.query('select * from streams where id = $1', [streamId]);
  const fac = flags.facility ? await findFacility(db, str(flags.facility)) : (await db.query('select * from facilities where id = $1', [st.default_facility_id]))[0];
  if (!fac) throw new CliError('Name the facility: --facility=');
  if (st.rpw && !fac.accepts_rpw) throw new CliError(`${fac.name} is not licensed to receive ${st.name.toLowerCase()}. Reportable priority waste goes only to a facility licensed for it.`);
  const [{ rate }] = await db.query('select tip_rate($1, $2, $3) as rate', [fac.id, st.id, on]);
  if (rate === null) throw new CliError(`No tip rate for ${st.name.toLowerCase()} at ${fac.name} on ${on}. Record it: tip-rate set ${fac.ref} ${st.code} --rate=... --from=...`);
  const charge = flags.charge ? parseMoney(flags.charge, 'docket charge') : Math.round(tonnes * rate);
  const [dupe] = await db.query('select ref from tips where facility_id = $1 and docket_no = $2', [fac.id, str(flags.docket)]);
  if (dupe) throw new CliError(`Docket ${flags.docket} from ${fac.name} is already recorded as ${dupe.ref}.`);
  const ref = job ? `T-${job.ref.replace(/^J-/, '')}` : `T-${run.ref || ''}-${st.code}-${str(flags.docket)}`;
  await db.query(`insert into tips (ref, facility_id, stream_id, run_id, job_id, docket_no, tonnes, charge_cents, tipped_on) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                 [ref, fac.id, st.id, run ? run.id : null, job ? job.id : null, str(flags.docket), tonnes, charge, on]);
  let excess = null;
  if (job && job.hire_id) [excess] = await db.query(`select excess_tonnes, excess_cents, total_cents, margin_cents from v_job_totals where job_id = $1`, [job.id]);
  const data = { tip: ref, facility: fac.name, docket: str(flags.docket), tonnes, rate_cents: rate, charge_cents: charge, job: job?.ref || null, run: run?.ref || null, charges: excess };
  out(flags, data, (d) => {
    console.log(`${d.tip}: ${t(d.tonnes)} at ${d.facility}, docket ${d.docket}, ${$$(d.charge_cents)} (${$$(d.rate_cents)} a tonne).`);
    if (d.charges && Number(d.charges.excess_tonnes) > 0) console.log(`  ${t(d.charges.excess_tonnes)} over what the bin includes: ${$$(d.charges.excess_cents)} goes on the invoice. The job now charges ${$$(d.charges.total_cents)} and leaves ${$$(d.charges.margin_cents)}.`);
    else if (d.charges) console.log(`  The job charges ${$$(d.charges.total_cents)} and leaves ${$$(d.charges.margin_cents)} after the tip.`);
  });
}

async function cmdCharge(db, args, flags) {
  const job = await findJob(db, args[0]);
  const amount = parseMoney(flags.amount, 'contamination charge');
  if (amount === null) throw new CliError('charge <job> --amount=<dollars, 0 to waive> [--note="what the driver saw"]');
  if (job.invoice_id) throw new CliError(`${job.ref} is already on an invoice.`);
  await db.query(`update jobs set contamination_cents = $2, contamination = coalesce($3, contamination, 'Contamination') where id = $1`, [job.id, amount, str(flags.note) || null]);
  out(flags, { job: job.ref, contamination_cents: amount }, (d) => console.log(`${d.job}: contamination ${amount ? 'charge ' + $$(amount) : 'waived'}.`));
}

// ---------------------------------------------------------------------------
// Prices and tip rates

async function cmdPriceSet(db, args, flags) {
  const c = await findCustomer(db, args[0]);
  const bt = await findBinType(db, str(flags.bin));
  const st = await findStream(db, str(flags.stream));
  const hire = parseMoney(flags.hire, 'hire price');
  if (hire === null) throw new CliError('price set <customer> --bin=SK10 --stream=GEN --hire=<dollars ex GST>');
  const [existing] = await db.query(`select * from rate_cards where customer_id = $1 and bin_type_id = $2 and stream_id = $3`, [c.id, bt.id, st.id]);
  const list = await rateFor(db, null, bt.id, st.id);
  let ref;
  if (existing) {
    ref = existing.ref;
    await db.query(`update rate_cards set hire_cents = $2, effective_from = current_date where id = $1`, [existing.id, hire]);
  } else {
    ref = `RC-${c.ref.replace('-', '')}-${bt.code}-${st.code}`;
    await db.query(`insert into rate_cards (ref, customer_id, bin_type_id, stream_id, hire_cents, extra_day_cents, excess_tonne_cents) values ($1, $2, $3, $4, $5, $6, $7)`,
                   [ref, c.id, bt.id, st.id, hire, list?.extra_day_cents || 0, list?.excess_tonne_cents || 0]);
  }
  await logActivity(db, `customer:${c.ref}`, `${bt.code} ${st.code} hire price ${existing ? `${$$(existing.hire_cents)} to ` : ''}${$$(hire)} from today.`);
  const [check] = await db.query('select left_pct, target_pct from v_price_check where ref = $1', [ref]);
  out(flags, { price: ref, customer: c.name, hire_cents: hire, was_cents: existing?.hire_cents ?? null, left_pct: check?.left_pct ?? null }, (d) =>
    console.log(`${d.price}: ${d.customer} ${bt.code} ${st.code} now ${$$(d.hire_cents)}${d.was_cents ? ` (was ${$$(d.was_cents)})` : ''}. Leaves ${pct(d.left_pct)} after tipping at today's rate. New bookings use it; hires already booked keep their price.`));
}

async function cmdTipRateSet(db, args, flags) {
  const fac = await findFacility(db, args[0]);
  const st = await findStream(db, args[1] || str(flags.stream));
  const rate = parseMoney(flags.rate, 'tip rate');
  if (rate === null) throw new CliError('tip-rate set <facility> <stream> --rate=<dollars a tonne> [--from=DATE]');
  const from = parseDate(flags.from || 'today', 'effective date');
  await db.query(`insert into tip_rates (facility_id, stream_id, rate_cents, effective_from, source) values ($1, $2, $3, $4, $5)
                  on conflict (facility_id, stream_id, effective_from) do update set rate_cents = excluded.rate_cents, source = excluded.source`,
                 [fac.id, st.id, rate, from, str(flags.source) || 'Entered by the operator']);
  await logActivity(db, `facility:${fac.ref}`, `${st.name} ${$$(rate)} a tonne from ${from}.`);
  const under = await db.query(`select ref, customer, bin_type, stream, left_pct from v_price_check where left_pct < target_pct order by left_pct`);
  out(flags, { facility: fac.name, stream: st.code, rate_cents: rate, from, prices_under_target: under }, (d) => {
    console.log(`${d.facility}: ${st.name.toLowerCase()} ${$$(d.rate_cents)} a tonne from ${dayLabel(d.from)}.`);
    if (d.prices_under_target.length) console.log(`  ${d.prices_under_target.length} price(s) now under target: ${d.prices_under_target.map((p) => `${p.ref} ${pct(p.left_pct)}`).join(', ')}. Run price-check.`);
  });
}

// ---------------------------------------------------------------------------
// Billing

async function cmdBill(db, flags) {
  const to = parseDate(flags.to || 'yesterday', 'bill up to');
  const dry = !!flags['dry-run'];
  const rows = await db.query(`select u.*, j.contamination, j.contamination_cents as set_cents, c.terms_days, h.ref as hire_ref, bt.name as bin_name, st.name as stream_name,
                                      s.address, s.suburb, sv.ref as service_ref, sv.qty, sbt.name as service_bin
                                 from v_unbilled u join jobs j on j.id = u.job_id join customers c on c.id = u.customer_id join streams st on st.id = j.stream_id
                                 join sites s on s.id = j.site_id left join hires h on h.id = j.hire_id left join bin_types bt on bt.id = h.bin_type_id
                                 left join services sv on sv.id = j.service_id left join bin_types sbt on sbt.id = sv.bin_type_id
                                where u.done_on <= $1 order by u.customer, u.done_on, u.ref`, [to]);
  const held = rows.filter((r) => r.contamination && r.set_cents === null);
  const billable = rows.filter((r) => !(r.contamination && r.set_cents === null));
  const byCustomer = new Map();
  for (const r of billable) { if (!byCustomer.has(r.customer_id)) byCustomer.set(r.customer_id, []); byCustomer.get(r.customer_id).push(r); }
  const drafts = [];
  await db.exec('BEGIN');
  try {
    for (const [customerId, jobs] of byCustomer) {
      const ref = await nextRef(db, 'invoices', 'INV-');
      const [inv] = await db.query(`insert into invoices (ref, customer_id, status, notes) values ($1, $2, 'draft', $3) returning id`, [ref, customerId, `Work done to ${to}`]);
      const lines = [];
      for (const j of jobs.filter((x) => x.hire_ref)) {
        const parts = [`${j.hire_ref} ${j.bin_name} ${j.stream_name.toLowerCase()}, ${j.address} ${j.suburb}, ${j.kind} ${j.done_on}`];
        if (Number(j.tonnes)) parts.push(`${j.tonnes} t`);
        if (Number(j.excess_tonnes)) parts.push(`${j.excess_tonnes} t over at ${$$(j.excess_cents / Number(j.excess_tonnes))}/t`);
        if (Number(j.extra_days)) parts.push(`${j.extra_days} extra days`);
        if (Number(j.contamination_cents)) parts.push(`contamination ${$$(j.contamination_cents)}`);
        lines.push({ job_id: j.job_id, description: parts.join('; '), amount_cents: Number(j.total_cents) });
      }
      const lifts = new Map();
      for (const j of jobs.filter((x) => x.service_ref)) { if (!lifts.has(j.service_ref)) lifts.set(j.service_ref, []); lifts.get(j.service_ref).push(j); }
      for (const [sv, js] of lifts) {
        const total = js.reduce((a, j) => a + Number(j.total_cents), 0);
        lines.push({ job_id: null, description: `${sv} ${js[0].qty} x ${js[0].service_bin} ${js[0].stream_name.toLowerCase()}, ${js[0].address} ${js[0].suburb}: ${js.length} lift(s) ${js[0].done_on} to ${js[js.length - 1].done_on}`, amount_cents: total, jobs: js.map((j) => j.job_id) });
      }
      for (const l of lines) await db.query(`insert into invoice_lines (invoice_id, job_id, description, amount_cents) values ($1, $2, $3, $4)`, [inv.id, l.job_id, l.description, l.amount_cents]);
      await db.query(`update jobs set invoice_id = $1 where id = any($2::uuid[])`, [inv.id, jobs.map((j) => j.job_id)]);
      drafts.push({ invoice: ref, customer: jobs[0].customer, lines: lines.length, total_cents: lines.reduce((a, l) => a + l.amount_cents, 0) });
    }
    await db.exec(dry ? 'ROLLBACK' : 'COMMIT');
  } catch (e) { await db.exec('ROLLBACK'); throw e; }
  const data = { to, dry_run: dry, drafts, held_back: held.map((h) => ({ job: h.ref, customer: h.customer, contamination: h.contamination })) };
  out(flags, data, (d) => {
    console.log(heading(`${d.dry_run ? 'Test run: invoices that would be drafted' : 'Draft invoices'} for work done to ${dayLabel(d.to)}`));
    console.log(table(d.drafts, [{ key: 'invoice', label: 'invoice' }, { key: 'customer', label: 'customer' }, { key: 'lines', label: 'lines', align: 'right' }, { key: 'total_cents', label: 'ex GST', align: 'right', format: $$ }]));
    for (const h of d.held_back) console.log(`  ! ${h.job} (${h.customer}) held back: "${h.contamination}" has no charge. Charge it or waive it: charge ${h.job} --amount=...`);
    if (!d.dry_run && d.drafts.length) console.log('\n  Drafts only. Check them (npm run docs -- invoice), then issue each: invoice issue INV-....');
  });
}

async function cmdInvoice(db, sub, args, flags) {
  const [inv] = await db.query(`select i.*, c.terms_days, c.name as customer from invoices i join customers c on c.id = i.customer_id where lower(i.ref) = lower($1)`, [args[0] || '']);
  if (!inv) throw new CliError(`No invoice ${args[0] || ''}.`);
  if (sub === 'issue') {
    if (inv.status !== 'draft') throw new CliError(`${inv.ref} is ${inv.status}.`);
    const on = parseDate(flags.on || 'today', 'issue date');
    const due = addDays(on, Number(inv.terms_days));
    await db.query(`update invoices set status = 'issued', issued_on = $2, due_on = $3 where id = $1`, [inv.id, on, due]);
    return out(flags, { invoice: inv.ref, issued_on: on, due_on: due }, (d) => console.log(`${d.invoice} issued ${dayLabel(d.issued_on)}, due ${dayLabel(d.due_on)}. Send it from your accounts system; this one sends nothing.`));
  }
  if (sub === 'paid') {
    if (inv.status !== 'issued') throw new CliError(`${inv.ref} is ${inv.status}.`);
    const on = parseDate(flags.on || 'today', 'paid date');
    await db.query(`update invoices set status = 'paid', paid_on = $2 where id = $1`, [inv.id, on]);
    const [c] = await db.query(`select credit_hold, (select count(*) from v_invoices v where v.customer_ref = customers.ref and v.days_overdue > 0) as still_overdue from customers where id = $1`, [inv.customer_id]);
    return out(flags, { invoice: inv.ref, paid_on: on, on_hold: c.credit_hold, still_overdue: Number(c.still_overdue) }, (d) => {
      console.log(`${d.invoice} paid ${dayLabel(d.paid_on)}.`);
      if (d.on_hold && !d.still_overdue) console.log(`  ${inv.customer} is still on credit hold with nothing overdue. Release it: release "${inv.customer}"`);
    });
  }
  if (sub === 'void') {
    if (!['draft', 'issued'].includes(inv.status)) throw new CliError(`${inv.ref} is ${inv.status}.`);
    if (!flags.why) throw new CliError('invoice void <ref> --why="..."');
    await db.query(`update invoices set status = 'void', void_reason = $2 where id = $1`, [inv.id, str(flags.why)]);
    await db.query(`update jobs set invoice_id = null where invoice_id = $1`, [inv.id]);
    return out(flags, { invoice: inv.ref, void: true }, (d) => console.log(`${d.invoice} void. Its work is unbilled again and goes on the next bill run.`));
  }
  throw new CliError('invoice issue|paid|void <ref>');
}

async function cmdHold(db, args, flags, on) {
  const c = await findCustomer(db, args[0]);
  if (on && !flags.why) throw new CliError('hold <customer> --why="..."');
  await db.query(`update customers set credit_hold = $2, hold_reason = $3 where id = $1`, [c.id, on, on ? str(flags.why) : null]);
  await logActivity(db, `customer:${c.ref}`, on ? `Put on credit hold: ${flags.why}` : 'Credit hold released.');
  const booked = on ? await db.query(`select ref from hires where customer_id = $1 and status = 'booked'`, [c.id]) : [];
  out(flags, { customer: c.name, credit_hold: on, booked: booked.map((b) => b.ref) }, (d) => {
    console.log(`${d.customer}: ${on ? 'on credit hold' : 'hold released'}.`);
    if (d.booked.length) console.log(`  Already booked: ${d.booked.join(', ')}. Cancel or keep them; the attention list will name them until you decide.`);
  });
}

// ---------------------------------------------------------------------------
// Compliance: the rule book in docs/compliance.md, run against the records

const RULES = {
  'waste-tracker': {
    title: 'Reportable priority waste has a Waste Tracker record before it moves',
    source: 'Environment Protection Act 2017 (Vic) and Environment Protection Regulations 2021, Schedule 7; EPA Victoria Waste Tracker',
    sql: `select ref as record, customer as who, stream || ' ' || status as detail from v_hires where rpw and status in ('booked', 'out') and waste_tracker_ref is null
          union all select h.ref, h.customer, 'moved with no record' from v_hires h where h.rpw and h.status = 'collected' and h.waste_tracker_ref is null`,
  },
  'transport-permission': {
    title: 'Only a truck with a current EPA permission carries reportable priority waste',
    source: 'Environment Protection Regulations 2021 (Vic), permission to transport reportable priority waste (A10a or A10b)',
    sql: `select j.ref as record, r.rego as who, 'on ' || r.run_on || ' with no current permission' as detail
            from jobs j join streams st on st.id = j.stream_id join v_runs r on r.run_id = j.run_id where st.rpw and j.kind <> 'delivery' and j.status = 'booked' and not r.rpw_ok`,
  },
  'road-permit': {
    title: 'A skip on a council road has a permit covering every day it is there, inside the council window',
    source: 'Council local laws, for example the City of Monash skip bin permit (local roads one week, removed on the date set); docs/compliance.md',
    sql: `select ref as record, customer as who, case when permit_ref is null then 'no permit' when permit_until < current_date then 'permit ended ' || permit_until
                 else 'permit window ' || (permit_until - delivered_on) || ' days' end as detail
            from v_hires where placement = 'road' and status = 'out'
             and (permit_ref is null or permit_until < current_date or permit_until - delivered_on > setting_num('road_permit_max_days', 7))
          union all select ref, customer, 'booked for the road with no permit' from v_hires where placement = 'road' and status = 'booked' and permit_ref is null`,
  },
  'driver-licence': {
    title: 'Every run has a driver with a current licence of the truck\'s class',
    source: 'Road Safety Act 1986 (Vic) and the Road Safety (Drivers) Regulations 2019, heavy vehicle licence classes LR, MR, HR, HC, MC',
    sql: `select ref as record, coalesce(driver, 'no driver') as who, 'needs ' || needs_class || ' on ' || run_on as detail from v_runs where status = 'planned' and jobs > 0 and not driver_ok`,
  },
  'registration': {
    title: 'No run uses a truck whose registration has lapsed',
    source: 'Road Safety Act 1986 (Vic), registration of vehicles',
    sql: `select ref as record, rego as who, 'registration lapsed by ' || run_on as detail from v_runs where status = 'planned' and jobs > 0 and not rego_ok`,
  },
  'tip-records': {
    title: 'Every load tipped has its docket: facility, docket number, tonnes and charge',
    source: 'Income Tax Assessment Act 1936 s 262A (records kept five years); the docket is the record of the cost and of the tonnes a customer is charged for',
    sql: `select ref as record, (select name from customers where id = customer_id) as who, kind || ' done ' || done_on || ' with no docket' as detail
            from v_job_totals where no_docket and kind in ('swap', 'collect') and done_on < current_date`,
  },
};

async function cmdCompliance(db, args, flags) {
  const keys = args[0] ? [args[0]] : Object.keys(RULES);
  const results = [];
  for (const k of keys) {
    const rule = RULES[k];
    if (!rule) throw new CliError(`No rule "${k}". Rules: ${Object.keys(RULES).join(', ')}`);
    const rows = await db.query(rule.sql);
    results.push({ rule: k, title: rule.title, source: rule.source, status: rows.length ? 'BREACH' : 'PASS', breaches: rows });
  }
  out(flags, results, (r) => {
    console.log(heading('Compliance'));
    for (const x of r) {
      console.log(`\n  ${x.status.padEnd(6)} ${x.rule}: ${x.title}\n         Source: ${x.source}`);
      for (const b of x.breaches) console.log(`         - ${b.record}  ${b.who}  ${b.detail}`);
    }
    console.log('\n  The rule book and its sources: docs/compliance.md. Not legal advice; change the rules to match your licences and councils.');
  });
}

// ---------------------------------------------------------------------------
// Log and drafts. Drafts land in drafts/; a person sends them.

async function cmdLog(db, args, flags) {
  const [subjectQ, ...words] = args;
  const text = str(flags.text) || words.join(' ');
  if (!subjectQ || !text) throw new CliError('log <customer, hire or run> "what happened"');
  let subject;
  if (/^h-/i.test(subjectQ)) subject = `hire:${(await findHire(db, subjectQ)).ref}`;
  else if (/^r-/i.test(subjectQ)) subject = `run:${(await findRun(db, subjectQ)).ref}`;
  else subject = `customer:${(await findCustomer(db, subjectQ)).ref}`;
  await logActivity(db, subject, text);
  out(flags, { subject, text }, (d) => console.log(`Logged on ${d.subject}.`));
}

function writeDraft(name, body) {
  const dir = path.join(REPO_ROOT, 'drafts');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.md`);
  writeFileSync(file, body);
  return path.relative(REPO_ROOT, file);
}

async function cmdDraft(db, args, flags) {
  const [kind, q] = args;
  const biz = await setting(db, 'business_name', 'Your Business');
  let file;
  let to;
  if (kind === 'overdue') {
    const [i] = await db.query(`select v.*, c.contact_name, c.email from v_invoices v join customers c on c.ref = v.customer_ref where lower(v.ref) = lower($1)`, [q || '']);
    if (!i) throw new CliError(`No invoice ${q || ''}.`);
    if (i.days_overdue <= 0) throw new CliError(`${i.ref} is not overdue.`);
    to = i.email;
    const gst = Number(await setting(db, 'gst_pct', 10));
    const incl = Math.round(Number(i.total_cents) * (1 + gst / 100));
    file = writeDraft(`overdue-${i.ref}`, `To: ${i.email}\nSubject: ${i.ref} from ${biz}, ${$$(incl)} due ${i.due_on}\n\nHi ${(i.contact_name || '').split(' ')[0] || 'there'},\n\nInvoice ${i.ref} for ${$$(incl)} including GST was due on ${i.due_on} and is now ${i.days_overdue} days past its terms. Could you arrange payment this week, or let me know if anything on it needs looking at?\n\nThanks,\n${biz}\n`);
  } else if (kind === 'permit') {
    const h = await findHire(db, q);
    const [v] = await db.query(`select * from v_hires where ref = $1`, [h.ref]);
    const [c] = await db.query(`select * from customers where id = $1`, [h.customer_id]);
    to = c.email;
    file = writeDraft(`permit-${h.ref}`, `To: ${c.email}\nSubject: Your skip at ${v.address}: council permit ends ${v.permit_until}\n\nHi ${(c.contact_name || '').split(' ')[0] || 'there'},\n\nThe council permit for the skip outside ${v.address}, ${v.suburb} runs to ${v.permit_until}. After that it cannot stay on the road. ${v.collect_booked_on ? `We have the collection booked for ${v.collect_booked_on}.` : 'Reply with a time that suits and we will collect it before then, or swap it for an empty one if you need longer, which needs a new permit.'}\n\nThanks,\n${biz}\n`);
  } else if (kind === 'price') {
    const c = await findCustomer(db, q);
    const rows = await db.query(`select * from v_price_check where customer = $1 and left_pct < target_pct`, [c.name]);
    if (!rows.length) throw new CliError(`${c.name}'s prices all leave their target after tipping. Nothing to review.`);
    to = c.email;
    const lines = rows.map((r) => {
      const needed = Math.ceil(Number(r.tip_cost_cents) / (1 - Number(r.target_pct) / 100) / 500) * 500;
      return `- ${r.bin_type} ${r.stream}: ${$$(r.hire_cents)} today. The tip fee for the ${r.included_tonnes} tonnes it includes is now ${$$(r.tip_cost_cents)} (${r.facility} went from ${$$(r.previous_tip_rate_cents)} to ${$$(r.tip_rate_cents)} a tonne). New price from next month: ${$$(needed)} ex GST.`;
    }).join('\n');
    file = writeDraft(`price-review-${c.ref}`, `To: ${c.email}\nSubject: Skip prices from next month, ${c.name}\n\nHi ${(c.contact_name || '').split(' ')[0] || 'there'},\n\nThe facility we tip your bins at has put its rate up, and your current price no longer covers it:\n\n${lines}\n\nEverything else stays the same: the days, the tonnes included and the rate for anything over. Bookings already made keep today's price. Happy to talk it through.\n\nThanks,\n${biz}\n`);
  } else throw new CliError('draft overdue <invoice> | draft permit <hire> | draft price <customer>');
  out(flags, { draft: file, to }, (d) => console.log(`Drafted ${d.draft} (to ${d.to || 'no email on file'}). Nothing was sent.`));
}

// ---------------------------------------------------------------------------
// Import from AMCS Wastedge (or any system that exports customers, sites,
// services and bins to CSV) and export everything.

async function cmdImport(db, args, flags) {
  if ((args[0] || '').toLowerCase() !== 'wastedge') throw new CliError('import wastedge --customers=FILE [--sites=FILE --services=FILE --bins=FILE] [--dry-run]');
  const dry = !!flags['dry-run'];
  const read = (f) => parseCsv(readFileSync(path.resolve(String(f)), 'utf8'));
  const created = { customers: 0, sites: 0, services: 0, bins: 0 };
  const updated = { customers: 0, services: 0 };
  const skipped = [];
  await db.exec('BEGIN');
  try {
    const custByAcct = new Map();
    const custRef = async () => nextRef(db, 'customers', 'C-');
    if (flags.customers) {
      for (const [i, r] of read(flags.customers).entries()) {
        const name = pick(r, 'Customer Name', 'Account Name', 'Customer', 'Name', 'Company');
        if (!name) { skipped.push({ file: 'customers', row: i + 2, why: 'no customer name' }); continue; }
        const acct = pick(r, 'Account No', 'Account Number', 'Account Code', 'Customer Code', 'Account ID') || name;
        const kind = /cash|casual|resident|cod/i.test(pick(r, 'Account Type', 'Type', 'Customer Type')) ? 'casual' : 'account';
        const terms = Number(String(pick(r, 'Terms', 'Payment Terms', 'Terms Days')).replace(/\D/g, '')) || (kind === 'casual' ? 0 : 14);
        const [exist] = await db.query(`select id from customers where lower(name) = lower($1)`, [name]);
        const vals = [pick(r, 'ABN', 'NZBN', 'Business Number') || null, pick(r, 'Contact', 'Contact Name', 'Primary Contact') || null, pick(r, 'Email', 'Email Address', 'Accounts Email') || null, pick(r, 'Phone', 'Mobile', 'Phone Number') || null, terms];
        if (exist) {
          await db.query(`update customers set abn = coalesce($2, abn), contact_name = coalesce($3, contact_name), email = coalesce($4, email), phone = coalesce($5, phone), terms_days = $6 where id = $1`, [exist.id, ...vals]);
          updated.customers++;
          custByAcct.set(acct.toLowerCase(), exist.id);
        } else {
          const [c] = await db.query(`insert into customers (ref, name, kind, abn, contact_name, email, phone, terms_days, notes) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`, [await custRef(), name, kind, ...vals, `Imported from Wastedge account ${acct}`]);
          created.customers++;
          custByAcct.set(acct.toLowerCase(), c.id);
        }
        custByAcct.set(name.toLowerCase(), custByAcct.get(acct.toLowerCase()));
      }
    }
    const customerFor = async (r) => {
      const key = (pick(r, 'Account No', 'Account Number', 'Account Code', 'Customer Code', 'Account ID') || pick(r, 'Customer Name', 'Account Name', 'Customer')).toLowerCase();
      if (custByAcct.has(key)) return custByAcct.get(key);
      const [c] = await db.query(`select id from customers where lower(name) = $1 or lower(ref) = $1 or notes ilike $2`, [key, `%account ${key}`]);
      return c?.id || null;
    };
    const siteFor = async (customerId, r, create) => {
      const address = pick(r, 'Site Address', 'Address', 'Service Address', 'Street');
      if (!address) return null;
      const [s] = await db.query(`select id from sites where customer_id = $1 and lower(address) = lower($2)`, [customerId, address]);
      if (s) return s.id;
      if (!create) return null;
      const [{ n }] = await db.query('select count(*) as n from sites where customer_id = $1', [customerId]);
      const [c] = await db.query('select ref from customers where id = $1', [customerId]);
      const [ns] = await db.query(`insert into sites (ref, customer_id, address, suburb, council, access_notes) values ($1, $2, $3, $4, $5, $6) returning id`,
        [`${c.ref.replace('C-', 'S-')}${String.fromCharCode(65 + Number(n))}`, customerId, address, pick(r, 'Suburb', 'Town', 'City', 'Locality') || '', pick(r, 'Council', 'LGA', 'Local Government Area') || null, pick(r, 'Access Notes', 'Site Notes', 'Driver Notes') || null]);
      created.sites++;
      return ns.id;
    };
    if (flags.sites) {
      for (const [i, r] of read(flags.sites).entries()) {
        const cid = await customerFor(r);
        if (!cid) { skipped.push({ file: 'sites', row: i + 2, why: 'customer not found' }); continue; }
        if (!(await siteFor(cid, r, true))) skipped.push({ file: 'sites', row: i + 2, why: 'no site address' });
      }
    }
    const typeFor = async (v) => {
      const s = String(v || '').trim();
      if (!s) return null;
      const [b] = await db.query(`select * from bin_types where lower(code) = lower($1) or lower(name) = lower($1)`, [s]);
      if (b) return b;
      const m = s.match(/(\d+(?:\.\d+)?)\s*m3?/i);
      const kind = /front|fel/i.test(s) ? 'fel' : /hook/i.test(s) ? 'hook' : /skip/i.test(s) ? 'skip' : null;
      if (!m || !kind) return null;
      const [x] = await db.query(`select * from bin_types where kind = $1 and volume_m3 = $2`, [kind, Number(m[1])]);
      return x || null;
    };
    const streamFor = async (v) => {
      const s = String(v || '').trim();
      if (!s) return null;
      const [x] = await db.query(`select * from streams where lower(code) = lower($1) or name ilike $2`, [s, `%${s}%`]);
      if (x) return x;
      const guess = /general|mixed solid|msw|c&i/i.test(s) ? 'GEN' : /recycl|comingle|co-mingle/i.test(s) ? 'MIX' : /card|paper|occ/i.test(s) ? 'CARD' : /green|garden|organic/i.test(s) ? 'GRN' : /concrete|brick|rubble/i.test(s) ? 'CON' : /asbestos/i.test(s) ? 'ASB' : null;
      if (!guess) return null;
      return (await db.query('select * from streams where code = $1', [guess]))[0];
    };
    if (flags.services) {
      for (const [i, r] of read(flags.services).entries()) {
        const cid = await customerFor(r);
        if (!cid) { skipped.push({ file: 'services', row: i + 2, why: 'customer not found' }); continue; }
        const sid = await siteFor(cid, r, true);
        const bt = await typeFor(pick(r, 'Bin Type', 'Container Type', 'Bin Size', 'Container'));
        const st = await streamFor(pick(r, 'Waste Stream', 'Waste Type', 'Stream', 'Material'));
        if (!sid || !bt || !st) { skipped.push({ file: 'services', row: i + 2, why: !sid ? 'no site address' : !bt ? 'bin type not recognised' : 'waste stream not recognised' }); continue; }
        const days = (pick(r, 'Collection Days', 'Service Days', 'Days', 'Frequency') || '').match(/mon|tue|wed|thu|fri|sat|sun/gi) || [];
        if (!days.length) { skipped.push({ file: 'services', row: i + 2, why: 'no collection days' }); continue; }
        const weekdays = days.map((d) => d[0].toUpperCase() + d.slice(1, 3).toLowerCase()).join(',');
        const lift = parseMoney(pick(r, 'Lift Price', 'Price', 'Rate', 'Charge Per Lift') || '0');
        const [same] = await db.query(`select id from services where site_id = $1 and bin_type_id = $2 and stream_id = $3 and weekdays = $4 and status = 'active'`, [sid, bt.id, st.id, weekdays]);
        if (same) { await db.query('update services set qty = $2, lift_cents = $3 where id = $1', [same.id, Number(pick(r, 'Qty', 'Quantity', 'Bins', 'Number of Bins')) || 1, lift || 0]); updated.services++; continue; }
        const ref = await nextRef(db, 'services', 'SV-', 2);
        await db.query(`insert into services (ref, customer_id, site_id, bin_type_id, stream_id, qty, weekdays, lift_cents) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [ref, cid, sid, bt.id, st.id, Number(pick(r, 'Qty', 'Quantity', 'Bins', 'Number of Bins')) || 1, weekdays, lift || 0]);
        created.services++;
      }
    }
    if (flags.bins) {
      for (const [i, r] of read(flags.bins).entries()) {
        const asset = pick(r, 'Asset No', 'Asset Number', 'Bin Number', 'Serial', 'Asset ID');
        const bt = await typeFor(pick(r, 'Bin Type', 'Container Type', 'Bin Size', 'Container'));
        if (!asset || !bt) { skipped.push({ file: 'bins', row: i + 2, why: !asset ? 'no asset number' : 'bin type not recognised' }); continue; }
        const status = /repair|damage/i.test(pick(r, 'Status', 'Condition')) ? 'repair' : 'yard';
        const res = await db.query(`insert into bins (asset_no, bin_type_id, status) values ($1, $2, $3) on conflict (asset_no) do nothing returning id`, [asset, bt.id, status]);
        if (res.length) created.bins++;
      }
    }
    await db.exec(dry ? 'ROLLBACK' : 'COMMIT');
  } catch (e) { await db.exec('ROLLBACK'); throw e; }
  out(flags, { dry_run: dry, created, updated, skipped }, (d) => {
    console.log(heading(d.dry_run ? 'Test run, nothing saved' : 'Imported from Wastedge'));
    console.log(`  created: ${Object.entries(d.created).map(([k, v]) => `${v} ${k}`).join(', ')}; updated: ${d.updated.customers} customers, ${d.updated.services} services`);
    for (const s of d.skipped) console.log(`  skipped ${s.file} row ${s.row}: ${s.why}`);
    if (!d.dry_run) console.log('\n  Bins out on hire come across as in the yard: book each live hire with book, then done its delivery with the right bin.');
  });
}

async function cmdExport(db, flags) {
  const dir = path.resolve(REPO_ROOT, str(flags.out) || 'exports');
  mkdirSync(dir, { recursive: true });
  const tables = ['customers', 'sites', 'facilities', 'streams', 'tip_rates', 'bin_types', 'bins', 'rate_cards', 'vehicles', 'drivers', 'runs', 'hires', 'services', 'jobs', 'tips', 'invoices', 'invoice_lines', 'activity'];
  const esc = (v) => { if (v === null || v === undefined) return ''; const s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const counts = {};
  for (const tname of tables) {
    const rows = await db.query(`select * from ${tname}`);
    const cols = rows.length ? Object.keys(rows[0]) : [];
    writeFileSync(path.join(dir, `${tname}.csv`), [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n') + '\r\n');
    counts[tname] = rows.length;
  }
  out(flags, { dir: path.relative(REPO_ROOT, dir) || '.', counts }, (d) => console.log(`Exported ${Object.values(d.counts).reduce((a, b) => a + b, 0)} rows across ${tables.length} files to ${d.dir}/.`));
}

// ---------------------------------------------------------------------------

function help() {
  console.log(`waste-collection-for-claude-code

  The day      attention [--rank=N]       today [--date=tomorrow]      runs [--date=]
               run assign <job> <run>     run driver <run> <driver>    run done <run>
  Hires        book <customer> --bin=SK6 --stream=GEN --on=DATE [--site= | --address= --suburb= --council=] [--road --permit= --until=] [--declared=]
               deliver/done <job> [--bin=B-...] [--contamination="..."]   swap <hire> --on=   collect <hire> --on=
               permit <hire> --ref= --until=    tracker <hire> --ref=    cancel <hire|job> --why=    bins [--over | --yard]
  Lifts        services    miss <job> --why=    rebook <job> --on=
  Tips         tip <job|run> --docket= --tonnes= [--facility=] [--stream=]    tip-rates    tip-rate set <facility> <stream> --rate= [--from=]
  Money        margins [--days=30]   price-check [--all]   price set <customer> --bin= --stream= --hire=   charge <job> --amount=
               bill [--to=DATE] [--dry-run]   invoices [--open]   invoice issue|paid|void <ref>   hold <customer> --why=   release <customer>
  Customers    customers   customer <name>   diversion [customer] [--month=YYYY-MM]
               fleet   fleet truck <rego> [--rego-to= --permission= --permission-to=]   fleet driver <name> [--licence-to= --class=]
  Paper        compliance [rule]   log <subject> "text"   history [text]   draft overdue <inv> | permit <hire> | price <customer>
  Settings     settings   setting set <key> <value>
  Moving       import wastedge --customers= [--sites= --services= --bins=] [--dry-run]   export [--out=DIR]   stats

Any read command takes --json. Money in ${CUR} ex GST, tonnes off the dockets.`);
}

// ---------------------------------------------------------------------------
// Main

const { args: argv, flags } = parseArgv(process.argv.slice(2));
const [cmd, ...rest] = argv;
const sub = (rest[0] || '').toLowerCase();

const db = await getDb();
try {
  [{ d: TODAY }] = await db.query(`select current_date::text as d`);
  CUR = await setting(db, 'currency', 'AUD');
  switch ((cmd || 'help').toLowerCase()) {
    case 'help': help(); break;
    case 'stats': await cmdStats(db, flags); break;
    case 'attention': await cmdAttention(db, flags); break;
    case 'today': await cmdToday(db, flags); break;
    case 'runs': await cmdRuns(db, flags); break;
    case 'run':
      if (sub === 'assign') await cmdRunAssign(db, rest.slice(1), flags);
      else if (sub === 'driver') await cmdRunDriver(db, rest.slice(1), flags);
      else if (sub === 'done' || sub === 'close') await cmdRunDone(db, rest.slice(1), flags);
      else throw new CliError('run assign <job> <run> | run driver <run> <driver> | run done <run>');
      break;
    case 'book': await cmdBook(db, rest, flags); break;
    case 'deliver': case 'done': await cmdDone(db, rest, flags); break;
    case 'swap': await bookHireJob(db, 'swap', rest, flags); break;
    case 'collect': await bookHireJob(db, 'collect', rest, flags); break;
    case 'permit': await cmdPermit(db, rest, flags); break;
    case 'tracker': await cmdTracker(db, rest, flags); break;
    case 'cancel': await cmdCancel(db, rest, flags); break;
    case 'miss': await cmdMiss(db, rest, flags); break;
    case 'rebook': await cmdRebook(db, rest, flags); break;
    case 'tip': await cmdTip(db, rest, flags); break;
    case 'charge': await cmdCharge(db, rest, flags); break;
    case 'bins': await cmdBins(db, flags); break;
    case 'services': await cmdServices(db, flags); break;
    case 'customers': await cmdCustomers(db, flags); break;
    case 'customer': await cmdCustomer(db, rest.join(' '), flags); break;
    case 'fleet': if (sub === 'truck' || sub === 'driver') await cmdFleetSet(db, sub, rest.slice(1), flags); else await cmdFleet(db, flags); break;
    case 'margins': await cmdMargins(db, flags); break;
    case 'price-check': await cmdPriceCheck(db, flags); break;
    case 'price':
      if (sub === 'set') await cmdPriceSet(db, rest.slice(1), flags);
      else throw new CliError('price set <customer> --bin= --stream= --hire=');
      break;
    case 'tip-rates': await cmdTipRates(db, flags); break;
    case 'tip-rate':
      if (sub === 'set') await cmdTipRateSet(db, rest.slice(1), flags);
      else throw new CliError('tip-rate set <facility> <stream> --rate= [--from=]');
      break;
    case 'diversion': await cmdDiversion(db, rest.join(' '), flags); break;
    case 'bill': await cmdBill(db, flags); break;
    case 'invoices': await cmdInvoices(db, flags); break;
    case 'invoice': await cmdInvoice(db, sub, rest.slice(1), flags); break;
    case 'hold': await cmdHold(db, rest, flags, true); break;
    case 'release': await cmdHold(db, rest, flags, false); break;
    case 'compliance': await cmdCompliance(db, rest, flags); break;
    case 'log': await cmdLog(db, rest, flags); break;
    case 'settings': case 'setting': await cmdSettings(db, sub, rest.slice(1), flags); break;
    case 'history': await cmdHistory(db, rest.join(' '), flags); break;
    case 'draft': await cmdDraft(db, rest, flags); break;
    case 'import': await cmdImport(db, rest, flags); break;
    case 'export': await cmdExport(db, flags); break;
    default: throw new CliError(`Unknown command "${cmd}". Run with no arguments for the list.`);
  }
} catch (e) {
  if (e instanceof CliError) { console.error(e.message); process.exitCode = e.code; }
  else { console.error(e.stack || e.message); process.exitCode = 2; }
} finally {
  await db.close();
}
