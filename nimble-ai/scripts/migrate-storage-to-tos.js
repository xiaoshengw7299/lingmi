/**
 * 按数据库里出现过的对象键，把旧存储上的文件复制到火山引擎 TOS。
 *
 * 对象键列保持不变。只改写仍然保存着旧公网地址的字段（目前是画布）。
 *
 *   npm run storage:migrate -- --dry-run
 *   npm run storage:migrate
 *   npm run storage:migrate -- --force
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { randomUUID } = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');
const axios = require('axios');
const { Client } = require('pg');
const { ACLType, TosClient } = require('@volcengine/tos-sdk');

const PREFIX = 'ai-(?:video|short-video|avatar|user|ecom-video)';
const KEY_RE = new RegExp(`(?:^|[^A-Za-z0-9_-])(${PREFIX}/[^\\s"'\\\\<>?#]+)`, 'g');
const SCAN_RE = 'ai-(video|short-video|avatar|user|ecom-video)/';
const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const CONCURRENCY = Math.max(1, Number(process.env.MIGRATE_CONCURRENCY || 3));

const MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
};

function cleanHost(value) {
  return String(value || '').trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

function publicBase() {
  const custom = String(process.env.TOS_PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  if (custom) return custom;
  const endpoint = cleanHost(process.env.TOS_ENDPOINT || 'tos-cn-beijing.volces.com');
  const bucket = String(process.env.TOS_BUCKET || '').trim();
  if (!bucket) throw new Error('未配置 TOS_BUCKET');
  return `https://${bucket}.${endpoint}`;
}

function legacyBases() {
  const raw = process.env.LEGACY_STORAGE_BASE_URL || 'https://lingmi.ly.hb.cn/bucketlingmi';
  const listed = raw.split(',').map((item) => item.trim().replace(/\/$/, '')).filter(Boolean);
  const all = [];
  for (const base of listed) {
    all.push(base);
    if (base.startsWith('https://')) all.push(`http://${base.slice('https://'.length)}`);
    if (base.startsWith('http://')) all.push(`https://${base.slice('http://'.length)}`);
  }
  return [...new Set(all)];
}

function ident(name) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`非法标识符: ${name}`);
  return `"${name}"`;
}

function decodeKey(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function collectKeys(text) {
  const keys = new Set();
  const re = new RegExp(KEY_RE.source, 'g');
  let match = re.exec(text);
  while (match) {
    const key = decodeKey(match[1]).replace(/[),.;]+$/, '');
    if (key.length > 0 && key.length <= 900) keys.add(key);
    match = re.exec(text);
  }
  return keys;
}

function mimeOf(key) {
  const ext = key.split('.').pop()?.toLowerCase();
  return MIME[ext];
}

function escapeReg(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rewriteText(text, bases, nextBase, failed) {
  let next = text;
  for (const base of bases) {
    const re = new RegExp(`${escapeReg(base)}/(${PREFIX}/[^\\s"'\\\\?#]+)`, 'g');
    next = next.replace(re, (full, keyPath) => {
      const key = decodeKey(keyPath).replace(/[),.;]+$/, '');
      if (failed.has(key) || failed.has(keyPath)) return full;
      return `${nextBase}/${keyPath}`;
    });
  }
  return next;
}

async function mapPool(items, limit, worker) {
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

async function primaryKey(db, table) {
  const { rows } = await db.query(
    `SELECT a.attname AS name
     FROM pg_index i
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
     WHERE i.indrelid = $1::regclass AND i.indisprimary
     ORDER BY array_position(i.indkey, a.attnum)`,
    [`public.${table}`],
  );
  return rows.map((row) => row.name);
}

async function loadCells(db) {
  const { rows: columns } = await db.query(
    `SELECT c.table_name, c.column_name, c.data_type
     FROM information_schema.columns c
     JOIN information_schema.tables t
       ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public'
       AND t.table_type = 'BASE TABLE'
       AND c.data_type IN ('text', 'character varying', 'json', 'jsonb')
     ORDER BY c.table_name, c.ordinal_position`,
  );
  const cells = [];
  for (const column of columns) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(column.table_name) || !/^[a-z_][a-z0-9_]*$/i.test(column.column_name)) {
      continue;
    }
    const keys = await primaryKey(db, column.table_name);
    if (!keys.length) continue;
    const { rows } = await db.query(
      `SELECT ${keys.map(ident).join(', ')}, ${ident(column.column_name)}::text AS value
       FROM ${ident(column.table_name)}
       WHERE ${ident(column.column_name)}::text ~ $1`,
      [SCAN_RE],
    );
    for (const row of rows) {
      cells.push({
        table: column.table_name,
        column: column.column_name,
        dataType: column.data_type,
        pk: keys.map((name) => ({ name, value: row[name] })),
        value: row.value,
      });
    }
  }
  return cells;
}

async function downloadLegacy(bases, key, dest) {
  const encoded = key.split('/').map((part) => encodeURIComponent(part)).join('/');
  const paths = [...new Set([encoded, key])];
  let lastStatus = 404;
  for (const base of bases) {
    for (const objectPath of paths) {
      const url = `${base}/${objectPath}`;
      const res = await axios.get(url, {
        responseType: 'stream',
        timeout: 600_000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        validateStatus: () => true,
      });
      const type = String(res.headers['content-type'] || '').split(';')[0].trim();
      if (res.status !== 200 || type.includes('text/html')) {
        res.data.destroy();
        lastStatus = res.status === 200 ? 404 : res.status;
        continue;
      }
      await pipeline(res.data, fs.createWriteStream(dest));
      return {
        ok: true,
        size: Number(res.headers['content-length'] || 0),
        contentType: type || mimeOf(key),
      };
    }
  }
  return { ok: false, status: lastStatus };
}

async function tosSize(client, bucket, key) {
  try {
    const { data } = await client.headObject({ bucket, key });
    return Number(data['content-length'] || 0);
  } catch (error) {
    if (error.statusCode === 404 || error.code === 'NoSuchKey') return null;
    throw error;
  }
}

async function copyOne(client, bucket, bases, key) {
  const tmp = path.join(os.tmpdir(), `tos-migrate-${randomUUID()}`);
  try {
    if (!FORCE) {
      const existing = await tosSize(client, bucket, key);
      if (existing != null && existing > 0) return 'exists';
    }
    const downloaded = await downloadLegacy(bases, key, tmp);
    if (!downloaded.ok) return downloaded.status === 404 || downloaded.status === 403 ? 'missing' : 'failed';
    if (!FORCE) {
      const existing = await tosSize(client, bucket, key);
      if (existing != null && (!downloaded.size || existing === downloaded.size)) return 'exists';
    }
    await client.uploadFile({
      bucket,
      key,
      file: tmp,
      contentType: downloaded.contentType,
      contentDisposition: 'inline',
      acl: ACLType.ACLPublicRead,
      taskNum: 3,
    });
    return 'copied';
  } catch (error) {
    return { failed: error instanceof Error ? error.message : String(error) };
  } finally {
    await fs.promises.unlink(tmp).catch(() => undefined);
  }
}

async function rewriteCells(db, cells, bases, nextBase, failed) {
  let updated = 0;
  await db.query('BEGIN');
  try {
    for (const cell of cells) {
      const next = rewriteText(cell.value, bases, nextBase, failed);
      if (next === cell.value) continue;
      const cast = cell.dataType === 'json' || cell.dataType === 'jsonb' ? `::${cell.dataType}` : '';
      const params = [next];
      const where = cell.pk.map((item, index) => {
        params.push(item.value);
        return `${ident(item.name)} = $${index + 2}`;
      });
      await db.query(
        `UPDATE ${ident(cell.table)} SET ${ident(cell.column)} = $1${cast} WHERE ${where.join(' AND ')}`,
        params,
      );
      updated += 1;
    }
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
  return updated;
}

function openDb() {
  const db = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
  });
  db.on('error', (error) => {
    console.error(`数据库连接中断: ${error.message}`);
  });
  return db;
}

async function main() {
  const bases = legacyBases();
  let db = openDb();
  await db.connect();
  const cells = await loadCells(db);
  const keys = new Set();
  let legacyCells = 0;
  for (const cell of cells) {
    for (const key of collectKeys(cell.value)) keys.add(key);
    if (bases.some((base) => cell.value.includes(base))) legacyCells += 1;
  }
  const list = [...keys].sort();
  console.log(`扫描到 ${list.length} 个对象键，${cells.length} 个字段值，其中 ${legacyCells} 个仍是旧公网地址`);
  if (DRY_RUN) {
    for (const key of list.slice(0, 30)) console.log(`  ${key}`);
    if (list.length > 30) console.log(`  ... 另有 ${list.length - 30} 个`);
    await db.end();
    return;
  }

  const bucket = String(process.env.TOS_BUCKET || '').trim();
  const accessKeyId = String(process.env.TOS_ACCESS_KEY_ID || '').trim();
  const accessKeySecret = String(process.env.TOS_SECRET_ACCESS_KEY || '').trim();
  if (!bucket || !accessKeyId || !accessKeySecret) {
    throw new Error('请先在 .env 填写 TOS_ACCESS_KEY_ID、TOS_SECRET_ACCESS_KEY、TOS_BUCKET');
  }
  const nextBase = publicBase();
  const client = new TosClient({
    accessKeyId,
    accessKeySecret,
    region: process.env.TOS_REGION || 'cn-guangzhou',
    endpoint: cleanHost(process.env.TOS_ENDPOINT || 'tos-cn-guangzhou.volces.com'),
    requestTimeout: 600_000,
    connectionTimeout: 60_000,
  });

  const stats = { copied: 0, exists: 0, missing: 0, failed: 0 };
  const failed = new Set();
  let done = 0;
  await mapPool(list, CONCURRENCY, async (key) => {
    const result = await copyOne(client, bucket, bases, key);
    done += 1;
    if (result === 'copied' || result === 'exists' || result === 'missing') {
      stats[result] += 1;
    } else {
      stats.failed += 1;
      failed.add(key);
      const message = result && result.failed ? result.failed : '下载失败';
      console.error(`失败 ${key}: ${message}`);
    }
    if (done % 10 === 0 || done === list.length) {
      console.log(`进度 ${done}/${list.length} 复制 ${stats.copied} 已存在 ${stats.exists} 源缺失 ${stats.missing} 失败 ${stats.failed}`);
    }
  });

  try {
    await db.query('SELECT 1');
  } catch {
    await db.end().catch(() => undefined);
    db = openDb();
    await db.connect();
  }
  const updated = await rewriteCells(db, cells, bases, nextBase, failed);
  await db.end();
  console.log(`完成。复制 ${stats.copied}，已存在 ${stats.exists}，源站没有 ${stats.missing}，失败 ${stats.failed}，改写字段 ${updated}`);
  console.log(`新的公网前缀: ${nextBase}`);
  if (stats.failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
