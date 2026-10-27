'use strict';
const crypto = require('node:crypto');
class ApprovalQueue {
  constructor({emit = () => {}, timeoutMs = 90000, maxPending = 24} = {}) {
    this.emit = emit; this.timeoutMs = timeoutMs; this.maxPending = maxPending; this.items = new Map();
  }
  request(details) {
    if (this.items.size >= this.maxPending) return Promise.reject(new Error('Approval queue is full'));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.resolve(id, 'deny', 'Approval expired'), this.timeoutMs);
      const item = {...details, id, createdAt: Date.now(), expiresAt: Date.now() + this.timeoutMs, resolve, reject, timer};
      this.items.set(id, item); this.emit(this.list());
    });
  }
  list() { return [...this.items.values()].map(({resolve,reject,timer,...item}) => item); }
  resolve(id, choice, reason) {
    if (!['once','always','deny'].includes(choice)) throw new Error('Invalid approval decision');
    const item = this.items.get(id); if (!item) throw new Error('Approval has expired or was already answered');
    this.items.delete(id); clearTimeout(item.timer); this.emit(this.list());
    if (choice === 'deny') item.reject(new Error(reason || 'Permission denied by user'));
    else item.resolve(choice);
    return true;
  }
  cancelAll(reason = 'Emergency stop is active') { for (const id of [...this.items.keys()]) this.resolve(id, 'deny', reason); }
}
module.exports = {ApprovalQueue};
