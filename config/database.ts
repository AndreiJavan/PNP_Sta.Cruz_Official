<<<<<<< HEAD
import {
  mockBulletins, mockUsers, mockTips, mockMapPoints,
  mockAuditLogs, mockHotlines, mockIntelligenceScans, mockPublicUsers,
  mockAdminNotifications
} from '../data/mockData.js';

// Mock Data Service to simulate a database without any external SDKs
class DataService {
  private collections: { [key: string]: any[] } = {
    'bulletins': mockBulletins,
    'users': mockUsers,
    'anonymous_tips': mockTips,
    'map_points': mockMapPoints,
    'audit_logs': mockAuditLogs,
    'hotlines': mockHotlines,
    'intelligence_scans': mockIntelligenceScans,
    'public_users': mockPublicUsers,
    'admin_notifications': mockAdminNotifications
  };

  collection(path: string) {
    const data = this.collections[path] || [];
    return new CollectionWrapper(data);
  }
  batch() {
    return {
      set: (ref: any, data: any) => { },
      update: (ref: any, data: any) => { },
      delete: (ref: any) => { },
      commit: async () => { }
    };
  }

  async runTransaction(updateFunction: (transaction: any) => Promise<any>) {
    const transaction = {
      set: (ref: any, data: any) => {
        ref.set(data);
      },
      update: (ref: any, data: any) => {
        ref.update(data);
      },
      get: async (ref: any) => {
        return await ref.get();
      }
    };
    return await updateFunction(transaction);
  }
}

class CollectionWrapper {
  constructor(private data: any[]) { }

  doc(id?: string) {
    const item = id ? this.data.find(d => d.id === id) : null;
    return new DocWrapper(item || { id: id || Math.random().toString(36).substr(2, 9) }, this.data);
  }

  where(field: string, op: string, value: any) {
    const filtered = this.data.filter(d => {
      if (op === '==') return d[field] === value;
      if (op === '>=') return d[field] >= value;
      if (op === '<=') return d[field] <= value;
      return true;
    });
    return new CollectionWrapper(filtered);
  }

  orderBy(field: string, direction: 'asc' | 'desc' = 'asc') {
    const sorted = [...this.data].sort((a, b) => {
      if (a[field] < b[field]) return direction === 'asc' ? -1 : 1;
      if (a[field] > b[field]) return direction === 'asc' ? 1 : -1;
      return 0;
    });
    return new CollectionWrapper(sorted);
  }

  limit(n: number) {
    return new CollectionWrapper(this.data.slice(0, n));
  }

  async get() {
    return {
      docs: this.data.map(d => ({ id: d.id, data: () => d })),
      empty: this.data.length === 0,
      size: this.data.length
    };
  }

  async add(data: any) {
    const newDoc = { id: Math.random().toString(36).substr(2, 9), ...data };
    this.data.push(newDoc);
    return new DocWrapper(newDoc, this.data);
  }

  count() {
    return {
      get: async () => ({ data: () => ({ count: this.data.length }) })
    };
  }
}

class DocWrapper {
  constructor(private item: any, private parentData: any[]) { }
  get ref() { return this; }
  get id() { return this.item.id; }

  async get() {
    return {
      id: this.item.id,
      exists: !!this.item.username || !!this.item.title || !!this.item.name || !!this.item.admin_id,
      data: () => this.item
    };
  }

  async set(data: any) {
    Object.assign(this.item, data);
    if (!this.parentData.find(d => d.id === this.item.id)) {
      this.parentData.push(this.item);
    }
  }
  async update(data: any) { Object.assign(this.item, data); }
  async delete() {
    const index = this.parentData.findIndex(d => d.id === this.item.id);
    if (index !== -1) {
      this.parentData.splice(index, 1);
    }
  }
}

export const db: any = new DataService();
export const auth: any = {
  currentUser: null,
  onAuthStateChanged: (cb: any) => cb(null)
=======
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

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
  constructor(private name: string) {}

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
  constructor(private table: string, public id: string) {}

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
  }
};

export const auth: any = {
  currentUser: null // Supabase Auth integration would go here
>>>>>>> a7738a224d24ec3d09bed887c49f960150f89ea5
};
