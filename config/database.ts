import { mockHotlines, mockBulletins, mockUsers, mockTips, mockAuditLogs, mockMapPoints, mockIntelligenceScans, mockAdminNotifications, mockPublicUsers } from '../data/mockData.js';

// Mock Data Service to simulate a database without any external SDKs
class DataService {
  collection(path: string) {
    let data: any[] = [];
    if (path === 'hotlines') data = mockHotlines;
    else if (path === 'bulletins') data = mockBulletins;
    else if (path === 'users') data = mockUsers;
    else if (path === 'anonymous_tips') data = mockTips;
    else if (path === 'public_users') data = mockPublicUsers;
    else if (path === 'audit_logs') data = mockAuditLogs;
    else if (path === 'map_points') data = mockMapPoints;
    else if (path === 'intelligence_scans') data = mockIntelligenceScans;
    else if (path === 'admin_notifications') data = mockAdminNotifications;

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

  async set(data: any) { Object.assign(this.item, data); }
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
