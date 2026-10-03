/* Build the published copy of one of the standalone apps — logic.html (the
 * gate simulator) or breadboard.html (Breadboard and Design).
 *
 *   node test/build-artifact.js [logic|breadboard] [out.html]
 *
 * The artifact host wraps whatever it is given in its own <!doctype>, <head>
 * and <body>, so the published copy is the same file with the document shell
 * taken off: the <style> block, then everything between <body> and </body>,
 * minus the service-worker registration — that one only means anything on the
 * page's own site, and the artifact frame has no sw.js to register.
 *
 * Nothing else is touched, so the published copy and the repository copy stay
 * the same app.
 */
const fs = require('fs');
const path = require('path');

const app = process.argv[2] === 'breadboard' ? 'breadboard' : 'logic';
const file = app + '.html';
const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const out = process.argv[3] || path.join(__dirname, '..', app + '.artifact.html');

const cut = (open, close, what) => {
  const a = src.indexOf(open), b = src.indexOf(close, a);
  if (a < 0 || b < 0) throw new Error('cannot find the ' + what + ' in ' + file);
  return src.slice(a, b + close.length);
};

const style = cut('<style>', '</style>', 'stylesheet');
const bodyStart = src.indexOf('<body>') + '<body>'.length;
const bodyEnd = src.indexOf('</body>');
if (bodyStart < 6 || bodyEnd < 0) throw new Error('cannot find the body in ' + file);
let body = src.slice(bodyStart, bodyEnd);

/* drop the service-worker block, comment and all */
const swAt = body.indexOf('<!-- Offline support.');
if (swAt < 0) throw new Error('cannot find the service-worker block in ' + file);
body = body.slice(0, swAt).trimEnd();
if (/serviceWorker/.test(body)) throw new Error('the service worker survived the cut');

fs.writeFileSync(out,
  `<!-- ${app === 'logic' ? 'Logic Gate Simulator' : 'Breadboard & Design'} — published copy of ${file} from the Coriantumr repo.
     Same app, byte for byte, minus the document wrapper and the service
     worker, which only apply on its own site. Rebuild with
     node test/build-artifact.js [logic|breadboard] -->
${style}
${body}
`);
console.log(out + ' — ' + (fs.statSync(out).size / 1024).toFixed(0) + ' kB');
