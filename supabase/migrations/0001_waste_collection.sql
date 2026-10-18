-- Waste Collection for Claude Code: the schema.
--
-- A skip bin and commercial collection business the way AMCS Wastedge sells it:
-- customers and their sites, waste streams, the facilities you tip at and what
-- each charges a tonne, bin types and the bins themselves, price lists, skip
-- hires, scheduled commercial lifts, trucks, drivers, daily runs, jobs, tip
-- dockets, invoices and a log. Plain SQL. Works on Postgres and PGlite.
--
-- Money is integer cents, ex GST. Tonnes are numeric. Nothing is deleted:
-- hires and jobs cancel with a reason, customers become former, invoices void.

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Settings: the house rules, in one place the operator changes in plain words.

create table settings (
  key        text primary key,
  value      text not null,
  note       text,
  updated_at timestamptz not null default now()
);

create or replace function setting_num(k text, dflt numeric) returns numeric language sql stable as $$
  select coalesce((select value::numeric from settings where key = k), dflt)
$$;

-- Heavy vehicle licence classes, lowest to highest. A higher class drives everything below it.
create or replace function licence_rank(cls text) returns int language sql immutable as $$
  select case upper(coalesce(cls, '')) when 'C' then 1 when 'LR' then 2 when 'MR' then 3 when 'HR' then 4
                                       when 'HC' then 5 when 'MC' then 6 else 0 end
$$;

-- ---------------------------------------------------------------------------
-- Customers and sites

