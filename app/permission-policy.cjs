'use strict';
function permissionMode(settings, capability, clientId='local', transport='stdio') {
 const individual=settings.clientPolicies?.[clientId]?.[capability];
 if(individual!==undefined)return individual;
 return settings.permissions?.[capability]?(clientId==='local'&&transport!=='http'?'always':'ask'):'deny';
}
function permissionStatus(settings,clientId,transport){
 const modes=Object.fromEntries(Object.keys(settings.permissions).map(key=>[key,permissionMode(settings,key,clientId,transport)]));
 return {permissions:Object.fromEntries(Object.entries(modes).map(([key,mode])=>[key,!settings.emergencyStop&&mode!=='deny'])),effectivePermissions:modes,permissionDefaults:settings.permissions,clientPermissions:settings.clientPolicies?.[clientId]||{}};
}
module.exports={permissionMode,permissionStatus};
