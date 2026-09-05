#!/usr/bin/env node
// Local-only browser checks. Every target is created and closed by this process.
import assert from 'node:assert/strict';
import http from 'node:http';

const [base, expectedPid] = process.argv.slice(2);
if (!base || !expectedPid) throw new Error('usage: node browser-smoke.mjs PROXY_URL EXPECTED_PID');
const targets = new Set();
const fixtureServer = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.write('<!doctype html><title>Slow local fixture</title><body>loading');
  // Keep the response incomplete until cleanup: machine/browser latency must not
  // make a fixed-delay fixture finish before the proxy has attached.
  res.on('error', () => {});
});
async function request(endpoint, body) {
  const response = await fetch(base + endpoint, { signal: AbortSignal.timeout(20000),
    method: body === undefined ? 'GET' : 'POST',
    body: typeof body === 'string' ? body : body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
async function requestDeclaredOversize(endpoint) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const outgoing = http.request(base + endpoint, { method: 'POST', headers: { 'content-length': 1024 * 1024 + 1 } }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        outgoing.destroy();
        resolve({ status: response.statusCode, headers: response.headers, body: JSON.parse(body) });
      });
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      outgoing.destroy();
      reject(new Error('declared oversized smoke request did not receive an immediate response'));
    }, 2000);
    outgoing.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    outgoing.flushHeaders();
  });
}
async function create(url, timeout = 15000) {
  const result = await request(`/new?url=${encodeURIComponent(url)}&timeout_ms=${timeout}`);
  assert.equal(typeof result.body.targetId, 'string', JSON.stringify(result.body));
  targets.add(result.body.targetId);
  return result;
}
try {
  const health = (await request('/health')).body;
  assert.equal(health.pid, Number(expectedPid), 'smoke must use its own newly started proxy');
  assert.ok(health.instance_id);
  assert.equal(health.version, '1.4.0');
  assert.equal(health.connected, true);
  const html = `<!doctype html><html lang="en"><head><title>Academic Search browser fixture</title>
    <meta name="citation_title" content="Reliable Browser Fixture">
    <meta name="citation_author" content="Ada Lovelace"><meta name="citation_author" content="Ada Lovelace">
    <meta name="citation_author" content="Grace Hopper">
    </head><body><nav>Fixture navigation</nav>
    <button class="duplicate" onclick="window.clicks++">Cite A</button>
    <button class="duplicate" onclick="window.clicks++">Cite B</button>
    <button id="unique" onclick="window.clicks++">Unique action</button>
    <button id="disabled" disabled>Disabled action</button>
    <input class="uploads" type="file"><input class="uploads" type="file">
    <form id="entry"><input id="name" value=""><button type="submit">Submit</button></form>
    <input id="race-intended" value="first"><input id="race-other" value="second">
    <input id="early-intended" value="early"><iframe id="race-frame" srcdoc="<input id='inside' value='iframe'>"></iframe>
    <div id="editable" contenteditable="true">editable</div><div id="editable-other" contenteditable="true">other</div>
    <div id="transparent-parent" style="opacity:0"><button id="transparent-click">Invisible action</button>
      <input id="transparent-input" value="safe"></div>
    <nav><div id="nav-content" class="content">Navigation descendant must stay excluded</div></nav>
    <div aria-hidden="true"><article id="hidden-article">Hidden article must stay excluded</article></div>
    <article id="paper"><h1>Reliable Browser Fixture</h1>
      <p>Article evidence for bounded local extraction.</p>
      <a href="https://example.test/source">Primary source</a>
      <a href="https://example.test/source">Duplicate source</a></article>
    <button id="moving-click" style="display:block;margin-top:1800px">Moving action</button>
    <div id="click-overlay" style="display:none;position:fixed;inset:0;z-index:2147483647">Overlay</div>
    <main id="results" hidden>Delayed result</main><p id="empty" hidden>No results</p>
    <p id="challenge" hidden>Verification required</p>
    <script>window.clicks=0;window.overlayClicks=0;window.mutations=0;window.inputEvents=[];window.keyEvents=[];window.formSubmits=0;
      document.querySelector('#name').addEventListener('input',()=>window.inputEvents.push('input'));
      document.querySelector('#name').addEventListener('change',()=>window.inputEvents.push('change'));
      document.querySelector('#name').addEventListener('keydown',event=>window.keyEvents.push(event.key));
      document.querySelector('#entry').addEventListener('submit',event=>{event.preventDefault();window.formSubmits++});
      document.querySelector('#race-intended').addEventListener('focus',event=>{
        event.target.setSelectionRange(event.target.value.length,event.target.value.length);
        queueMicrotask(()=>document.querySelector('#race-other').focus())});
      window.addEventListener('beforeinput',event=>{if(event.target.id==='early-intended'){
        document.querySelector('#race-frame').contentDocument.querySelector('#inside').focus();event.stopImmediatePropagation()}},true);
      document.querySelector('#transparent-click').addEventListener('click',()=>window.clicks++);
      document.querySelector('#click-overlay').addEventListener('click',()=>window.overlayClicks++);
      window.armClickRace=()=>{const elementFromPoint=document.elementFromPoint.bind(document);let hits=0;
        document.elementFromPoint=(x,y)=>{const hit=elementFromPoint(x,y);if(++hits===1)
          queueMicrotask(()=>document.querySelector('#click-overlay').style.display='block');return hit}};
      new MutationObserver(list=>window.mutations+=list.length).observe(document.body,{subtree:true,attributes:true,childList:true});
    </script></body></html>`;
  const created = await create('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  assert.equal(created.body.load_status, 'complete');
  const target = created.body.targetId;
  const endpoint = name => `/${name}?target=${target}`;
  const conditions = [
    { state: 'blocked', selector: '#challenge' },
    { state: 'empty', selector: '#empty' },
    { state: 'results_ready', selector: '#results' },
  ];
  assert.deepEqual((await request(endpoint('eval'), 'Promise.resolve({answer:42})')).body, { value: { answer: 42 } });
  const read = await request(endpoint('readPage'), { max_chars: 5000, max_links: 10, max_citation_meta: 10 });
  assert.equal(read.status, 200);
  assert.equal(read.body.title, 'Academic Search browser fixture');
  assert.equal(read.body.extraction.method, 'semantic');
  assert.equal(read.body.extraction.heuristic, true);
  assert.equal(read.body.extraction.scope, 'current_frame_light_dom');
  assert.equal(read.body.extraction.candidate_scan_truncated, false);
  assert.match(read.body.text, /Article evidence for bounded local extraction/);
  assert.doesNotMatch(read.body.text, /Fixture navigation/);
  assert.deepEqual(read.body.links, [{ text: 'Primary source', url: 'https://example.test/source' }]);
  assert.deepEqual(read.body.citation_meta, {
    citation_title: ['Reliable Browser Fixture'], citation_author: ['Ada Lovelace', 'Grace Hopper'],
  });
  assert.equal(read.body.truncated.citation_meta, false);
  assert.equal((await request(endpoint('readPage'), { selector: '#nav-content' })).body.code, 'ELEMENT_NOT_VISIBLE');
  assert.equal((await request(endpoint('readPage'), { selector: '#hidden-article' })).body.code, 'ELEMENT_NOT_VISIBLE');
  await request(endpoint('eval'), 'document.documentElement.style.opacity="0"; true');
  const hiddenBody = await request(endpoint('readPage'), {});
  assert.equal(hiddenBody.status, 400);
  assert.equal(hiddenBody.body.code, 'ELEMENT_NOT_VISIBLE');
  await request(endpoint('eval'), 'document.documentElement.style.opacity=""; true');
  for (const route of ['readPage', 'fill']) {
    const oversized = await requestDeclaredOversize(endpoint(route));
    assert.equal(oversized.status, 413, route);
    assert.equal(oversized.body.code, 'PAYLOAD_TOO_LARGE', route);
    assert.equal(oversized.body.max_bytes, 1024 * 1024, route);
    assert.equal(oversized.headers.connection, 'close', route);
  }

  const clicked = await request(endpoint('click'), '#unique');
  assert.equal(clicked.body.clicked, true);
  assert.equal(clicked.body.status, 'dispatched');
  assert.equal(clicked.body.outcome_verified, false);
  const disabled = await request(endpoint('clickAt'), '#disabled');
  assert.equal(disabled.status, 400);
  assert.equal(disabled.body.code, 'ELEMENT_DISABLED');
  const transparentClick = await request(endpoint('click'), '#transparent-click');
  assert.equal(transparentClick.status, 400);
  assert.equal(transparentClick.body.code, 'ELEMENT_NOT_VISIBLE');
  const transparentFill = await request(endpoint('fill'), { selector: '#transparent-input', text: 'unsafe' });
  assert.equal(transparentFill.status, 400);
  assert.equal(transparentFill.body.code, 'ELEMENT_NOT_VISIBLE');

  const filled = await request(endpoint('fill'), { selector: '#name', text: 'Ada' });
  assert.equal(filled.body.immediate_value_verified, true);
  assert.equal(filled.body.status, 'dispatched');
  assert.equal(filled.body.outcome_verified, false);
  assert.deepEqual((await request(endpoint('eval'), '({value:document.querySelector("#name").value,events:window.inputEvents})')).body.value,
    { value: 'Ada', events: ['input', 'change'] });
  await request(endpoint('eval'), 'document.querySelector("#name").focus(); document.querySelector("#name").setSelectionRange(3,3); true');
  const inserted = await request(endpoint('insertText'), { selector: '#name', text: ' Lovelace' });
  assert.equal(inserted.body.focus_verified, true);
  assert.equal(inserted.body.status, 'dispatched');
  assert.equal(inserted.body.outcome_verified, false);
  assert.equal((await request(endpoint('eval'), 'document.querySelector("#name").value')).body.value, 'Ada Lovelace');
  const backspace = await request(endpoint('press'), { key: 'Backspace' });
  assert.equal(backspace.body.status, 'dispatched');
  assert.equal((await request(endpoint('eval'), 'document.querySelector("#name").value')).body.value, 'Ada Lovelac');
  const enter = await request(endpoint('press'), { key: 'Enter' });
  assert.equal(enter.body.status, 'dispatched');
  assert.equal(enter.body.outcome_verified, false);
  assert.deepEqual((await request(endpoint('eval'), '({keys:window.keyEvents,submits:window.formSubmits})')).body.value,
    { keys: ['Backspace', 'Enter'], submits: 1 });

  await request(endpoint('eval'), 'document.querySelector("#race-other").focus(); true');
  const racedInsert = await request(endpoint('insertText'), { selector: '#race-intended', text: '-unsafe' });
  assert.equal(racedInsert.status, 200);
  assert.equal(racedInsert.body.insertion_method, 'exact_target_dom_edit');
  assert.equal(racedInsert.body.keyboard_semantics, false);
  assert.equal(racedInsert.body.insert_target_verified, true);
  assert.deepEqual((await request(endpoint('eval'), '({a:document.querySelector("#race-intended").value,b:document.querySelector("#race-other").value})')).body.value,
    { a: 'first-unsafe', b: 'second' });

  const earlyInsert = await request(endpoint('insertText'), { selector: '#early-intended', text: '-unsafe' });
  assert.equal(earlyInsert.status, 409);
  assert.equal(earlyInsert.body.code, 'FOCUS_LOST');
  assert.deepEqual((await request(endpoint('eval'), '({a:document.querySelector("#early-intended").value,b:document.querySelector("#race-frame").contentDocument.querySelector("#inside").value})')).body.value,
    { a: 'early', b: 'iframe' });

  await request(endpoint('eval'), `(()=>{const target=document.querySelector('#editable');const range=document.createRange();
    range.selectNodeContents(target);range.collapse(false);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);target.focus();return true})()`);
  const editableInsert = await request(endpoint('insertText'), { selector: '#editable', text: '-exact' });
  assert.equal(editableInsert.status, 200);
  assert.equal(editableInsert.body.insert_target_verified, true);
  assert.deepEqual((await request(endpoint('eval'), '({a:document.querySelector("#editable").textContent,b:document.querySelector("#editable-other").textContent})')).body.value,
    { a: 'editable-exact', b: 'other' });

  await request(endpoint('eval'), 'window.armClickRace(); true');
  const racyClick = await request(endpoint('clickAt'), '#moving-click');
  assert.equal(racyClick.status, 409);
  assert.equal(racyClick.body.code, 'ELEMENT_OCCLUDED');
  assert.equal(racyClick.body.dispatch_target_verified, false);
  assert.equal((await request(endpoint('eval'), 'window.overlayClicks')).body.value, 0);

  await request(endpoint('eval'), 'setTimeout(()=>{window.promptResult=prompt("Fixture prompt","")},25); true');
  let dialog;
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 25));
    dialog = await request(endpoint('handleJsDialog'), { accept: true, prompt_text: 'confirmed' });
    if (dialog.status === 200) break;
  }
  assert.equal(dialog?.status, 200, JSON.stringify(dialog?.body));
  assert.equal(dialog.body.status, 'dispatched');
  assert.equal(dialog.body.outcome_verified, false);
  assert.equal((await request(endpoint('eval'), 'window.promptResult')).body.value, 'confirmed');
  for (const name of ['click', 'clickAt', 'setFiles']) {
    const body = name === 'setFiles' ? { selector: '.uploads', files: ['/tmp/not-uploaded.txt'] } : '.duplicate';
    const result = await request(endpoint(name), body);
    assert.equal(result.status, 400);
    assert.equal(result.body.code, 'SELECTOR_AMBIGUOUS');
    assert.equal(result.body.match_count, 2);
  }
  assert.equal((await request(endpoint('eval'), 'window.clicks')).body.value, 1);
  const before = (await request(endpoint('eval'), '({mutations:window.mutations,scrollY})')).body.value;
  const timeout = await request(endpoint('wait'), { conditions, timeout_ms: 80, poll_ms: 10 });
  assert.equal(timeout.status, 408);
  assert.equal(timeout.body.state, 'timeout');
  assert.deepEqual((await request(endpoint('eval'), '({mutations:window.mutations,scrollY})')).body.value, before);
  await request(endpoint('eval'), 'setTimeout(() => document.querySelector("#results").hidden=false, 100); true');
  const delayedResult = await request(endpoint('wait'), { conditions, timeout_ms: 2000, poll_ms: 20 });
  assert.equal(delayedResult.body.state, 'results_ready', JSON.stringify(delayedResult.body));
  await request(endpoint('eval'), 'document.querySelector("#empty").hidden=false');
  assert.equal((await request(endpoint('wait'), { conditions })).body.state, 'empty');
  await request(endpoint('eval'), 'document.querySelector("#challenge").hidden=false');
  assert.equal((await request(endpoint('wait'), { conditions })).body.state, 'blocked');
  await new Promise(resolve => fixtureServer.listen(0, '127.0.0.1', resolve));
  const slowUrl = `http://127.0.0.1:${fixtureServer.address().port}/slow`;
  const slow = await create(slowUrl, 40);
  assert.equal(slow.body.load_status, 'timeout');
  console.log('PASS: local browser reading, actions, wait, ambiguity, Promise, load-timeout and no-mutation fixtures');
} finally {
  for (const target of targets) await request(`/close?target=${target}`).catch(() => {});
  if (fixtureServer.listening) await new Promise(resolve => { fixtureServer.close(resolve); fixtureServer.closeAllConnections(); });
}