create table customers (
  id           uuid primary key default gen_random_uuid(),
  ref          text not null unique,
  name         text not null,
  kind         text not null default 'account' check (kind in ('account', 'casual')),
  abn          text,
  contact_name text,
  email        text,
  phone        text,
  terms_days   int not null default 14 check (terms_days >= 0),
  credit_hold  boolean not null default false,
  hold_reason  text,
  status       text not null default 'active' check (status in ('active', 'former')),
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger customers_touch before update on customers for each row execute function touch_updated_at();

create table sites (
  id           uuid primary key default gen_random_uuid(),
  ref          text not null unique,
  customer_id  uuid not null references customers(id),
  address      text not null,
  suburb       text not null,
  council      text,
  access_notes text,
  status       text not null default 'active' check (status in ('active', 'closed')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index sites_customer on sites(customer_id);
create trigger sites_touch before update on sites for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- Streams, facilities and what each facility charges a tonne

create table facilities (
  id          uuid primary key default gen_random_uuid(),
  ref         text not null unique,
  name        text not null,
  kind        text not null check (kind in ('landfill', 'transfer', 'recycler')),
  suburb      text,
  accepts_rpw boolean not null default false,  -- licensed to receive reportable priority waste
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger facilities_touch before update on facilities for each row execute function touch_updated_at();

create table streams (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique,
  name                text not null,
  diverted            boolean not null default false, -- counts towards a customer's diversion from landfill
  rpw                 boolean not null default false, -- reportable priority waste (Victoria): tracked, permitted trucks only
  rpw_code            text,
  default_facility_id uuid references facilities(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger streams_touch before update on streams for each row execute function touch_updated_at();

create table tip_rates (
  id             uuid primary key default gen_random_uuid(),
  facility_id    uuid not null references facilities(id),
  stream_id      uuid not null references streams(id),
  rate_cents     int not null check (rate_cents >= 0),  -- per tonne, ex GST, levy included
  effective_from date not null,
  source         text,
  created_at     timestamptz not null default now(),
  unique (facility_id, stream_id, effective_from)
);

create or replace function tip_rate(f uuid, s uuid, on_day date) returns int language sql stable as $$
  select rate_cents from tip_rates
   where facility_id = f and stream_id = s and effective_from <= on_day
   order by effective_from desc limit 1
$$;

-- ---------------------------------------------------------------------------
-- Bin types, bins, price lists

create table bin_types (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  name            text not null,
  kind            text not null check (kind in ('skip', 'hook', 'fel', 'mgb')),
  volume_m3       numeric not null,
  included_tonnes numeric,       -- tonnes a hire price covers; excess is charged per tonne
  hire_days       int,           -- days a hire price covers; extra days are charged
  licence_class   text not null, -- the lowest licence that drives the truck this bin needs
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger bin_types_touch before update on bin_types for each row execute function touch_updated_at();

create table bins (
  id          uuid primary key default gen_random_uuid(),
  asset_no    text not null unique,
  bin_type_id uuid not null references bin_types(id),
  status      text not null default 'yard' check (status in ('yard', 'out', 'repair', 'retired')),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger bins_touch before update on bins for each row execute function touch_updated_at();

-- A price list row. customer_id null is the list price; a customer row overrides it.
create table rate_cards (
  id                 uuid primary key default gen_random_uuid(),
  ref                text not null unique,
  customer_id        uuid references customers(id),
  bin_type_id        uuid not null references bin_types(id),
  stream_id          uuid not null references streams(id),
  hire_cents         int,   -- one fill: delivery, the included days and tonnes, collection
  extra_day_cents    int not null default 0,
  excess_tonne_cents int not null default 0,
  lift_cents         int,   -- a scheduled lift, per bin
  effective_from     date not null default current_date,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger rate_cards_touch before update on rate_cards for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- Trucks, drivers, runs

create table vehicles (
  id                        uuid primary key default gen_random_uuid(),
  rego                      text not null unique,
  name                      text not null,
  kind                      text not null check (kind in ('skip loader', 'hook lift', 'front lift', 'side lift')),
  licence_class             text not null,
  rego_expires_on           date,
  epa_permission_ref        text,   -- EPA Victoria permission to transport reportable priority waste
  epa_permission_expires_on date,
  status                    text not null default 'active' check (status in ('active', 'workshop', 'sold')),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create trigger vehicles_touch before update on vehicles for each row execute function touch_updated_at();

create table drivers (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null unique,
  licence_class      text not null,
  licence_expires_on date,
  phone              text,
  status             text not null default 'active' check (status in ('active', 'former')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger drivers_touch before update on drivers for each row execute function touch_updated_at();

create table runs (
  id         uuid primary key default gen_random_uuid(),
  ref        text not null unique,
  run_on     date not null,
  vehicle_id uuid not null references vehicles(id),
  driver_id  uuid references drivers(id),
  status     text not null default 'planned' check (status in ('planned', 'closed')),
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_on, vehicle_id)
);
create trigger runs_touch before update on runs for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- Skip hires and scheduled services

create table invoices (
  id          uuid primary key default gen_random_uuid(),
  ref         text not null unique,
  customer_id uuid not null references customers(id),
  issued_on   date,
  due_on      date,
  status      text not null default 'draft' check (status in ('draft', 'issued', 'paid', 'void')),
  paid_on     date,
  void_reason text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger invoices_touch before update on invoices for each row execute function touch_updated_at();

create table hires (
  id                 uuid primary key default gen_random_uuid(),
  ref                text not null unique,
  customer_id        uuid not null references customers(id),
  site_id            uuid not null references sites(id),
  bin_type_id        uuid not null references bin_types(id),
  stream_id          uuid not null references streams(id),
  bin_id             uuid references bins(id),
  status             text not null default 'booked' check (status in ('booked', 'out', 'collected', 'cancelled')),
  deliver_on         date not null,
  delivered_on       date,
  collected_on       date,
  placement          text not null default 'private' check (placement in ('private', 'road')),
  permit_ref         text,   -- council permit for a skip on the road or nature strip
  permit_until       date,
  waste_tracker_ref  text,   -- EPA Waste Tracker record for reportable priority waste
  declared           text,   -- what the customer said is going in
  hire_cents         int not null,
  extra_day_cents    int not null default 0,
  excess_tonne_cents int not null default 0,
  cancel_reason      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index hires_customer on hires(customer_id);
create trigger hires_touch before update on hires for each row execute function touch_updated_at();

create table services (
  id          uuid primary key default gen_random_uuid(),
  ref         text not null unique,
  customer_id uuid not null references customers(id),
  site_id     uuid not null references sites(id),
  bin_type_id uuid not null references bin_types(id),
  stream_id   uuid not null references streams(id),
  qty         int not null default 1 check (qty > 0),
  weekdays    text not null,     -- 'Mon,Thu'
  lift_cents  int not null,      -- per bin, per lift
  status      text not null default 'active' check (status in ('active', 'paused', 'ended')),
  started_on  date not null default current_date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger services_touch before update on services for each row execute function touch_updated_at();

create table jobs (
  id                  uuid primary key default gen_random_uuid(),
  ref                 text not null unique,
  kind                text not null check (kind in ('delivery', 'swap', 'collect', 'lift')),
  hire_id             uuid references hires(id),
  service_id          uuid references services(id),
  customer_id         uuid not null references customers(id),
  site_id             uuid not null references sites(id),
  stream_id           uuid not null references streams(id),
  scheduled_on        date not null,
  run_id              uuid references runs(id),
  status              text not null default 'booked' check (status in ('booked', 'done', 'missed', 'cancelled')),
  done_on             date,
  missed_reason       text,
  followed_up         boolean not null default false,
  contamination       text,
  contamination_cents int,
  invoice_id          uuid references invoices(id),
  cancel_reason       text,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check ((hire_id is null) <> (service_id is null))
);
create index jobs_day on jobs(scheduled_on);
create index jobs_hire on jobs(hire_id);
create index jobs_run on jobs(run_id);
create trigger jobs_touch before update on jobs for each row execute function touch_updated_at();

create table tips (
  id           uuid primary key default gen_random_uuid(),
  ref          text not null unique,
  facility_id  uuid not null references facilities(id),
  stream_id    uuid not null references streams(id),
  run_id       uuid references runs(id),
  job_id       uuid references jobs(id),  -- a skip or hook load; front lift loads tip per run
  docket_no    text not null,
  tonnes       numeric not null check (tonnes > 0),
  charge_cents int not null check (charge_cents >= 0),
  tipped_on    date not null,
  created_at   timestamptz not null default now(),
  unique (facility_id, docket_no)
);
create index tips_job on tips(job_id);
create index tips_run on tips(run_id);

create table invoice_lines (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references invoices(id),
  job_id       uuid references jobs(id),
  description  text not null,
  amount_cents int not null,
  created_at   timestamptz not null default now()
);
create index invoice_lines_invoice on invoice_lines(invoice_id);

create table activity (
  id      uuid primary key default gen_random_uuid(),
  at      timestamptz not null default now(),
  subject text not null,   -- 'customer:C-1001', 'hire:H-2002', 'run:R-...'
  text    text not null
);

-- ---------------------------------------------------------------------------
-- Views: the reads the weekly jobs need

-- Every tip rate in force today, with the one before it.
create view v_tip_rates as
with ranked as (
  select tr.*, row_number() over (partition by facility_id, stream_id order by effective_from desc) as rn
    from tip_rates tr where tr.effective_from <= current_date
)
select f.name as facility, s.code as stream, s.name as stream_name, cur.facility_id, cur.stream_id,
       cur.rate_cents, cur.effective_from as since, prev.rate_cents as previous_cents,
       round((cur.rate_cents - prev.rate_cents) * 100.0 / nullif(prev.rate_cents, 0), 1) as change_pct
  from ranked cur
  join facilities f on f.id = cur.facility_id
  join streams s on s.id = cur.stream_id
  left join ranked prev on prev.facility_id = cur.facility_id and prev.stream_id = cur.stream_id and prev.rn = 2
 where cur.rn = 1;

-- Tonnes and tip cost per job. A skip load tips on its own docket; a front lift
-- run tips once per stream, shared across that run's lifts by bins lifted.
create view v_job_tonnes as
with direct as (
  select job_id, sum(tonnes) as tonnes, sum(charge_cents) as tip_cents from tips where job_id is not null group by job_id
),
run_lifts as (
  select j.id as job_id, j.run_id, j.stream_id, sv.qty,
         sum(sv.qty) over (partition by j.run_id, j.stream_id) as run_qty
    from jobs j join services sv on sv.id = j.service_id
   where j.kind = 'lift' and j.status = 'done' and j.run_id is not null
),
run_tips as (
  select run_id, stream_id, sum(tonnes) as tonnes, sum(charge_cents) as tip_cents
    from tips where job_id is null and run_id is not null group by run_id, stream_id
)
select d.job_id, d.tonnes, d.tip_cents from direct d
union all
select rl.job_id, round(rt.tonnes * rl.qty / rl.run_qty, 3), round(rt.tip_cents::numeric * rl.qty / rl.run_qty)::int
  from run_lifts rl join run_tips rt on rt.run_id = rl.run_id and rt.stream_id = rl.stream_id;

-- What each finished job charges. A fill (swap or collect) is the hire price plus
-- the tonnes over what the bin includes; the collect also carries the days over.
create view v_job_charges as
with fills as (
  select j.*, h.hire_cents, h.excess_tonne_cents, h.extra_day_cents, h.delivered_on, bt.included_tonnes, bt.hire_days,
         coalesce((select max(p.done_on) from jobs p where p.hire_id = j.hire_id and p.kind = 'swap' and p.status = 'done' and p.done_on < j.done_on), h.delivered_on) as period_start
    from jobs j join hires h on h.id = j.hire_id join bin_types bt on bt.id = h.bin_type_id
   where j.kind in ('swap', 'collect') and j.status = 'done'
)
select f.id as job_id, f.ref, f.kind, f.customer_id, f.hire_id, null::uuid as service_id, f.done_on, f.invoice_id,
       f.hire_cents as base_cents,
       coalesce(t.tonnes, 0) as tonnes, coalesce(t.tip_cents, 0) as tip_cents,
       greatest(coalesce(t.tonnes, 0) - coalesce(f.included_tonnes, 0), 0) as excess_tonnes,
       round(greatest(coalesce(t.tonnes, 0) - coalesce(f.included_tonnes, 0), 0) * f.excess_tonne_cents)::int as excess_cents,
       case when f.kind = 'collect' then greatest(f.done_on - f.period_start - coalesce(f.hire_days, 0), 0) else 0 end as extra_days,
       case when f.kind = 'collect' then greatest(f.done_on - f.period_start - coalesce(f.hire_days, 0), 0) * f.extra_day_cents else 0 end as extra_day_total_cents,
       coalesce(f.contamination_cents, 0) as contamination_cents,
       (t.job_id is null) as no_docket
  from fills f left join v_job_tonnes t on t.job_id = f.id
union all
select j.id, j.ref, j.kind, j.customer_id, null, j.service_id, j.done_on, j.invoice_id,
       sv.lift_cents * sv.qty,
       coalesce(t.tonnes, 0), coalesce(t.tip_cents, 0), 0, 0, 0, 0,
       coalesce(j.contamination_cents, 0), (t.job_id is null)
  from jobs j join services sv on sv.id = j.service_id left join v_job_tonnes t on t.job_id = j.id
 where j.kind = 'lift' and j.status = 'done';

create view v_job_totals as
select c.*, (base_cents + excess_cents + extra_day_total_cents + contamination_cents) as total_cents,
       (base_cents + excess_cents + extra_day_total_cents + contamination_cents - tip_cents) as margin_cents
  from v_job_charges c;

-- Every hire with its days, tonnes, takings and tip cost.
create view v_hires as
select h.id as hire_id, h.ref, h.status, c.ref as customer_ref, c.name as customer, s.address, s.suburb, s.council,
       bt.code as bin_type, bt.name as bin_name, st.code as stream, st.rpw, b.asset_no as bin,
       h.deliver_on, h.delivered_on, h.collected_on, h.placement, h.permit_ref, h.permit_until, h.waste_tracker_ref,
       case when h.delivered_on is null then null else coalesce(h.collected_on, current_date) - h.delivered_on end as days_out,
       h.delivered_on + coalesce(bt.hire_days, 0) as due_back,
       case when h.status = 'out' then greatest(current_date - h.delivered_on - coalesce(bt.hire_days, 0), 0) end as days_over,
       h.hire_cents,
       coalesce((select sum(total_cents) from v_job_totals t where t.hire_id = h.id), 0) as billed_cents,
       coalesce((select sum(tip_cents) from v_job_totals t where t.hire_id = h.id), 0) as tip_cents,
       coalesce((select sum(tonnes) from v_job_totals t where t.hire_id = h.id), 0) as tonnes,
       (select min(j.scheduled_on) from jobs j where j.hire_id = h.id and j.kind = 'collect' and j.status = 'booked') as collect_booked_on
  from hires h
  join customers c on c.id = h.customer_id
  join sites s on s.id = h.site_id
  join bin_types bt on bt.id = h.bin_type_id
  join streams st on st.id = h.stream_id
  left join bins b on b.id = h.bin_id;

-- The margin a price list row leaves after tipping the tonnes it includes, at today's tip rate.
create view v_price_check as
select rc.ref, coalesce(c.name, 'List price') as customer, bt.code as bin_type, st.code as stream, rc.hire_cents,
       bt.included_tonnes, vr.facility, vr.rate_cents as tip_rate_cents, vr.previous_cents as previous_tip_rate_cents,
       round(bt.included_tonnes * vr.rate_cents)::int as tip_cost_cents,
       rc.hire_cents - round(bt.included_tonnes * vr.rate_cents)::int as left_cents,
       round((rc.hire_cents - bt.included_tonnes * vr.rate_cents) * 100.0 / nullif(rc.hire_cents, 0), 1) as left_pct,
       setting_num('min_margin_after_tip_pct', 25) as target_pct
  from rate_cards rc
  join bin_types bt on bt.id = rc.bin_type_id
  join streams st on st.id = rc.stream_id
  left join customers c on c.id = rc.customer_id
  join v_tip_rates vr on vr.facility_id = st.default_facility_id and vr.stream_id = st.id
 where rc.hire_cents is not null and bt.included_tonnes is not null;

-- Tonnes by customer, month and stream, and the share kept out of landfill.
create view v_diversion as
select c.id as customer_id, c.ref as customer_ref, c.name as customer,
       date_trunc('month', t.done_on)::date as month,
       round(sum(t.tonnes), 2) as tonnes,
       round(sum(t.tonnes) filter (where st.diverted), 2) as diverted_tonnes,
       round(coalesce(sum(t.tonnes) filter (where st.diverted), 0) * 100.0 / nullif(sum(t.tonnes), 0), 1) as diversion_pct
  from v_job_totals t
  join jobs j on j.id = t.job_id
  join streams st on st.id = j.stream_id
  join customers c on c.id = t.customer_id
 group by c.id, c.ref, c.name, date_trunc('month', t.done_on);

create view v_invoices as
select i.id, i.ref, i.status, c.ref as customer_ref, c.name as customer, i.issued_on, i.due_on, i.paid_on,
       coalesce((select sum(amount_cents) from invoice_lines l where l.invoice_id = i.id), 0) as total_cents,
       case when i.status = 'issued' and i.due_on < current_date then current_date - i.due_on else 0 end as days_overdue
  from invoices i join customers c on c.id = i.customer_id;

create view v_unbilled as
select t.*, c.name as customer, c.ref as customer_ref, current_date - t.done_on as days_since
  from v_job_totals t join customers c on c.id = t.customer_id
 where t.invoice_id is null and t.total_cents > 0;

-- Runs with their truck, driver and whether the paper covers the day.
create view v_runs as
select r.id as run_id, r.ref, r.run_on, r.status, v.rego, v.name as vehicle, v.kind as vehicle_kind, v.licence_class as needs_class,
       d.name as driver, d.licence_class as driver_class,
       (d.id is not null and licence_rank(d.licence_class) >= licence_rank(v.licence_class)
          and (d.licence_expires_on is null or d.licence_expires_on >= r.run_on)) as driver_ok,
       (v.rego_expires_on is null or v.rego_expires_on >= r.run_on) as rego_ok,
       (v.epa_permission_ref is not null and (v.epa_permission_expires_on is null or v.epa_permission_expires_on >= r.run_on)) as rpw_ok,
       (select count(*) from jobs j where j.run_id = r.id and j.status <> 'cancelled') as jobs
  from runs r join vehicles v on v.id = r.vehicle_id left join drivers d on d.id = r.driver_id;

-- Everything that wants a decision, worst first.
--   1  reportable priority waste moving without its paper
--   2  the road, the customer on hold, an unlicensed driver
--   3  bins out too long, lifts missed, loads with no docket
--   4  money leaking: prices under tip cost, tip rates up, paper expiring
--   5  billing: unbilled work, overdue invoices, uncharged contamination
create view v_attention as
select 1 as rank, 'RPW NO TRACKER' as reason, h.ref as label, h.customer as who, h.suburb as place,
       'Reportable priority waste (' || h.stream || ') with no Waste Tracker record. Nothing moves until it has one.' as detail,
       null::int as days
  from v_hires h where h.rpw and h.status in ('booked', 'out') and h.waste_tracker_ref is null
union all
select 1, 'RPW ON UNPERMITTED TRUCK', j.ref, r.rego, r.run_on::text,
       'Reportable priority waste on a truck with no current EPA permission on ' || to_char(r.run_on, 'Dy DD Mon') || '.', null
  from jobs j join streams st on st.id = j.stream_id join v_runs r on r.run_id = j.run_id
 where st.rpw and j.status = 'booked' and not r.rpw_ok
union all
select 2, 'PERMIT EXPIRED', h.ref, h.customer, h.suburb,
       'On the road past its council permit (' || coalesce(h.permit_ref, 'none') || ', ended ' || to_char(h.permit_until, 'DD Mon') || '). Collect it or renew the permit.',
       current_date - h.permit_until
  from v_hires h where h.status = 'out' and h.placement = 'road' and h.permit_until < current_date
union all
select 2, 'NO PERMIT', h.ref, h.customer, h.suburb,
       'Going on the road ' || to_char(h.deliver_on, 'Dy DD Mon') || ' with no council permit recorded.', null
  from v_hires h where h.status = 'booked' and h.placement = 'road' and h.permit_ref is null and h.deliver_on <= current_date + 2
union all
select 2, 'ON HOLD BOOKED', h.ref, c.name, s.suburb,
       'Booked for ' || to_char(h.deliver_on, 'Dy DD Mon') || ' but the customer is on credit hold' || coalesce(': ' || c.hold_reason, '') || '.', null
  from hires h join customers c on c.id = h.customer_id join sites s on s.id = h.site_id
 where h.status = 'booked' and c.credit_hold
union all
select 2, 'DRIVER NOT COVERED', r.ref, coalesce(r.driver, 'no driver'), r.rego,
       'Run on ' || to_char(r.run_on, 'Dy DD Mon') || ' needs a current ' || r.needs_class || ' licence.', null
  from v_runs r where r.status = 'planned' and r.run_on >= current_date and r.jobs > 0 and not r.driver_ok
union all
select 2, 'REGO LAPSED', r.ref, r.vehicle, r.rego,
       'Run on ' || to_char(r.run_on, 'Dy DD Mon') || ' uses a truck whose registration has lapsed by then.', null
  from v_runs r where r.status = 'planned' and r.run_on >= current_date and r.jobs > 0 and not r.rego_ok
union all
select 3, 'NOT ON A RUN', j.ref, c.name, s.suburb,
       'A ' || j.kind || ' booked for ' || to_char(j.scheduled_on, 'Dy DD Mon') || ' is on no run, so no truck will turn up.', null
  from jobs j join customers c on c.id = j.customer_id join sites s on s.id = j.site_id
 where j.status = 'booked' and j.run_id is null and j.scheduled_on <= current_date + 1
union all
select 3, 'PERMIT ENDS', h.ref, h.customer, h.suburb,
       'Council permit ' || h.permit_ref || ' ends ' || to_char(h.permit_until, 'Dy DD Mon') || ' and no collection is booked by then.', null
  from v_hires h
 where h.status = 'out' and h.placement = 'road' and h.permit_until between current_date and current_date + 1
   and (h.collect_booked_on is null or h.collect_booked_on > h.permit_until)
union all
select 3, 'MISSED LIFT', j.ref, c.name, s.suburb,
       'Missed ' || to_char(j.scheduled_on, 'Dy DD Mon') || coalesce(' (' || j.missed_reason || ')', '') || '. Not rebooked.',
       current_date - j.scheduled_on
  from jobs j join customers c on c.id = j.customer_id join sites s on s.id = j.site_id
 where j.kind = 'lift' and j.status = 'missed' and not j.followed_up
union all
select 3, 'NO TIP DOCKET', t.ref, c.name, null,
       'A ' || t.kind || ' done ' || to_char(t.done_on, 'Dy DD Mon') || ' with no tip docket: no tonnes, no excess, no cost.',
       current_date - t.done_on
  from v_job_totals t join customers c on c.id = t.customer_id
 where t.no_docket and t.kind in ('swap', 'collect') and t.done_on < current_date
union all
select 3, 'OVER HIRE', h.ref, h.customer, h.suburb,
       h.bin_type || ' out ' || h.days_out || ' days, ' || h.days_over || ' past what the hire covers.', h.days_over
  from v_hires h where h.status = 'out' and h.days_over > 0
union all
select 4, 'PRICE UNDER TIP COST', p.ref, p.customer, p.bin_type || ' ' || p.stream,
       'Leaves ' || p.left_pct || '% after tipping the included ' || p.included_tonnes || ' t at today''s rate, against ' || p.target_pct || '%.', null
  from v_price_check p where p.left_pct < p.target_pct
union all
select 4, 'TIP RATE UP', r.stream, r.facility, null,
       r.stream_name || ' up ' || r.change_pct || '% since ' || to_char(r.since, 'DD Mon') || '.', current_date - r.since
  from v_tip_rates r where r.change_pct > 0 and r.since >= current_date - 30
union all
select 4, 'PERMISSION EXPIRING', v.rego, v.name, null,
       'EPA permission ' || v.epa_permission_ref || ' ends ' || to_char(v.epa_permission_expires_on, 'DD Mon YYYY') || '.',
       v.epa_permission_expires_on - current_date
  from vehicles v where v.status = 'active' and v.epa_permission_expires_on between current_date and current_date + setting_num('expiry_warn_days', 30)::int
union all
select 4, 'REGO EXPIRING', v.rego, v.name, null,
       'Registration ends ' || to_char(v.rego_expires_on, 'DD Mon YYYY') || '.', v.rego_expires_on - current_date
  from vehicles v where v.status = 'active' and v.rego_expires_on between current_date and current_date + setting_num('expiry_warn_days', 30)::int
union all
select 4, 'LICENCE EXPIRING', d.name, d.name, null,
       d.licence_class || ' licence ends ' || to_char(d.licence_expires_on, 'DD Mon YYYY') || '.', d.licence_expires_on - current_date
  from drivers d where d.status = 'active' and d.licence_expires_on between current_date and current_date + setting_num('expiry_warn_days', 30)::int
union all
select 5, 'UNBILLED', u.ref, u.customer, null,
       'Done ' || to_char(u.done_on, 'DD Mon') || ', ' || to_char(u.total_cents / 100.0, 'FM$999,990.00') || ' not on an invoice yet.', u.days_since
  from v_unbilled u where u.kind <> 'lift' and u.days_since > setting_num('unbilled_days', 7)
union all
select 5, 'INVOICE OVERDUE', i.ref, i.customer, null,
       to_char(i.total_cents / 100.0, 'FM$999,990.00') || ' due ' || to_char(i.due_on, 'DD Mon') || ', ' || i.days_overdue || ' days overdue.', i.days_overdue
  from v_invoices i where i.status = 'issued' and i.days_overdue > 0
union all
select 5, 'CONTAMINATION NOT CHARGED', j.ref, c.name, null,
       'Driver noted "' || j.contamination || '" and no charge was set.', current_date - j.done_on
  from jobs j join customers c on c.id = j.customer_id
 where j.status = 'done' and j.contamination is not null and j.contamination_cents is null and j.invoice_id is null;

alter table settings enable row level security;
alter table customers enable row level security;
alter table sites enable row level security;
alter table facilities enable row level security;
alter table streams enable row level security;
alter table tip_rates enable row level security;
alter table bin_types enable row level security;
alter table bins enable row level security;
alter table rate_cards enable row level security;
alter table vehicles enable row level security;
alter table drivers enable row level security;
alter table runs enable row level security;
alter table invoices enable row level security;
alter table hires enable row level security;
alter table services enable row level security;
alter table jobs enable row level security;
alter table tips enable row level security;
alter table invoice_lines enable row level security;
alter table activity enable row level security;
