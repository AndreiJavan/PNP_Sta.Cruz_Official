import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import fs from 'fs';
import pathModule from 'path';
import { deepSanitizeUnicode } from '../utils/unicodeHelper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = pathModule.dirname(__filename);

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || '';

// Lazy initialization of Supabase client
let supabaseInstance: any = null;

function getSupabase() {
  if (!supabaseInstance) {
    if (!supabaseUrl || !supabaseKey) {
      console.warn('Supabase credentials missing. Please check your system/Vercel environment variables.');
    }
    supabaseInstance = createClient(supabaseUrl, supabaseKey);
  }
  return supabaseInstance;
}

// Mapper to support Firestore-like API for existing controllers
class Collection {
  constructor(private name: string) { }

  where(field: string, op: string, value: any) {
    return new Query(this.name).where(field, op, value);
  }

  orderBy(field: string, direction: 'asc' | 'desc' = 'asc') {
    return new Query(this.name).orderBy(field, direction);
  }

  limit(n: number) {
    return new Query(this.name).limit(n);
  }

  offset(n: number) {
    return new Query(this.name).offset(n);
  }

  doc(id?: string) {
    return new Doc(this.name, id || uuidv4());
  }

  async add(data: any) {
    const sb = getSupabase();
    const cleanData = deepSanitizeUnicode(data);
    const { data: inserted, error } = await sb
      .from(this.name)
      .insert([cleanData])
      .select()
      .single();

    if (error) throw error;
    return { id: inserted.id, data: () => inserted };
  }

  async insertMany(records: any[], chunkSize = 500) {
    if (!records || records.length === 0) return [];
    const sb = getSupabase();
    const cleanRecords = records.map(r => deepSanitizeUnicode(r));

    for (let i = 0; i < cleanRecords.length; i += chunkSize) {
      const chunk = cleanRecords.slice(i, i + chunkSize);
      const { error } = await sb.from(this.name).insert(chunk);
      if (error) {
        console.error(`Bulk insert into ${this.name} failed:`, error);
        throw error;
      }
    }
    return cleanRecords;
  }

  async upsertMany(records: any[], chunkSize = 500) {
    if (!records || records.length === 0) return [];
    const sb = getSupabase();
    const cleanRecords = records.map(r => deepSanitizeUnicode(r));

    for (let i = 0; i < cleanRecords.length; i += chunkSize) {
      const chunk = cleanRecords.slice(i, i + chunkSize);
      const { error } = await sb.from(this.name).upsert(chunk);
      if (error) {
        console.error(`Bulk upsert into ${this.name} failed:`, error);
        throw error;
      }
    }
    return cleanRecords;
  }

  async get() {
    return new Query(this.name).get();
  }

  count() {
    return new Query(this.name).count();
  }
}

class Query {
  private table: string;
  private filters: any[] = [];
  private orderParams: { field: string, ascending: boolean } | null = null;
  private limitN: number | null = null;
  private offsetN: number | null = null;
  private isCount: boolean = false;

  constructor(table: string) {
    this.table = table;
  }

  where(field: string, op: string, value: any) {
    this.filters.push({ field, op, value });
    return this;
  }

  orderBy(field: string, direction: 'asc' | 'desc' = 'asc') {
    this.orderParams = { field, ascending: direction === 'asc' };
    return this;
  }

  limit(n: number) {
    this.limitN = n;
    return this;
  }

  offset(n: number) {
    this.offsetN = n;
    return this;
  }

  count() {
    this.isCount = true;
    return this;
  }

