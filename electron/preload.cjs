const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('presenter', {
  isElectron: true,
  listDisplays: () => ipcRenderer.invoke('displays:list'),
  openOutput: (displayId) => ipcRenderer.invoke('output:open', displayId),
  closeOutput: () => ipcRenderer.invoke('output:close'),
  webInfo: () => ipcRenderer.invoke('web:info'),
  sendState: (state) => ipcRenderer.send('output:state', state),
  onState: (cb) => {
    const h = (_e, s) => cb(s);
    ipcRenderer.on('output:state', h);
    return () => ipcRenderer.removeListener('output:state', h);
  },
  onOutputStatus: (cb) => {
    const h = (_e, s) => cb(s);
    ipcRenderer.on('output:status', h);
    return () => ipcRenderer.removeListener('output:status', h);
  },
  ndiStatus: () => ipcRenderer.invoke('ndi:status'),
  setNdi: (cfg) => ipcRenderer.invoke('ndi:config', cfg),
  onNdiStatus: (cb) => {
    const h = (_e, s) => cb(s);
    ipcRenderer.on('ndi:status', h);
    return () => ipcRenderer.removeListener('ndi:status', h);
  },
  sttStart: (opts) => ipcRenderer.invoke('stt:start', opts),
  sttStop: () => ipcRenderer.invoke('stt:stop'),
  sttTest: (key) => ipcRenderer.invoke('stt:test', key),
  sttAudio: (chunk) => ipcRenderer.send('stt:audio', chunk),
  onStt: (cb) => {
    const h = (_e, ev) => cb(ev);
    ipcRenderer.on('stt:event', h);
    return () => ipcRenderer.removeListener('stt:event', h);
  },
  modelsList: () => ipcRenderer.invoke('models:list'),
  modelsDownload: (id) => ipcRenderer.invoke('models:download', id),
  modelsInstallFile: (id) => ipcRenderer.invoke('models:installFile', id),
  modelsRemove: (id) => ipcRenderer.invoke('models:remove', id),
  modelsUrl: (id) => ipcRenderer.invoke('models:url', id),
  onModelsProgress: (cb) => {
    const h = (_e, p) => cb(p);
    ipcRenderer.on('models:progress', h);
    return () => ipcRenderer.removeListener('models:progress', h);
  },
  updateStatus: () => ipcRenderer.invoke('update:status'),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  onUpdate: (cb) => {
    const h = (_e, s) => cb(s);
    ipcRenderer.on('update:status', h);
    return () => ipcRenderer.removeListener('update:status', h);
  },
  yvVersions: (key, lang) => ipcRenderer.invoke('yv:versions', key, lang),
  yvVersion: (key, id) => ipcRenderer.invoke('yv:version', key, id),
  yvIndex: (key, id, offline) => ipcRenderer.invoke('yv:index', key, id, offline),
  yvChapter: (key, id, usfm, offline) => ipcRenderer.invoke('yv:chapter', key, id, usfm, offline),
  yvCacheStats: (id) => ipcRenderer.invoke('yv:cacheStats', id),
  yvCacheClear: (id) => ipcRenderer.invoke('yv:cacheClear', id),
  yvDownloadAll: (key, id) => ipcRenderer.invoke('yv:downloadAll', key, id),
  yvCancelDownload: (id) => ipcRenderer.invoke('yv:cancelDownload', id),
  onYvProgress: (cb) => {
    const h = (_e, p) => cb(p);
    ipcRenderer.on('yv:progress', h);
    return () => ipcRenderer.removeListener('yv:progress', h);
  },
  biblesList: () => ipcRenderer.invoke('bibles:list'),
  biblesSave: (id, name, json) => ipcRenderer.invoke('bibles:save', id, name, json),
  biblesRead: (id) => ipcRenderer.invoke('bibles:read', id),
  biblesRemove: (id) => ipcRenderer.invoke('bibles:remove', id),
  onDisplaysChanged: (cb) => {
    const h = () => cb();
    ipcRenderer.on('displays:changed', h);
    return () => ipcRenderer.removeListener('displays:changed', h);
  },
});
