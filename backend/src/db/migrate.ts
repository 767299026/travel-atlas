import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { projectRoot } from '../config.js';

const names = ['users', 'sessions', 'journeys', 'journey_routes', 'route_days', 'route_stops', 'route_segments', 'route_revisions', 'idempotency_records', 'visits', 'diaries', 'media', 'diary_photos', 'audit_events', 'geometry_assets', 'routing_jobs', 'routing_candidates', 'share_links', 'place_records', 'photo_memories', 'photo_group_notes'];
export function validatePrefix(prefix: string) {
  if (prefix !== '' && !/^tjt_[a-f0-9]{8}_$/.test(prefix)) throw new Error('Invalid test table prefix');
}
export async function migrate(pool: Pool, prefix = '') {
  validatePrefix(prefix);
  const connection = await pool.getConnection(); const ledger = '`' + prefix + 'schema_migrations`';
  const lockName = `travel-atlas-migration-${createHash('sha256').update(prefix || 'application').digest('hex').slice(0, 24)}`;
  try {
    const [rows] = await connection.query<RowDataPacket[]>('SELECT GET_LOCK(?, 10) AS locked', [lockName]);
    if (rows[0]?.locked !== 1) throw new Error('Migration lock unavailable');
    await connection.query(`CREATE TABLE IF NOT EXISTS ${ledger} (name varchar(100) PRIMARY KEY, checksum char(64) NOT NULL, status varchar(20) NOT NULL, applied_at datetime(3) NULL)`);
    const directory = join(projectRoot, 'backend/drizzle');
    for (const name of readdirSync(directory).filter(x => x.endsWith('.sql')).sort()) {
      const original = readFileSync(join(directory, name), 'utf8'); const checksum = createHash('sha256').update(original).digest('hex');
      const [applied] = await connection.query<RowDataPacket[]>(`SELECT checksum, status FROM ${ledger} WHERE name = ?`, [name]);
      if (applied.length) {
        if (applied[0]!.checksum !== checksum || applied[0]!.status !== 'applied') throw new Error('Migration changed or incomplete; manual inspection required');
        continue;
      }
      await connection.query(`INSERT INTO ${ledger} (name, checksum, status) VALUES (?, ?, 'applying')`, [name, checksum]);
      // Only generated, committed SQL is read. Prefix table identifiers and shorten constraint names for isolated tests.
      const sql = original.replace(/`([^`]+)`/g, (quoted, identifier: string) => {
        if (!prefix) return quoted;
        if (names.includes(identifier)) return '`' + prefix + identifier + '`';
        if (identifier.endsWith('_fk') || identifier.endsWith('_uq') || identifier.endsWith('_idx')) return '`' + prefix + createHash('sha256').update(identifier).digest('hex').slice(0, 30) + '`';
        return quoted;
      });
      for (const statement of sql.split('--> statement-breakpoint').map(x => x.trim()).filter(Boolean)) await connection.query(statement);
      await connection.query(`UPDATE ${ledger} SET status = 'applied', applied_at = UTC_TIMESTAMP(3) WHERE name = ?`, [name]);
    }
  } finally {
    await connection.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {}); connection.release();
  }
}
export async function removeTestTables(pool: Pool, prefix: string) {
  validatePrefix(prefix); if (!prefix) throw new Error('Refuse to remove application tables');
  for (const name of ['photo_group_notes', 'photo_memories', 'place_records', 'share_links', 'routing_candidates', 'routing_jobs', 'geometry_assets', 'diary_photos', 'media', 'diaries', 'visits', 'audit_events', 'idempotency_records', 'route_revisions', 'route_segments', 'route_stops', 'route_days', 'journey_routes', 'journeys', 'sessions', 'users', 'schema_migrations']) await pool.query('DROP TABLE IF EXISTS `' + prefix + name + '`');
}
