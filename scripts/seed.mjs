#!/usr/bin/env node
// Loads supabase/seed.sql: Bayside Bins and Recycling, a fictional skip bin and
// commercial collection business in Melbourne's south-east. Five weeks of runs,
// hires, lifts and tip dockets behind, a week booked ahead. Every row has a
// derived id and inserts with ON CONFLICT DO NOTHING, so re-running it is harmless.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDb, REPO_ROOT } from './lib/db.mjs';

export async function seed(db) {
  const sql = readFileSync(path.join(REPO_ROOT, 'supabase', 'seed.sql'), 'utf8');
  await db.exec(sql);
  const [c] = await db.query(`
    select (select count(*) from customers) as customers,
           (select count(*) from sites)     as sites,
           (select count(*) from bins)      as bins,
           (select count(*) from hires)     as hires,
           (select count(*) from services)  as services,
           (select count(*) from runs)      as runs,
           (select count(*) from jobs)      as jobs,
           (select count(*) from tips)      as tips,
           (select count(*) from invoices)  as invoices
  `);
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Number(v)]));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  const db = await getDb();
  try {
    const counts = await seed(db);
    console.log('seeded:', Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' '));
  } finally {
    await db.close();
  }
}
