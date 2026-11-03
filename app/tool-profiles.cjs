'use strict';
const BASE=['bridge_status','get_profile'];
const PROFILES=Object.freeze({terminal:new Set([...BASE,'run_command','process_start','process_list','process_output','process_input','process_stop']),crawler:new Set([...BASE,'crawl_start','crawl_list','crawl_status','crawl_results','crawl_stop'])});
function validProfile(profile){return typeof profile==='string'&&(profile==='bridge'||Object.hasOwn(PROFILES,profile));}
function validateProfiles(profiles){if(!Array.isArray(profiles)||!profiles.every(validProfile))throw Error('Unknown tool connection profile');return profiles;}
function profileAllowed(name,profile='bridge'){if(!validProfile(profile))throw Error('Unknown tool connection profile');return profile==='bridge'||PROFILES[profile].has(name);}
function restrictTools(tools,profiles=[]){validateProfiles(profiles);return tools.filter(t=>profiles.every(p=>profileAllowed(t.name,p)));}
function assertProfile(name,profiles=[]){validateProfiles(profiles);if(!profiles.every(p=>profileAllowed(name,p)))throw Error('This connection does not allow that tool');}
module.exports={profileAllowed,restrictTools,assertProfile,validProfile,validateProfiles};