  async get() {
    try {
      const sb = getSupabase();
      let q: any;

      if (this.isCount) {
        q = sb.from(this.table).select('*', { count: 'exact', head: true });
        // Apply filters
        for (const f of this.filters) {
          switch (f.op) {
            case '==':
            case '=':
              q = q.eq(f.field, f.value);
              break;
            case '>':
              q = q.gt(f.field, f.value);
              break;
            case '<':
              q = q.lt(f.field, f.value);
              break;
            case '>=':
              q = q.gte(f.field, f.value);
              break;
            case '<=':
              q = q.lte(f.field, f.value);
              break;
            case '!=':
              q = q.neq(f.field, f.value);
              break;
            case 'array-contains':
              q = q.contains(f.field, [f.value]);
              break;
            case 'in':
              q = q.in(f.field, f.value);
              break;
          }
        }
        const { count, error } = await q;
        if (error) {
          if (error.code === 'PGRST205' || error.code === 'PGRST204') {
            return { data: () => ({ count: 0 }) };
          }
          throw error;
        }
        return { data: () => ({ count: count || 0 }) };
      }

      // If we have an explicit limit or offset, we do standard querying
      if (this.limitN !== null || this.offsetN !== null) {
        q = sb.from(this.table).select('*');
        // Apply filters
        for (const f of this.filters) {
          switch (f.op) {
            case '==':
            case '=':
              q = q.eq(f.field, f.value);
              break;
            case '>':
              q = q.gt(f.field, f.value);
              break;
            case '<':
              q = q.lt(f.field, f.value);
              break;
            case '>=':
              q = q.gte(f.field, f.value);
              break;
            case '<=':
              q = q.lte(f.field, f.value);
              break;
            case '!=':
              q = q.neq(f.field, f.value);
              break;
            case 'array-contains':
              q = q.contains(f.field, [f.value]);
              break;
            case 'in':
              q = q.in(f.field, f.value);
              break;
          }
        }
        if (this.orderParams) {
          q = q.order(this.orderParams.field, { ascending: this.orderParams.ascending });
        }
        if (this.limitN !== null) {
          if (this.offsetN !== null) {
            q = q.range(this.offsetN, this.offsetN + this.limitN - 1);
          } else {
            q = q.limit(this.limitN);
          }
        } else if (this.offsetN !== null) {
          q = q.range(this.offsetN, 999999);
        }
        const { data, error } = await q;
        if (error) {
          if (error.code === 'PGRST205' || error.code === 'PGRST204') {
            return { docs: [], empty: true, size: 0 };
          }
          throw error;
        }
        const docs = (data || []).map((row: any) => ({
          id: row.id,
          data: () => row,
          ref: new Doc(this.table, row.id)
        }));
        return {
          docs,
          empty: docs.length === 0,
          size: docs.length
        };
      }

      // Otherwise (no limit and no offset specified), we fetch ALL records using pagination/range
      // to bypass Supabase's default 1000 row restriction.
      let allData: any[] = [];
      let from = 0;
      let hasMore = true;
      const pageSize = 1000;

      while (hasMore) {
        let pageQuery = sb.from(this.table).select('*');
        // Apply filters
        for (const f of this.filters) {
          switch (f.op) {
            case '==':
            case '=':
              pageQuery = pageQuery.eq(f.field, f.value);
              break;
            case '>':
              pageQuery = pageQuery.gt(f.field, f.value);
              break;
            case '<':
              pageQuery = pageQuery.lt(f.field, f.value);
              break;
            case '>=':
              pageQuery = pageQuery.gte(f.field, f.value);
              break;
            case '<=':
              pageQuery = pageQuery.lte(f.field, f.value);
              break;
            case '!=':
              pageQuery = pageQuery.neq(f.field, f.value);
              break;
            case 'array-contains':
              pageQuery = pageQuery.contains(f.field, [f.value]);
              break;
            case 'in':
              pageQuery = pageQuery.in(f.field, f.value);
              break;
          }
        }
        if (this.orderParams) {
          pageQuery = pageQuery.order(this.orderParams.field, { ascending: this.orderParams.ascending });
        }
        
        const to = from + pageSize - 1;
        pageQuery = pageQuery.range(from, to);

        const { data, error } = await pageQuery;
        if (error) {
          if (error.code === 'PGRST205' || error.code === 'PGRST204') {
            break;
          }
          throw error;
        }

        const pageData = data || [];
        allData = allData.concat(pageData);

        if (pageData.length < pageSize) {
          hasMore = false;
        } else {
          from += pageSize;
        }
      }

      const docs = allData.map((row: any) => ({
        id: row.id,
        data: () => row,
        ref: new Doc(this.table, row.id)
      }));

      return {
        docs,
        empty: docs.length === 0,
        size: docs.length
      };
    } catch (e) {
      console.error(`Query failed for ${this.table}:`, e);
      if (this.isCount) return { data: () => ({ count: 0 }) };
      return { docs: [], empty: true, size: 0 };
    }
  }

  async delete() {
    try {
      const sb = getSupabase();
      let q = sb.from(this.table).delete();

      // Apply filters
      for (const f of this.filters) {
        switch (f.op) {
          case '==':
          case '=':
            q = q.eq(f.field, f.value);
            break;
          case '!=':
            q = q.neq(f.field, f.value);
            break;
          case 'in':
            q = q.in(f.field, f.value);
            break;
        }
      }

      const { error } = await q;
      if (error) throw error;
      return { success: true };
    } catch (e) {
      console.error(`Bulk delete failed for ${this.table}:`, e);
      throw e;
    }
  }
}

class Doc {
  constructor(public table: string, public id: string) { }

  async get() {
    try {
      const sb = getSupabase();
      const { data, error } = await sb
        .from(this.table)
        .select('*')
        .eq('id', this.id)
        .maybeSingle(); // maybeSingle doesn't error on missing records

      if (error) {
        if (error.code === 'PGRST205') {
          console.warn(`Table "${this.table}" not found for doc.get().`);
          return { id: this.id, exists: false, data: () => null };
        }
        throw error;
      }

      return {
        id: this.id,
        exists: !!data,
        data: () => data || null
      };
    } catch (e) {
      console.error(`Doc.get failed for ${this.table}/${this.id}:`, e);
      return { id: this.id, exists: false, data: () => null };
    }
  }

