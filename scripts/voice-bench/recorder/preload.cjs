const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('bench', {
  list: () => ipcRenderer.invoke('bench:list'),
  save: (id, text, samples, rate) => ipcRenderer.invoke('bench:save', id, text, samples, rate),
  load: (id) => ipcRenderer.invoke('bench:load', id)
})
