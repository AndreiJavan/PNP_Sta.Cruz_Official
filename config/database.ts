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
};
