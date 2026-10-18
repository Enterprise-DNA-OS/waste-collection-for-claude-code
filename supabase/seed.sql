-- Demo data: Bayside Bins and Recycling, a fictional skip bin and commercial
-- collection business in Melbourne's south-east with a skip loader, a hook
-- lift and a front lift truck. Five weeks of runs behind, a week ahead.
--
-- Every date is relative to current_date, so the demo tells the same story
-- whatever day it runs. Ids derive from md5 of a natural key and every insert
-- is ON CONFLICT DO NOTHING, so loading it twice is harmless.
--
-- Deliberately wrong, so /attention has something to say: an asbestos skip due
-- for collection tomorrow with no Waste Tracker record, a skip on the road three
-- days past its council permit, a road delivery with no permit, a booking for a
-- customer on credit hold, a missed lift, a collection with no tip docket, a
-- builder's price that the tip rate rise has eaten, two overdue invoices and
-- plasterboard in a recycling skip that nobody charged for.

insert into settings (key, value, note) values
  ('business_name', 'Bayside Bins and Recycling', 'On every document and view'),
  ('currency', 'AUD', 'All money is ex GST'),
  ('gst_pct', '10', 'Added on tax invoices'),
  ('state', 'VIC', 'Which rule book /compliance reads'),
  ('min_margin_after_tip_pct', '25', 'A hire price must leave this share after tipping its included tonnes'),
  ('road_permit_max_days', '7', 'Longest council permit window for a skip on a local road'),
  ('unbilled_days', '7', 'Finished hire work older than this and not invoiced is flagged'),
  ('expiry_warn_days', '30', 'Warn this many days before a licence, rego or EPA permission ends')
on conflict (key) do nothing;

-- Facilities
insert into facilities (id, ref, name, kind, suburb, accepts_rpw) values
  (md5('f:SVL')::uuid, 'SVL', 'Southvale Landfill', 'landfill', 'Clayton South', false),
  (md5('f:KRR')::uuid, 'KRR', 'Kingsmere Resource Recovery', 'transfer', 'Dandenong South', false),
  (md5('f:FPR')::uuid, 'FPR', 'Fibreline Paper Recovery', 'recycler', 'Braeside', false),
  (md5('f:BCC')::uuid, 'BCC', 'Brickfield Concrete Crushing', 'recycler', 'Keysborough', false),
  (md5('f:RLA')::uuid, 'RLA', 'Redgum Lane Licensed Landfill', 'landfill', 'Lyndhurst', true)
on conflict do nothing;

-- Streams
insert into streams (id, code, name, diverted, rpw, rpw_code, default_facility_id) values
  (md5('s:GEN')::uuid, 'GEN', 'General waste', false, false, null, md5('f:SVL')::uuid),
  (md5('s:MIX')::uuid, 'MIX', 'Mixed recycling', true, false, null, md5('f:KRR')::uuid),
  (md5('s:CARD')::uuid, 'CARD', 'Cardboard and paper', true, false, null, md5('f:FPR')::uuid),
  (md5('s:GRN')::uuid, 'GRN', 'Green waste', true, false, null, md5('f:KRR')::uuid),
  (md5('s:CON')::uuid, 'CON', 'Clean concrete and brick', true, false, null, md5('f:BCC')::uuid),
  (md5('s:ASB')::uuid, 'ASB', 'Asbestos, bonded and wrapped', false, true, 'N220', md5('f:RLA')::uuid)
on conflict do nothing;

