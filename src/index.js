const { app, BrowserWindow, session, ipcMain } = require("electron");
const { autoUpdater, AppUpdater } = require("electron-updater");
const path = require("path");
const axios = require("axios");
const express = require("express");
const http = require("http");
const https = require("https");
const DiscordRPC = require("discord-rpc");

const clientId = "1307966634455076874";
DiscordRPC.register(clientId);
const rpc = new DiscordRPC.Client({ transport: "ipc" });

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

const interceptedUrls = new Map();

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
  keepAlive: true,
  minVersion: "TLSv1.2",
});

let mainWindow;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    icon: "icon.ico",
    width: 400,
    height: 400,
    minWidth: 400,
    minHeight: 400,
    titleBarStyle: "hidden",
    frame: false,
    // ...(process.platform !== "darwin" ? { titleBarOverlay: true } : {}),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // devTools: true,
      preload: path.join(__dirname, "preload.js"),
    },
    autoHideMenuBar: true,
  });

  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;

    if (
      (url.includes(".m3u8") || url.includes("vumeto-electron-proxy")) &&
      !url.startsWith("http://localhost:3939")
    ) {
      // console.log("Intercepting URL:", url);
      callback({
        redirectURL: `http://localhost:3939/fetch?url=${encodeURIComponent(
          url
        )}`,
      });
      return;
    }

    callback({ cancel: false });
  });

  // mainWindow.loadURL(
  //   "http://localhost:3000/home?source=capacitor&platform=electron"
  // );
  mainWindow.loadURL(
    "https://vumeto.com/home?source=capacitor&platform=electron"
  );
};

const startProxyServer = () => {
  const app = express();
  const PORT = 3939;

  // Allow CORS for all requests
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    next();
  });

  app.get("/fetch", async (req, res) => {
    const { url, ref, to } = req.query;

    if (!url) {
      return res.status(400).send("Missing URL parameter");
    }

    if (interceptedUrls.has(url)) {
      return res.send(interceptedUrls.get(url));
    }

    const headResponse = await axios.head(url, {
      headers: ref ? { Referer: ref } : {},
    });
    const contentType = headResponse.headers["content-type"];

    const responseType =
      contentType?.startsWith("image/") || contentType?.includes("arraybuffer")
        ? "arraybuffer"
        : contentType?.includes("json")
        ? "json"
        : "text";

    try {
      const response = await axios({
        method: "get",
        url,
        responseType: responseType,
        headers: ref ? { Referer: ref } : {},
        httpsAgent,
      });

      if (responseType === "json") {
        res.json(response.data);
        return;
      }

      if (
        contentType.includes("application/vnd.apple.mpegurl") ||
        url.endsWith(".m3u8")
      ) {
        let m3u8Content = response.data.toString("utf-8");

        const baseDomain = "localhost:3939";
        const baseFetchUrl = `http://${baseDomain}/fetch?url=`;
        const baseSegmentUrl = `http://${baseDomain}/segment?url=`;

        m3u8Content = m3u8Content.replace(
          /([^\s]+\.(ts|jpg|png|webp|gif|xml|svg))/g,
          (match) => {
            const absoluteUrl = new URL(match, url).href;
            return `${baseSegmentUrl}${encodeURIComponent(absoluteUrl)}`;
          }
        );

        m3u8Content = m3u8Content.replace(
          /URI="([^"]+\.key)"/g,
          (match, keyUrl) => {
            const absoluteUrl = new URL(decodeURIComponent(keyUrl), url).href;
            return `URI="${baseSegmentUrl}${encodeURIComponent(absoluteUrl)}"`;
          }
        );

        m3u8Content = m3u8Content.replace(/([^\s]+\.m3u8)/g, (match) => {
          const absoluteUrl = new URL(match, url).href;
          return `${baseFetchUrl}${encodeURIComponent(absoluteUrl)}`;
        });

        res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        res.setHeader("Content-Disposition", "inline");
        res.setHeader("Connection", "Keep-Alive");
        interceptedUrls.set(url, m3u8Content);
        res.send(m3u8Content);
        return;
      }

      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", "inline");

      interceptedUrls.set(url, response.data);
      res.send(response.data);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error("Axios error details:", {
          message: error.message,
          response: error.response?.data,
          headers: error.config?.headers ?? {},
        });
      }
      res.status(500).json({ error: "Failed to proxy content" });
    }
  });

  app.get("/segment", async (req, res) => {
    const { url } = req.query;

    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "No URL provided" });
    }

    try {
      const response = await axios({
        method: "get",
        url,
        responseType: "arraybuffer",
        headers: {
          Connection: "keep-alive",
        },
        httpsAgent,
      });

      const contentType = url.endsWith(".jpg")
        ? "video/MP2T"
        : response.headers["content-type"] || "video/MP2T";
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", "inline");
      res.setHeader("Connection", "Keep-Alive");
      res.send(response.data);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error("Axios error details:", {
          message: error.message,
          response: error.response?.data,
          headers: error.config?.headers ?? {},
        });
      }
      res.status(500).json({ error: "Failed to proxy video segment" });
    }
  });

  const server = http.createServer(app);
  server.listen(PORT, () => {
    console.log(`Proxy server running on http://localhost:${PORT}`);
  });
};

app.whenReady().then(() => {
  startProxyServer();
  createWindow();
  rpc.on("ready", () => console.log("Discord RPC Ready"));
  rpc.login({ clientId }).catch(console.error);

  autoUpdater.checkForUpdates();
});

ipcMain.on("window-minimize", (event) => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.minimize();
});

ipcMain.on("window-maximize", (event) => {
  const win = BrowserWindow.getFocusedWindow();
  if (win.isMaximized()) {
    win.restore();
  } else {
    win.maximize();
  }
});

ipcMain.on("window-close", (event) => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.close();
});

ipcMain.handle("get-app-version", () => app.getVersion());

ipcMain.handle("update-app", () => autoUpdater.quitAndInstall());

ipcMain.on("update-discord-activity", (event, { animeName, episodeNumber }) => {
  let activityDetails = `Watching ${animeName}`;
  let activityState = `Episode ${episodeNumber}`;

  rpc
    .setActivity({
      details: activityDetails,
      state: activityState,
      startTimestamp: new Date(),
      largeImageKey: "logo_dark",
      largeImageText: "Streaming on Vumeto",
      instance: false,
    })
    .catch((err) => console.error("Failed to update activity:", err));
});

autoUpdater.on("checking-for-update", () => {
  mainWindow.webContents.send("update-status", "Checking for updates...");
});

autoUpdater.on("update-available", () => {
  mainWindow.webContents.send("update-status", "Downloading update...");
});

autoUpdater.on("update-not-available", () => {
  mainWindow.webContents.send("update-status", "Up to Date");
});

autoUpdater.on("download-progress", (progress) => {
  mainWindow.webContents.send(
    "update-status",
    `Downloading: ${Math.floor(progress.percent)}%`
  );
});

autoUpdater.on("update-downloaded", () => {
  mainWindow.webContents.send("update-status", "Update app");
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
