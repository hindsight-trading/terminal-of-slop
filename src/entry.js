import * as TOS from './chain.js';
window.TOS = TOS;
window.dispatchEvent(new Event('tos-ready'));