-- Tip rates, a tonne, ex GST, levy included. General waste and concrete went up this month.
insert into tip_rates (facility_id, stream_id, rate_cents, effective_from, source) values
  (md5('f:SVL')::uuid, md5('s:GEN')::uuid, 15800, current_date - 400, 'Southvale gate rates'),
  (md5('f:SVL')::uuid, md5('s:GEN')::uuid, 17200, current_date - 20, 'Southvale notice to account holders'),
  (md5('f:KRR')::uuid, md5('s:GEN')::uuid, 18500, current_date - 400, 'Kingsmere account rates'),
  (md5('f:KRR')::uuid, md5('s:MIX')::uuid, 9500, current_date - 400, 'Kingsmere account rates'),
  (md5('f:KRR')::uuid, md5('s:GRN')::uuid, 8000, current_date - 400, 'Kingsmere account rates'),
  (md5('f:FPR')::uuid, md5('s:CARD')::uuid, 4000, current_date - 400, 'Fibreline account rates'),
  (md5('f:BCC')::uuid, md5('s:CON')::uuid, 3500, current_date - 400, 'Brickfield gate rates'),
  (md5('f:BCC')::uuid, md5('s:CON')::uuid, 4500, current_date - 14, 'Brickfield gate rates'),
  (md5('f:RLA')::uuid, md5('s:ASB')::uuid, 39000, current_date - 400, 'Redgum Lane licensed rates')
on conflict do nothing;

-- Bin types and bins
insert into bin_types (id, code, name, kind, volume_m3, included_tonnes, hire_days, licence_class) values
  (md5('bt:SK4')::uuid, 'SK4', '4 m3 skip', 'skip', 4, 1.0, 7, 'MR'),
  (md5('bt:SK6')::uuid, 'SK6', '6 m3 skip', 'skip', 6, 1.5, 7, 'MR'),
  (md5('bt:SK10')::uuid, 'SK10', '10 m3 skip', 'skip', 10, 2.5, 7, 'MR'),
  (md5('bt:HK15')::uuid, 'HK15', '15 m3 hook lift bin', 'hook', 15, 4.0, 14, 'HR'),
  (md5('bt:FEL3')::uuid, 'FEL3', '3 m3 front lift bin', 'fel', 3, null, null, 'HR')
on conflict do nothing;

insert into bins (id, asset_no, bin_type_id, status)
select md5('b:' || a)::uuid, a, md5('bt:' || t)::uuid, 'yard'
  from (values ('B-401','SK4'),('B-402','SK4'),('B-403','SK4'),('B-404','SK4'),('B-405','SK4'),('B-406','SK4'),
               ('B-601','SK6'),('B-602','SK6'),('B-603','SK6'),('B-604','SK6'),('B-605','SK6'),('B-606','SK6'),('B-607','SK6'),('B-608','SK6'),
               ('B-1001','SK10'),('B-1002','SK10'),('B-1003','SK10'),('B-1004','SK10'),
               ('B-1501','HK15'),('B-1502','HK15'),('B-1503','HK15'),
               ('B-3001','FEL3'),('B-3002','FEL3'),('B-3003','FEL3'),('B-3004','FEL3'),('B-3005','FEL3'),
               ('B-3006','FEL3'),('B-3007','FEL3'),('B-3008','FEL3'),('B-3009','FEL3'),('B-3010','FEL3')) as v(a, t)
on conflict do nothing;