  async set(data: any) {
    const sb = getSupabase();
    const cleanData = deepSanitizeUnicode(data);
    const { error } = await sb
      .from(this.table)
      .upsert({ ...cleanData, id: this.id });

    if (error) throw error;
  }

  async update(data: any) {
    const sb = getSupabase();
    const cleanData = deepSanitizeUnicode(data);
    const { error } = await sb
      .from(this.table)
      .update(cleanData)
      .eq('id', this.id);

    if (error) throw error;
  }

  async delete() {
    const sb = getSupabase();
    const { error } = await sb
      .from(this.table)
      .delete()
      .eq('id', this.id);

    if (error) throw error;
  }
}

export const db: any = {
  collection: (name: string) => new Collection(name),
  batch: () => {
    type BatchItem =
      | { type: 'set'; table: string; id: string; data: any }
      | { type: 'update'; table: string; id: string; data: any }
      | { type: 'delete'; table: string; id: string }
      | { type: 'custom'; fn: () => Promise<void> };

    const items: BatchItem[] = [];

    return {
      set: (ref: Doc, data: any) => {
        items.push({ type: 'set', table: ref.table, id: ref.id, data: { ...data, id: ref.id } });
      },
      update: (ref: Doc, data: any) => {
        items.push({ type: 'update', table: ref.table, id: ref.id, data });
      },
      delete: (ref: Doc) => {
        items.push({ type: 'delete', table: ref.table, id: ref.id });
      },
      commit: async () => {
        const sb = getSupabase();
        let i = 0;
        while (i < items.length) {
          const item = items[i];

          if (item.type === 'set') {
            const table = item.table;
            const records: any[] = [];
            while (i < items.length && items[i].type === 'set' && (items[i] as any).table === table) {
              records.push(deepSanitizeUnicode((items[i] as any).data));
              i++;
            }
            // Execute bulk upsert in chunks of 500 records
            for (let c = 0; c < records.length; c += 500) {
              const chunk = records.slice(c, c + 500);
              const { error } = await sb.from(table).upsert(chunk);
              if (error) {
                console.error(`[BATCH ERROR] Bulk upsert into ${table} failed:`, error);
                throw error;
              }
            }
          } else if (item.type === 'delete') {
            const table = item.table;
            const ids: string[] = [];
            while (i < items.length && items[i].type === 'delete' && (items[i] as any).table === table) {
              ids.push((items[i] as any).id);
              i++;
            }
            // Execute bulk delete in chunks of 500 records
            for (let c = 0; c < ids.length; c += 500) {
              const chunk = ids.slice(c, c + 500);
              const { error } = await sb.from(table).delete().in('id', chunk);
              if (error) {
                console.error(`[BATCH ERROR] Bulk delete from ${table} failed:`, error);
                throw error;
              }
            }
          } else if (item.type === 'update') {
            const cleanData = deepSanitizeUnicode(item.data);
            const { error } = await sb.from(item.table).update(cleanData).eq('id', item.id);
            if (error) throw error;
            i++;
          } else {
            await (item as any).fn();
            i++;
          }
        }
      }
    };
  },
  runTransaction: async (callback: (transaction: any) => Promise<void>) => {
    const operations: (() => Promise<void>)[] = [];
    const transaction = {
      set: (ref: Doc, data: any) => operations.push(() => ref.set(data)),
      update: (ref: Doc, data: any) => operations.push(() => ref.update(data)),
      delete: (ref: Doc) => operations.push(() => ref.delete()),
      get: async (ref: Doc) => ref.get()
    };
    await callback(transaction);
    for (const op of operations) {
      await op();
    }
  },
  storage: {
    upload: async (bucket: string, path: string, buffer: Buffer, mimetype: string) => {
      try {
        const sb = getSupabase();

        // Vercel Strategy: Primary use Supabase. No local disk fallback.
        if (supabaseUrl && supabaseKey) {
          const { data, error } = await sb.storage.from(bucket).upload(path, buffer, {
            contentType: mimetype,
            upsert: true
          });

          if (!error) {
            const { data: publicUrlData } = sb.storage.from(bucket).getPublicUrl(path);
            return publicUrlData.publicUrl;
          }

          console.error(`[STORAGE ERROR] Supabase upload failed: ${error.message}`);
          return `https://placehold.co/600x400?text=Upload+Error:+${encodeURIComponent(error.message)}`;
        }

        return `https://placehold.co/600x400?text=Supabase+Not+Configured`;
      } catch (err: any) {
        console.error(`[STORAGE FATAL ERROR]`, err);
        return `https://placehold.co/600x400?text=Fatal+Upload+Error`;
      }
    }
  }
};

export const auth: any = {
  currentUser: null
};
