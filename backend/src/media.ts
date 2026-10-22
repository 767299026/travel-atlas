import sharp, { type Metadata, type OutputInfo } from 'sharp';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, rm, stat, statfs, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import type { AppConfig } from './config.js';
import type { Database } from './db/client.js';
import { DomainError } from '../../packages/contracts/src/index.js';
import { mediaItem } from './records.js';
import { repository } from './repository.js';

sharp.concurrency(1); sharp.cache({ memory: 32, files: 0, items: 32 });
const imageId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
// The store only receives server-generated identifiers; original filenames are never filesystem paths.
export class PrivateImageStore {
  constructor(readonly root: string) {}
  folder(id: string) { if (!imageId.test(id)) throw new DomainError('NOT_FOUND', '图片不存在。', 404); return join(this.root, id); }
  async write(id: string, extension: string, original: Buffer, preview: Buffer, thumb: Buffer) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const space = await statfs(this.root); if (space.bavail * space.bsize < original.length + preview.length + thumb.length + 512 * 1024 * 1024) throw new DomainError('STORAGE_FULL', '服务器图片空间不足，请稍后再试。', 507);
    const folder = this.folder(id); await mkdir(folder, { mode: 0o700 });
    await Promise.all([writeFile(join(folder, 'original.' + extension), original, { mode: 0o600 }), writeFile(join(folder, 'preview.webp'), preview, { mode: 0o600 }), writeFile(join(folder, 'thumb.webp'), thumb, { mode: 0o600 })]);
  }
  async remove(id: string) { await rm(this.folder(id), { recursive: true, force: true }); }
  async stream(id: string, variant: string, extension: string) {
    const name = variant === 'original' ? 'original.' + extension : variant === 'thumb' ? 'thumb.webp' : 'preview.webp';
    if (!['jpg', 'png', 'webp'].includes(extension)) throw new DomainError('MEDIA_UNAVAILABLE', '图片格式暂不可用。', 503);
    const path = join(this.folder(id), name); try { await stat(path); } catch { throw new DomainError('MEDIA_UNAVAILABLE', '图片文件暂不可用。', 503); }
    return createReadStream(path);
  }
}
export function mediaService(database: Database, config: AppConfig) {
  const { db, schema: s } = database, storage = repository(database).storage, files = new PrivateImageStore(config.mediaRoot); let processing = false;
  const lookup = async (ownerId: string, id: string) => {
    const [row] = await db.select().from(s.media).where(and(eq(s.media.id, id), eq(s.media.ownerId, ownerId), eq(s.media.state, 'ready')));
    if (!row) throw new DomainError('NOT_FOUND', '图片不存在或无权访问。', 404); return row;
  };
  return {
    files, lookup,
    async upload(ownerId: string, key: string, filename: string, read: () => Promise<Buffer>) {
      if (!/^[a-zA-Z0-9-]{8,80}$/.test(key)) throw new DomainError('VALIDATION_ERROR', '上传标识无效。', 400);
      if (processing) throw new DomainError('IMAGE_BUSY', '正在处理照片，请稍后重试。', 429);
      processing = true; const id = randomUUID(); let saved = false;
      try {
        const buffer = await read(); if (!buffer.length || buffer.length > config.uploadMaxBytes) throw new DomainError('FILE_TOO_LARGE', '图片为空或超出上传大小限制。', 413);
        const checksum = createHash('sha256').update(buffer).digest('hex'), safeName = filename.replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 200) || 'photo';
        const body = { checksum, filename: safeName }, cached = await storage.replay(db, ownerId, 'media-upload', key, body);
        if (cached.found) { const response = cached.response as { id: string }; return mediaItem(await lookup(ownerId, response.id)); }
        let metadata: Metadata, preview: { data: Buffer; info: OutputInfo }, thumb: Buffer;
        try {
          metadata = await sharp(buffer, { limitInputPixels: 50_000_000, failOn: 'warning' }).metadata();
          if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1) throw new DomainError('UNSUPPORTED_IMAGE', '目前支持静态 JPG、PNG、WebP，请转换后再上传。', 415);
          preview = await sharp(buffer, { limitInputPixels: 50_000_000, failOn: 'warning' }).autoOrient().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
          thumb = await sharp(preview.data).resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).webp({ quality: 74 }).toBuffer();
        } catch (error) { if (error instanceof DomainError) throw error; throw new DomainError('INVALID_IMAGE', '图片无法解码或像素超过 5000 万，请转换或缩小后再试。', 415); }
        const extension = metadata.format === 'jpeg' ? 'jpg' : metadata.format!, storedBytes = buffer.length + preview.data.length + thumb.length;
        await files.write(id, extension, buffer, preview.data, thumb);
        const result = await db.transaction(async ex => {
          await ex.select({ id: s.users.id }).from(s.users).where(eq(s.users.id, ownerId)).for('update');
          const previous = await storage.replay(ex, ownerId, 'media-upload', key, body); if (previous.found) return previous.response as { id: string };
          const [usage] = await ex.select({ bytes: sql<string>`COALESCE(SUM(${s.media.storedBytes}), 0)` }).from(s.media).where(and(eq(s.media.ownerId, ownerId), eq(s.media.state, 'ready')));
          if (Number(usage?.bytes ?? 0) + storedBytes > config.mediaQuotaBytes) throw new DomainError('MEDIA_QUOTA', '照片存储已达到个人配额，请先移除不需要的照片。', 413);
          const row = { id, ownerId, filename: safeName, extension, width: preview.info.width, height: preview.info.height, originalBytes: buffer.length, storedBytes, checksum, state: 'ready' as const, createdAt: new Date() };
          await ex.insert(s.media).values(row); const result = mediaItem(row); await storage.remember(ex, ownerId, 'media-upload', key, body, result); return result;
        });
        saved = result.id === id; return mediaItem(await lookup(ownerId, result.id));
      } finally { if (!saved) await files.remove(id).catch(() => {}); processing = false; }
    },
    async remove(ownerId: string, id: string) {
      await db.transaction(async ex => {
        await ex.select({ id: s.users.id }).from(s.users).where(eq(s.users.id, ownerId)).for('update');
        const [row] = await ex.select().from(s.media).where(and(eq(s.media.id, id), eq(s.media.ownerId, ownerId))).for('update');
        if (!row) throw new DomainError('NOT_FOUND', '图片不存在或无权删除。', 404);
        if ((await ex.select().from(s.diaryPhotos).where(eq(s.diaryPhotos.mediaId, id))).length) throw new DomainError('PHOTO_IN_USE', '请在日记中移除照片并保存，再删除图片。', 409);
        await ex.update(s.media).set({ state: 'deleted' }).where(eq(s.media.id, id));
      });
      await files.remove(id).catch(() => {}); return { removed: true };
    },
    async cleanRemoved(ids: string[]) { for (const id of ids) await files.remove(id).catch(() => {}); },
    async cleanup() {
      const cutoff = new Date(Date.now() - 7 * 86400000);
      const orphans = await db.select({ id: s.media.id, state: s.media.state }).from(s.media).leftJoin(s.diaryPhotos, eq(s.diaryPhotos.mediaId, s.media.id)).where(and(isNull(s.diaryPhotos.id), lt(s.media.createdAt, cutoff)));
      let removed = 0;
      for (const row of orphans) { await this.remove((await db.select({ owner: s.media.ownerId }).from(s.media).where(eq(s.media.id, row.id)))[0]!.owner, row.id); removed++; }
      for (const row of await db.select({ id: s.media.id }).from(s.media).where(eq(s.media.state, 'deleted'))) await files.remove(row.id);
      const entries = await readdir(config.mediaRoot, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) if (entry.isDirectory() && imageId.test(entry.name)) {
        const metadata = await stat(files.folder(entry.name));
        if (metadata.mtime < cutoff && !(await db.select({ id: s.media.id }).from(s.media).where(eq(s.media.id, entry.name))).length) { await files.remove(entry.name); removed++; }
      }
      return { removed };
    },
  };
}