-- Customers and sites
insert into customers (id, ref, name, kind, abn, contact_name, email, phone, terms_days, credit_hold, hold_reason) values
  (md5('c:C-1001')::uuid, 'C-1001', 'Coastline Homes', 'account', '41 600 111 222', 'Mark Delaney', 'accounts@coastlinehomes.example', '03 9000 1001', 30, false, null),
  (md5('c:C-1002')::uuid, 'C-1002', 'Mentone Bakehouse', 'account', null, 'Sofia Russo', 'sofia@mentonebakehouse.example', '03 9000 1002', 14, false, null),
  (md5('c:C-1003')::uuid, 'C-1003', 'Cheltenham Medical Centre', 'account', null, 'Practice manager', 'admin@cheltmed.example', '03 9000 1003', 14, false, null),
  (md5('c:C-1004')::uuid, 'C-1004', 'Harbourline Demolition', 'account', '73 600 333 444', 'Gus Petrakis', 'gus@harbourline.example', '03 9000 1004', 30, false, null),
  (md5('c:C-1005')::uuid, 'C-1005', 'Kowal Landscapes', 'account', null, 'Ania Kowal', 'ania@kowal.example', '0400 000 105', 14, true, 'INV-2995 overdue'),
  (md5('c:C-1006')::uuid, 'C-1006', 'Jenny Marsh', 'casual', null, 'Jenny Marsh', 'jenny.marsh@example.com', '0400 000 106', 0, false, null),
  (md5('c:C-1007')::uuid, 'C-1007', 'Arjun Patel', 'casual', null, 'Arjun Patel', 'arjun.p@example.com', '0400 000 107', 0, false, null),
  (md5('c:C-1008')::uuid, 'C-1008', 'Seabreeze Primary School', 'account', null, 'Business manager', 'office@seabreezeps.example', '03 9000 1008', 30, false, null),
  (md5('c:C-1009')::uuid, 'C-1009', 'Carnegie Fitouts', 'account', null, 'Leah Tran', 'leah@carnegiefitouts.example', '03 9000 1009', 14, false, null),
  (md5('c:C-1010')::uuid, 'C-1010', 'Moorabbin Motors', 'account', null, 'Rob Hale', 'rob@moorabbinmotors.example', '03 9000 1010', 14, false, null),
  (md5('c:C-1011')::uuid, 'C-1011', 'Ruth Okafor', 'casual', null, 'Ruth Okafor', 'ruth.okafor@example.com', '0400 000 111', 0, false, null)
on conflict do nothing;

insert into sites (id, ref, customer_id, address, suburb, council, access_notes) values
  (md5('st:S-1001A')::uuid, 'S-1001A', md5('c:C-1001')::uuid, '14 Seaview Road', 'Mentone', 'Kingston', 'New build, skip on the road, site gate faces the street'),
  (md5('st:S-1001B')::uuid, 'S-1001B', md5('c:C-1001')::uuid, '3 Lagoon Street', 'Parkdale', 'Kingston', null),
  (md5('st:S-1001C')::uuid, 'S-1001C', md5('c:C-1001')::uuid, '22 Bay Road', 'Aspendale', 'Kingston', 'Driveway, watch the low eave'),
  (md5('st:S-1002A')::uuid, 'S-1002A', md5('c:C-1002')::uuid, '88 Como Parade West', 'Mentone', 'Kingston', 'Bins in the rear lane, lift before 7am'),
  (md5('st:S-1003A')::uuid, 'S-1003A', md5('c:C-1003')::uuid, '5 Charman Road', 'Cheltenham', 'Bayside', 'Gate code 4471, locked after 6pm'),
  (md5('st:S-1004A')::uuid, 'S-1004A', md5('c:C-1004')::uuid, '41 Park Road', 'Cheltenham', 'Kingston', 'Demolition site, hard hat and hi-vis'),
  (md5('st:S-1005A')::uuid, 'S-1005A', md5('c:C-1005')::uuid, '9 Keys Road', 'Moorabbin', 'Kingston', null),
  (md5('st:S-1006A')::uuid, 'S-1006A', md5('c:C-1006')::uuid, '17 Graham Road', 'Highett', 'Bayside', 'Skip on the road outside'),
  (md5('st:S-1007A')::uuid, 'S-1007A', md5('c:C-1007')::uuid, '6 Atkinson Street', 'Oakleigh', 'Monash', 'Skip on the road outside'),
  (md5('st:S-1008A')::uuid, 'S-1008A', md5('c:C-1008')::uuid, '1 Seabreeze Avenue', 'Hampton', 'Bayside', 'Enter by the service gate, not during drop-off'),
  (md5('st:S-1009A')::uuid, 'S-1009A', md5('c:C-1009')::uuid, '120 Koornang Road', 'Carnegie', 'Glen Eira', 'Loading bay at the rear'),
  (md5('st:S-1010A')::uuid, 'S-1010A', md5('c:C-1010')::uuid, '300 South Road', 'Moorabbin', 'Kingston', null),
  (md5('st:S-1011A')::uuid, 'S-1011A', md5('c:C-1011')::uuid, '4 Dendy Street', 'Brighton', 'Bayside', 'Skip on the road outside')
