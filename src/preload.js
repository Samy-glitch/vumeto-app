const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  minimize: () => ipcRenderer.send("window-minimize"),
  maximize: () => ipcRenderer.send("window-maximize"),
  close: () => ipcRenderer.send("window-close"),
  updateActivity: (animeName, episodeNumber) =>
    ipcRenderer.send("update-discord-activity", { animeName, episodeNumber }),
  version: () => ipcRenderer.invoke("get-app-version"),
  onUpdateStatus: (callback) =>
    ipcRenderer.on("update-status", (_event, status) => callback(status)),
  updateApp: () => ipcRenderer.send("update-app"),
});
