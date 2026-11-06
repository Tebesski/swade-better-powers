async function swadeToolsScriptBase() {
  const id = "swade-tools";
  const local = new URL(`${foundry.utils.getRoute(`modules/${id}`)}/`, window.location.href);
  const forge = globalThis.ForgeVTT;
  if (!forge?.usingTheForge) return local;

  const {version, esmodules} = game.modules.get(id);
  const cdn = new URL(`bazaar/modules/${id}/${version}/`, forge.ASSETS_LIBRARY_URL_PREFIX);
  const isCdnUrl = url => url.startsWith(cdn.href);

  // Match Forge's loaded module graph so wrappers patch its existing classes.
  if (Array.from(document.scripts).some(script => isCdnUrl(script.src)) ||
      performance.getEntriesByType("resource").some(entry => isCdnUrl(entry.name))) return cdn;

  const [entry] = esmodules;
  if (!entry) return local;
  const response = await fetch(new URL(entry, local), {method: "HEAD"}).catch(() => null);
  return response?.ok && isCdnUrl(response.url) ? cdn : local;
}

export async function importSwadeTools(...paths) {
  const base = await swadeToolsScriptBase();
  return Promise.all(paths.map(path => import(new URL(path, base).href)));
}