on conflict do nothing;

-- Price lists. The list price, then the deals.
insert into rate_cards (id, ref, customer_id, bin_type_id, stream_id, hire_cents, extra_day_cents, excess_tonne_cents, lift_cents, effective_from)
select md5('rc:' || r)::uuid, r, null, md5('bt:' || bt)::uuid, md5('s:' || s)::uuid, hire, xd, xt, lift, current_date - 400
  from (values
    ('RC-SK4-GEN','SK4','GEN',34500,1500,22000,null), ('RC-SK4-MIX','SK4','MIX',30000,1500,16000,null),
    ('RC-SK4-GRN','SK4','GRN',29000,1500,13000,null), ('RC-SK4-CON','SK4','CON',28000,1500,6000,null),
    ('RC-SK4-ASB','SK4','ASB',69000,2500,48000,null),
    ('RC-SK6-GEN','SK6','GEN',49500,1500,22000,null), ('RC-SK6-MIX','SK6','MIX',42000,1500,16000,null),
    ('RC-SK6-GRN','SK6','GRN',40000,1500,13000,null), ('RC-SK6-CON','SK6','CON',38000,1500,6000,null),
    ('RC-SK10-GEN','SK10','GEN',69000,1500,22000,null), ('RC-SK10-MIX','SK10','MIX',56000,1500,16000,null),
    ('RC-SK10-GRN','SK10','GRN',52000,1500,13000,null), ('RC-SK10-CON','SK10','CON',48000,1500,6000,null),
    ('RC-HK15-GEN','HK15','GEN',115000,2500,22000,null), ('RC-HK15-MIX','HK15','MIX',90000,2500,16000,null),
    ('RC-HK15-CON','HK15','CON',72000,2500,6000,null),
    ('RC-FEL3-GEN','FEL3','GEN',null,0,0,8500), ('RC-FEL3-MIX','FEL3','MIX',null,0,0,4500),
    ('RC-FEL3-CARD','FEL3','CARD',null,0,0,3000)
  ) as v(r, bt, s, hire, xd, xt, lift)
on conflict do nothing;

insert into rate_cards (id, ref, customer_id, bin_type_id, stream_id, hire_cents, extra_day_cents, excess_tonne_cents, effective_from) values
  (md5('rc:RC-C1001-SK10-GEN')::uuid, 'RC-C1001-SK10-GEN', md5('c:C-1001')::uuid, md5('bt:SK10')::uuid, md5('s:GEN')::uuid, 52000, 1500, 22000, current_date - 300),
  (md5('rc:RC-C1001-SK6-GEN')::uuid, 'RC-C1001-SK6-GEN', md5('c:C-1001')::uuid, md5('bt:SK6')::uuid, md5('s:GEN')::uuid, 43000, 1500, 22000, current_date - 300)
on conflict do nothing;

-- Trucks and drivers. The skip loader's EPA permission and Priya's licence end soon; the hook lift's rego too.
insert into vehicles (id, rego, name, kind, licence_class, rego_expires_on, epa_permission_ref, epa_permission_expires_on) values
  (md5('v:SK')::uuid, '1CL-4KS', 'Skip loader', 'skip loader', 'MR', current_date + 200, 'A10b-70231', current_date + 12),
  (md5('v:HK')::uuid, '1HK-9ZT', 'Hook lift', 'hook lift', 'HR', current_date + 25, null, null),
  (md5('v:FL')::uuid, '2FL-7MB', 'Front lift', 'front lift', 'HR', current_date + 300, null, null)
on conflict do nothing;

