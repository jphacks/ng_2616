// CAS Web Worker (module). Loads a pinned Pyodide distribution, SymPy, and the fixed cas_core
// package from this app's own origin, then runs verification for validated IR only.
// No user-supplied Python is ever executed; the main thread terminates this worker on timeout.

let api = null;

async function init({ indexURL, casBase }) {
  const { loadPyodide } = await import(`${indexURL}pyodide.mjs`);
  const py = await loadPyodide({ indexURL });
  await py.loadPackage(['sympy']);
  const manifest = await (await fetch(`${casBase}manifest.json`, { cache: 'no-cache' })).json();
  py.FS.mkdirTree('/home/pyodide/cas_core');
  for (const file of manifest.files) {
    const res = await fetch(`${casBase}${file}?v=${manifest.digest}`);
    if (!res.ok) throw new Error(`failed to load ${file}`);
    py.FS.writeFile(`/home/pyodide/cas_core/${file}`, await res.text());
  }
  py.runPython("import sys\nif '/home/pyodide' not in sys.path:\n    sys.path.insert(0, '/home/pyodide')\nimport cas_core.api");
  api = py.pyimport('cas_core.api');
  const versions = JSON.parse(py.runPython('import json, cas_core.api as a\njson.dumps(a.versions())'));
  return { ...versions, pyodide: py.version, digest: manifest.digest };
}

self.onmessage = async (event) => {
  const msg = event.data;
  if (msg.type === 'init') {
    try {
      const versions = await init(msg);
      self.postMessage({ type: 'ready', versions });
    } catch (e) {
      self.postMessage({ type: 'failed', error: String((e && e.message) || e) });
    }
    return;
  }
  if (msg.type === 'verify') {
    if (!api) {
      self.postMessage({ type: 'error', id: msg.id, error: 'CAS not ready' });
      return;
    }
    try {
      const out = api.verify_json(JSON.stringify(msg.payload));
      self.postMessage({ type: 'result', id: msg.id, proof: JSON.parse(out) });
    } catch (e) {
      self.postMessage({ type: 'error', id: msg.id, error: String((e && e.message) || e) });
    }
  }
};
