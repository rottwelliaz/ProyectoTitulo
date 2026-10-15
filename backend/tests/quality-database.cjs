// Only creates a new, isolated database. Never resets or seeds the application database.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
async function main() {
  const envPath = path.resolve(__dirname, '../.env');
  const values = Object.fromEntries(fs.readFileSync(envPath, 'utf8').split(/\r?\n/).filter(l => /^\w+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]; }));
  const url = new URL(values.DATABASE_URL);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw Error('Only local PostgreSQL is allowed');
  const database = 'g6_quality_' + Date.now();
  url.pathname = '/postgres';
  const admin = new PrismaClient({ datasources: { db: { url: url.href } } });
  try { await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`); } finally { await admin.$disconnect(); }
  url.pathname = '/' + database;
  fs.mkdirSync(path.resolve(__dirname, '../../quality-artifacts'), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, '../../quality-artifacts/database.local.json'), JSON.stringify({ url: url.href }));
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, DATABASE_URL: url.href }, encoding: 'utf8' });
  console.log('Isolated database:', database, 'migration exit:', result.status);
  console.log(result.stdout.replaceAll(url.href, '[local test database]'));
  if (result.status) { console.error('Migration failed'); process.exitCode = 1; }
}
main().catch(e => { console.error(e.code || e.name, 'Could not provision local test database'); process.exitCode = 1; });