insert into drivers (id, name, licence_class, licence_expires_on, phone) values
  (md5('d:Tom Reyes')::uuid, 'Tom Reyes', 'MR', current_date + 600, '0400 000 201'),
  (md5('d:Priya Nair')::uuid, 'Priya Nair', 'MR', current_date + 19, '0400 000 202'),
  (md5('d:Dave Kowalski')::uuid, 'Dave Kowalski', 'HR', current_date + 400, '0400 000 203'),
  (md5('d:Sione Fifita')::uuid, 'Sione Fifita', 'HR', current_date + 800, '0400 000 204')
on conflict do nothing;

-- Runs: skip loader and hook lift every day, the front lift on weekdays, five weeks back and a week ahead.
insert into runs (id, ref, run_on, vehicle_id, driver_id, status)
select md5('run:' || d::date || ':' || v.code)::uuid, 'R-' || to_char(d, 'YYMMDD') || '-' || v.code, d::date,
       md5('v:' || v.code)::uuid,
       md5('d:' || case when v.code = 'SK' and d::date = current_date + 1 then 'Priya Nair' else v.driver end)::uuid,
       case when d::date < current_date then 'closed' else 'planned' end
  from generate_series(current_date - 70, current_date + 7, interval '1 day') as d
  cross join (values ('SK', 'Tom Reyes'), ('HK', 'Dave Kowalski'), ('FL', 'Sione Fifita')) as v(code, driver)
 where v.code <> 'FL' or extract(isodow from d) < 6
on conflict do nothing;

-- Invoices first (hires and jobs point at them)
insert into invoices (id, ref, customer_id, issued_on, due_on, status) values
  (md5('i:INV-2990')::uuid, 'INV-2990', md5('c:C-1010')::uuid, current_date - 56, current_date - 42, 'issued'),
  (md5('i:INV-2995')::uuid, 'INV-2995', md5('c:C-1005')::uuid, current_date - 43, current_date - 29, 'issued'),
  (md5('i:INV-3001')::uuid, 'INV-3001', md5('c:C-1001')::uuid, current_date - 12, current_date + 18, 'issued')
on conflict do nothing;

-- Skip and hook hires
insert into hires (id, ref, customer_id, site_id, bin_type_id, stream_id, bin_id, status, deliver_on, delivered_on, collected_on,
                   placement, permit_ref, permit_until, waste_tracker_ref, declared, hire_cents, extra_day_cents, excess_tonne_cents)
select md5('h:' || r)::uuid, r, md5('c:' || c)::uuid, md5('st:' || s)::uuid, md5('bt:' || bt)::uuid, md5('s:' || st)::uuid,
       md5('b:' || b)::uuid, status, current_date + dv, current_date + dd, current_date + dc,
       placement, permit, current_date + pu, null, declared, hire, xd, xt
  from (values
    ('H-1990','C-1010','S-1010A','SK6','GEN','B-601','collected',-65,-65,-58,'private',null,null,'Workshop clean-out',49500,1500,22000),
    ('H-1995','C-1005','S-1005A','SK6','GRN','B-602','collected',-50,-50,-44,'private',null,null,'Prunings and turf',40000,1500,13000),
    ('H-2001','C-1009','S-1009A','SK10','MIX','B-1001','collected',-16,-16,-10,'private',null,null,'Shop fitout strip-out, timber and metal',56000,1500,16000),
    ('H-2002','C-1001','S-1001A','SK10','GEN','B-1002','out',-4,-4,null,'road','KIN-SBP-4471',3,'Build waste',52000,1500,22000),
    ('H-2003','C-1001','S-1001B','SK10','GEN','B-1003','collected',-20,-20,-13,'private',null,null,'Build waste',52000,1500,22000),
    ('H-2004','C-1001','S-1001B','SK6','GEN','B-603','collected',-30,-30,-24,'private',null,null,'Build waste',43000,1500,22000),
    ('H-2005','C-1004','S-1004A','SK4','ASB','B-402','out',-3,-3,null,'private',null,null,'Bonded asbestos eaves sheeting, wrapped',69000,2500,48000),
    ('H-2006','C-1004','S-1004A','HK15','CON','B-1501','out',-9,-9,null,'private',null,null,'Slab and brick from demolition',72000,2500,6000),
    ('H-2007','C-1006','S-1006A','SK4','GEN','B-403','out',-12,-12,null,'road','BAY-SKP-0921',-3,'Garage clean-out',34500,1500,22000),
    ('H-2008','C-1007','S-1007A','SK6','GEN','B-604','out',-6,-6,null,'road','MON-SBP-7720',1,'Bathroom renovation',49500,1500,22000),
    ('H-2009','C-1005','S-1005A','SK6','GRN',null,'booked',1,null,null,'private',null,null,'Garden clearance',40000,1500,13000),
    ('H-2010','C-1011','S-1011A','SK4','GEN',null,'booked',2,null,null,'road',null,null,'Moving house',34500,1500,22000),
    ('H-2011','C-1001','S-1001C','SK6','GEN','B-605','collected',-7,-7,-2,'private',null,null,'Build waste',43000,1500,22000),
    ('H-2012','C-1009','S-1009A','SK6','MIX','B-606','collected',-8,-8,-1,'private',null,null,'Fitout offcuts',42000,1500,16000)
  ) as v(r, c, s, bt, st, b, status, dv, dd, dc, placement, permit, pu, declared, hire, xd, xt)
