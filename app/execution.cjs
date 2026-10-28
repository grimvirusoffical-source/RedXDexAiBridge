'use strict';

const FOCUS_ACTIONS = new Set(['desktop_mouse', 'desktop_key', 'desktop_type', 'open_application']);
function backgroundOnly(settings, clientId) {
  return settings.backgroundOnly === true || settings.clientExecution?.[clientId] === 'background';
}
function assertExecution(name, settings, context) {
  if (context.interactive === true) return;
  if (backgroundOnly(settings, context.clientId || 'local') && FOCUS_ACTIONS.has(name)) {
    throw Error('Background-only mode blocks direct mouse, keyboard and application-focus tools. Use files/terminal tools or a separately authorized Cloud PC.');
  }
}

// One physical desktop has one focus. A client retains a short idle lease
// across its sequence; other AIs can still run independent terminal/file work.
class DesktopLease {
  constructor({now=Date.now, idleMs=30000}={}) { this.now=now;this.idleMs=idleMs;this.owner=null;this.until=0;this.busy=false; }
  status(clientId) {
    const active=this.owner && (this.busy || this.until>this.now());
    return {held:!!active,ownedByYou:!!active&&this.owner===clientId,expiresInMs:active?Math.max(0,this.until-this.now()):0,busy:this.busy};
  }
  release(clientId) {
    if(this.owner!==clientId)return {released:false};
    if(this.busy)throw Error('A desktop action is still running; release after it finishes.');
    this.owner=null;this.until=0;return {released:true};
  }
  reset(clientId) {if(clientId===undefined||this.owner===clientId){this.owner=null;this.until=0;}}
  async run(clientId, fn, check=()=>{}) {
    check();
    if(this.busy || (this.owner && this.owner!==clientId && this.until>this.now())) {
      throw Error('The shared desktop is in use by another action or AI. Background file and terminal work can continue; retry after the desktop lease is released or expires.');
    }
    this.owner=clientId;this.until=this.now()+this.idleMs;this.busy=true;
    try {check();return await fn();}
    finally {this.busy=false;if(this.owner===clientId)this.until=this.now()+this.idleMs;}
  }
}
module.exports={FOCUS_ACTIONS,backgroundOnly,assertExecution,DesktopLease};
