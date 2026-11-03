'use strict';
const TIERS = Object.freeze([
 {id:'free',name:'Free',monthlyCents:0,weeklyMinutes:120,weeklyCrawlerPages:250,weeklyTerminalMinutes:120,symbol:'◇'},
 {id:'bronze',name:'Bronze',monthlyCents:299,weeklyMinutes:360,weeklyCrawlerPages:1000,weeklyTerminalMinutes:360,symbol:'◈'},
 {id:'silver',name:'Silver',monthlyCents:499,weeklyMinutes:720,weeklyCrawlerPages:3000,weeklyTerminalMinutes:720,symbol:'⬡'},
 {id:'gold',name:'Gold',monthlyCents:799,weeklyMinutes:1440,weeklyCrawlerPages:8000,weeklyTerminalMinutes:1440,symbol:'✧'},
 {id:'platinum',name:'Platinum',monthlyCents:1199,weeklyMinutes:3600,weeklyCrawlerPages:20000,weeklyTerminalMinutes:3600,symbol:'⬢'},
 {id:'emerald',name:'Emerald',monthlyCents:1699,weeklyMinutes:7200,weeklyCrawlerPages:50000,weeklyTerminalMinutes:7200,symbol:'❖'},
 {id:'ruby',name:'Ruby',monthlyCents:2499,weeklyMinutes:null,weeklyCrawlerPages:100000,weeklyTerminalMinutes:null,symbol:'◆'}
]);
const PLUGINS = Object.freeze([
 {id:'workspace-snapshot',name:'Workspace Snapshot',description:'A read-only project snapshot for approved folders.',priceCents:0,recipe:['workspace.inspect','workspace.report'],image:'/assets/plugins/workspace-snapshot.svg'},
 {id:'cleanup-preview',name:'Cleanup Preview',description:'Preview possible workspace cleanup without deleting files.',priceCents:0,recipe:['workspace.inspect','cleanup.preview'],image:'/assets/plugins/cleanup-preview.svg'},
 {id:'crawl-brief',name:'Crawl Brief',description:'Turn approved crawler results into a concise source-linked brief.',priceCents:0,recipe:['crawler.collect','research.export'],image:'/assets/plugins/crawl-brief.svg'},
 {id:'workflow-checkpoints',name:'Workflow Checkpoints',description:'Durable task checkpoints and build verification for one licensed device.',priceCents:399,recipe:['workspace.inspect','task.checkpoint','build.verify','task.report'],image:'/assets/plugins/workflow-checkpoints.svg'}
]);
const ACTIONS=Object.freeze(['workspace.inspect','workspace.report','cleanup.preview','crawler.collect','research.export','task.checkpoint','task.report','build.verify','release.prepare']);
module.exports={TIERS,PLUGINS,ACTIONS};