on conflict do nothing;

update bins set status = 'out' where asset_no in ('B-1002', 'B-402', 'B-1501', 'B-403', 'B-604') and status = 'yard';
update bins set status = 'repair', notes = 'Door hinge cracked' where asset_no = 'B-607' and status = 'yard';

-- Hire jobs: delivery, swap, collect, on the right truck's run for the day
insert into jobs (id, ref, kind, hire_id, customer_id, site_id, stream_id, scheduled_on, run_id, status, done_on, contamination)
select md5('j:' || j.ref)::uuid, j.ref, j.kind, h.id, h.customer_id, h.site_id, h.stream_id, current_date + j.d,
       md5('run:' || (current_date + j.d) || ':' || case when bt.kind = 'hook' then 'HK' else 'SK' end)::uuid,
       j.status, case when j.status = 'done' then current_date + j.d end, j.contamination
  from (values
    ('J-H-1990-D','H-1990','delivery',-65,'done',null), ('J-H-1990-C','H-1990','collect',-58,'done',null),
    ('J-H-1995-D','H-1995','delivery',-50,'done',null), ('J-H-1995-C','H-1995','collect',-44,'done',null),
    ('J-H-2001-D','H-2001','delivery',-16,'done',null), ('J-H-2001-C','H-2001','collect',-10,'done',null),
    ('J-H-2002-D','H-2002','delivery',-4,'done',null),
    ('J-H-2003-D','H-2003','delivery',-20,'done',null), ('J-H-2003-C','H-2003','collect',-13,'done',null),
    ('J-H-2004-D','H-2004','delivery',-30,'done',null), ('J-H-2004-C','H-2004','collect',-24,'done',null),
    ('J-H-2005-D','H-2005','delivery',-3,'done',null), ('J-H-2005-C','H-2005','collect',1,'booked',null),
    ('J-H-2006-D','H-2006','delivery',-9,'done',null), ('J-H-2006-S1','H-2006','swap',-4,'done',null),
    ('J-H-2007-D','H-2007','delivery',-12,'done',null),
    ('J-H-2008-D','H-2008','delivery',-6,'done',null),
    ('J-H-2009-D','H-2009','delivery',1,'booked',null),
    ('J-H-2010-D','H-2010','delivery',2,'booked',null),
    ('J-H-2011-D','H-2011','delivery',-7,'done',null), ('J-H-2011-C','H-2011','collect',-2,'done',null),
    ('J-H-2012-D','H-2012','delivery',-8,'done',null), ('J-H-2012-C','H-2012','collect',-1,'done','Plasterboard in the recycling')
  ) as j(ref, hire, kind, d, status, contamination)
  join hires h on h.ref = j.hire
  join bin_types bt on bt.id = h.bin_type_id
