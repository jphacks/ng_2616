// Graph Web Worker (module). Loads the same pinned Pyodide as the CAS worker, plus numpy and
// matplotlib, and draws graph-line specs with the fixed cas_core.graph module from this app's
// own origin. Specs carry validated MathJSON only; no model- or user-written Python is run.
// It is a separate worker so a slow drawing never holds up a CAS check.

let api = null;

async function init({ indexURL, casBase }) {
  const { loadPyodide } = await import(`${indexURL}pyodide.mjs`);
  const py = await loadPyodide({ indexURL });
  await py.loadPackage(['sympy', 'numpy', 'matplotlib']);
  const manifest = await (await fetch(`${casBase}manifest.json`, { cache: 'no-cache' })).json();
  py.FS.mkdirTree('/home/pyodide/cas_core');
  for (const file of manifest.files) {
    const res = await fetch(`${casBase}${file}?v=${manifest.digest}`);
    if (!res.ok) throw new Error(`failed to load ${file}`);
    py.FS.writeFile(`/home/pyodide/cas_core/${file}`, await res.text());
  }
  py.runPython("import sys\nif '/home/pyodide' not in sys.path:\n    sys.path.insert(0, '/home/pyodide')\nimport cas_core.graph");
  api = py.pyimport('cas_core.graph');
  const versions = JSON.parse(py.runPython('import json, cas_core.graph as g\njson.dumps(g.versions())'));
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
  if (msg.type === 'render') {
    if (!api) {
      self.postMessage({ type: 'error', id: msg.id, error: 'graph worker not ready' });
      return;
    }
    try {
      const out = api.render_json(JSON.stringify(msg.spec));
      self.postMessage({ type: 'result', id: msg.id, result: JSON.parse(out) });
    } catch (e) {
      self.postMessage({ type: 'error', id: msg.id, error: String((e && e.message) || e) });
    }
  }
};
