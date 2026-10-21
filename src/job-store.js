import { mkdir, readdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const validId = id => /^[a-f0-9-]{36}$/.test(id);
export function jobStore(directory) {
  const pending = new Map();
  return {
    async flush(id) { await pending.get(id)?.catch(() => {}); },
    async loadAll() {
      if (!directory) return [];
      await mkdir(directory, { recursive: true });
      const files = (await readdir(directory)).filter(n => /^[a-f0-9-]{36}\.json$/.test(n));
      const jobs = [];
      for (const file of files) {
        try {
          const job = JSON.parse(await readFile(path.join(directory, file), 'utf8'));
          if (validId(job.id) && job.input && ['ready', 'running', 'cancelled', 'needs_input', 'failed', 'interrupted'].includes(job.status)) jobs.push(job);
        } catch { /* A damaged local record must not prevent other chapters opening. */ }
      }
      return jobs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 100);
    },
    async get(id) {
      if (!directory || !validId(id)) return null;
      try { const job = JSON.parse(await readFile(path.join(directory, `${id}.json`), 'utf8')); return job.id === id ? job : null; }
      catch { return null; }
    },
    async save(job) {
      if (!directory || !validId(job.id)) return;
      const { controller, storageWarning, ...record } = job;
      const serialized = JSON.stringify(record);
      // Cancellation and the model's abort handler can save the same job together.
      // Serialize replacements, particularly on Windows where rename can be busy.
      const previous = pending.get(job.id) || Promise.resolve();
      const writing = previous.catch(() => {}).then(async () => {
        await mkdir(directory, { recursive: true });
        const file = path.join(directory, `${job.id}.json`), temporary = file + `.${randomUUID()}.tmp`;
        await writeFile(temporary, serialized, 'utf8');
        for (let attempt = 0; ; attempt++) {
          try { await rename(temporary, file); break; }
          catch (error) {
            if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 3) throw error;
            await new Promise(resolve => setTimeout(resolve, 30 * (attempt + 1)));
          }
        }
      });
      pending.set(job.id, writing);
      try { await writing; } finally { if (pending.get(job.id) === writing) pending.delete(job.id); }
    }
  };
}