on conflict do nothing;

update jobs set invoice_id = md5('i:INV-2990')::uuid where ref = 'J-H-1990-C' and invoice_id is null;
update jobs set invoice_id = md5('i:INV-2995')::uuid where ref = 'J-H-1995-C' and invoice_id is null;
update jobs set invoice_id = md5('i:INV-3001')::uuid where ref in ('J-H-2003-C', 'J-H-2004-C') and invoice_id is null;

-- Tip dockets for the skip and hook loads. H-2011 came back with no docket.
insert into tips (id, ref, facility_id, stream_id, run_id, job_id, docket_no, tonnes, charge_cents, tipped_on)
select md5('t:' || t.ref)::uuid, t.ref, md5('f:' || t.fac)::uuid, j.stream_id, j.run_id, j.id, t.docket, t.tonnes,
       round(t.tonnes * tip_rate(md5('f:' || t.fac)::uuid, j.stream_id, j.scheduled_on))::int, j.scheduled_on
  from (values
    ('T-H-1990-C','J-H-1990-C','SVL','SV-118204',1.4),
    ('T-H-1995-C','J-H-1995-C','KRR','KM-54410',1.9),
    ('T-H-2001-C','J-H-2001-C','KRR','KM-55120',3.4),
    ('T-H-2003-C','J-H-2003-C','SVL','SV-120977',2.9),
    ('T-H-2004-C','J-H-2004-C','SVL','SV-120311',1.7),
    ('T-H-2006-S1','J-H-2006-S1','BCC','BC-8812',6.1),
    ('T-H-2012-C','J-H-2012-C','KRR','KM-55391',1.1)
  ) as t(ref, job, fac, docket, tonnes)
  join jobs j on j.ref = t.job
on conflict do nothing;

-- Invoice lines for the invoiced hires, at what the job charged
insert into invoice_lines (id, invoice_id, job_id, description, amount_cents)
select md5('il:' || t.ref)::uuid, j.invoice_id, t.job_id,
       h.ref || ' ' || bt.name || ' ' || st.name || ', ' || s.address || ' ' || s.suburb || ' (' || t.tonnes || ' t)',
       t.total_cents
  from v_job_totals t
  join jobs j on j.id = t.job_id
  join hires h on h.id = j.hire_id
  join bin_types bt on bt.id = h.bin_type_id
  join streams st on st.id = h.stream_id
  join sites s on s.id = h.site_id
 where j.invoice_id is not null
on conflict do nothing;

-- Scheduled front lift services
insert into services (id, ref, customer_id, site_id, bin_type_id, stream_id, qty, weekdays, lift_cents, started_on) values
  (md5('sv:SV-01')::uuid, 'SV-01', md5('c:C-1002')::uuid, md5('st:S-1002A')::uuid, md5('bt:FEL3')::uuid, md5('s:GEN')::uuid, 2, 'Mon,Thu', 6800, current_date - 500),
  (md5('sv:SV-02')::uuid, 'SV-02', md5('c:C-1002')::uuid, md5('st:S-1002A')::uuid, md5('bt:FEL3')::uuid, md5('s:CARD')::uuid, 1, 'Wed', 3000, current_date - 500),
  (md5('sv:SV-03')::uuid, 'SV-03', md5('c:C-1003')::uuid, md5('st:S-1003A')::uuid, md5('bt:FEL3')::uuid, md5('s:MIX')::uuid, 1, 'Tue', 4500, current_date - 300),
  (md5('sv:SV-04')::uuid, 'SV-04', md5('c:C-1008')::uuid, md5('st:S-1008A')::uuid, md5('bt:FEL3')::uuid, md5('s:GEN')::uuid, 3, 'Mon,Wed,Fri', 8500, current_date - 700),
  (md5('sv:SV-05')::uuid, 'SV-05', md5('c:C-1008')::uuid, md5('st:S-1008A')::uuid, md5('bt:FEL3')::uuid, md5('s:MIX')::uuid, 2, 'Wed', 4500, current_date - 700),
  (md5('sv:SV-06')::uuid, 'SV-06', md5('c:C-1010')::uuid, md5('st:S-1010A')::uuid, md5('bt:FEL3')::uuid, md5('s:GEN')::uuid, 1, 'Fri', 8500, current_date - 200)
