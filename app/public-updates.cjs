'use strict';
// Public releases never require a GitHub CLI installation or an OAuth token.
const PUBLIC_FEED=Object.freeze({provider:'github',owner:'grimvirusoffical-source',repo:'RedXDexAiBridge',private:false});
const RELEASES_URL='https://github.com/grimvirusoffical-source/RedXDexAiBridge/releases';
function configure(autoUpdater){autoUpdater.setFeedURL({...PUBLIC_FEED});return PUBLIC_FEED;}
module.exports={PUBLIC_FEED,RELEASES_URL,configure};
