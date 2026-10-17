// Official SDK bridge. Legacy/standalone pages remain usable without it.
import { TrimApp } from '../vendor/trimjs/web-app-0.5.0.js';
const embedded = window.parent !== window || !!window.flutter_inappwebview;
if (embedded) {
  const sdk = new TrimApp();
  let deadline;
  const publish = language => window.dispatchEvent(new CustomEvent('pome:host-language', { detail: language }));
  Promise.race([
    sdk.getPlatformConfig(),
    new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Host language unavailable')), 1500); }),
  ]).then(config => {
    publish(config.language);
    if (sdk.isWeb === true && sdk.isStandaloneWeb !== true) sdk.$on('os/language', publish).catch(() => {});
  }).catch(() => {}).finally(() => clearTimeout(deadline));
}