on conflict do nothing;

-- Lifts: four weeks done, a week booked ahead, on the front lift's run
insert into jobs (id, ref, kind, service_id, customer_id, site_id, stream_id, scheduled_on, run_id, status, done_on)
select md5('j:L-' || sv.ref || '-' || to_char(d, 'YYMMDD'))::uuid, 'L-' || sv.ref || '-' || to_char(d, 'YYMMDD'), 'lift',
       sv.id, sv.customer_id, sv.site_id, sv.stream_id, d::date, md5('run:' || d::date || ':FL')::uuid,
       case when d::date < current_date then 'done' else 'booked' end,
       case when d::date < current_date then d::date end
  from services sv
  cross join generate_series(current_date - 28, current_date + 6, interval '1 day') as d
 where to_char(d, 'Dy') = any (string_to_array(sv.weekdays, ','))
on conflict do nothing;

-- The medical centre's last lift was missed: the gate was locked. Nobody rebooked it.
update jobs set status = 'missed', done_on = null, missed_reason = 'Gate locked'
 where ref = (select max(ref) from jobs where service_id = md5('sv:SV-03')::uuid and scheduled_on < current_date)
   and status = 'done' and not exists (select 1 from tips where job_id = jobs.id);

-- Food in the school's recycling on the last Wednesday. Noted, not charged.
update jobs set contamination = 'Food waste through the recycling'
 where ref = (select max(ref) from jobs where service_id = md5('sv:SV-05')::uuid and scheduled_on < current_date)
   and contamination is null and invoice_id is null;

-- One tip docket per front lift run per stream, tonnes from the bins lifted
insert into tips (id, ref, facility_id, stream_id, run_id, job_id, docket_no, tonnes, charge_cents, tipped_on)
select md5('t:FL-' || r.ref || '-' || st.code)::uuid, 'T-' || r.ref || '-' || st.code, st.default_facility_id, st.id, r.id, null,
       'FL' || to_char(r.run_on, 'YYMMDD') || st.code,
       round(sum(sv.qty) * case st.code when 'GEN' then 0.28 when 'MIX' then 0.11 else 0.07 end, 2),
       round(round(sum(sv.qty) * case st.code when 'GEN' then 0.28 when 'MIX' then 0.11 else 0.07 end, 2)
             * tip_rate(st.default_facility_id, st.id, r.run_on))::int,
       r.run_on
  from jobs j
  join services sv on sv.id = j.service_id
  join runs r on r.id = j.run_id
  join streams st on st.id = j.stream_id
 where j.kind = 'lift' and j.status = 'done'
 group by r.id, r.ref, r.run_on, st.id, st.code, st.default_facility_id
on conflict do nothing;

insert into activity (id, at, subject, text) values
  (md5('a:1')::uuid, now() - interval '13 days', 'customer:C-1001', 'Mark called: two more Mentone builds start next month, wants the same skip price.'),
  (md5('a:2')::uuid, now() - interval '20 days', 'facility:SVL', 'Southvale notice: general waste up to $172 a tonne, effective today.'),
  (md5('a:3')::uuid, now() - interval '3 days', 'hire:H-2005', 'Gus says the eaves sheeting is wrapped and the hygienist clearance is done.'),
  (md5('a:4')::uuid, now() - interval '9 days', 'customer:C-1005', 'Put on hold until INV-2995 is paid. Ania promised payment Friday.')
on conflict do nothing;
