import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import pathModule from 'path';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || '';

// Lazy initialization of Supabase client
let supabaseInstance: any = null;

function getSupabase() {
  if (!supabaseInstance) {
    if (!supabaseUrl || !supabaseKey) {
      console.warn('Supabase credentials missing. Please check your .env file.');
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

  doc(id?: string) {
    return new Doc(this.name, id || uuidv4());
  }

  async add(data: any) {
    const sb = getSupabase();
    const { data: inserted, error } = await sb
      .from(this.name)
      .insert([data])
      .select()
      .single();

    if (error) throw error;
    return { id: inserted.id, data: () => inserted };
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
      } else {
        q = sb.from(this.table).select('*');
      }

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

      // Apply order
      if (this.orderParams) {
        q = q.order(this.orderParams.field, { ascending: this.orderParams.ascending });
      }

      // Apply limit
      if (this.limitN) {
        q = q.limit(this.limitN);
      }

      const { data, count, error } = await q;

      if (error) {
        if (error.code === 'PGRST205' || error.code === 'PGRST204') {
          if (this.isCount) return { data: () => ({ count: 0 }) };
          console.warn(`Supabase schema error (${error.code}) for ${this.table}. Returning empty results.`);
          return { docs: [], empty: true, size: 0 };
        }
        throw error;
      }

      if (this.isCount) {
        return { data: () => ({ count: count || 0 }) };
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
  constructor(private table: string, public id: string) { }

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
    const { error } = await sb
      .from(this.table)
      .upsert({ ...data, id: this.id });

    if (error) throw error;
  }

  async update(data: any) {
    const sb = getSupabase();
    const { error } = await sb
      .from(this.table)
      .update(data)
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
    const operations: (() => Promise<void>)[] = [];
    return {
      set: (ref: Doc, data: any) => operations.push(() => ref.set(data)),
      update: (ref: Doc, data: any) => operations.push(() => ref.update(data)),
      delete: (ref: Doc) => operations.push(() => ref.delete()),
      commit: async () => {
        // Supabase doesn't have a direct batch API like Firestore, 
        // we'll run them sequentially for now or use rpc/transactions if needed.
        for (const op of operations) {
          await op();
        }
      }
    };
  },
  runTransaction: async (callback: (transaction: any) => Promise<void>) => {
    // Mock transaction using sequential execution
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
        if (supabaseUrl && supabaseKey) {
          const { data, error } = await sb.storage.from(bucket).upload(path, buffer, {
            contentType: mimetype,
            upsert: true
          });
          if (!error) {
            const { data: publicUrlData } = sb.storage.from(bucket).getPublicUrl(path);
            return publicUrlData.publicUrl;
          }
          console.warn(`[STORAGE WARNING] Supabase: ${error.message}`);
        }

        const fileName = path.split('/').pop() || `${Date.now()}.png`;
        const uploadDir = pathModule.join(process.cwd(), 'public', bucket);
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        fs.writeFileSync(pathModule.join(uploadDir, fileName), buffer);
        console.log(`[STORAGE] Local fallback: /${bucket}/${fileName}`);
        return `/${bucket}/${fileName}`;
      } catch (err: any) {
        console.error(`[STORAGE ERROR] ${bucket}/${path}:`, err);
        const errMsg = encodeURIComponent(err.message || 'Unknown Error');
        return `https://placehold.co/600x400?text=Upload+Error:+${errMsg}`;
      }
    }
  }
};

export const auth: any = {
  currentUser: null // Supabase Auth integration would go here
};
