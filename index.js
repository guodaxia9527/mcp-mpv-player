#!/usr/bin/env node
/**
 * mpv-mcp: MCP server for controlling mpv media player on Windows
 * Communication via Named Pipe IPC: \\.\pipe\mpv-ipc
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import net from "net";
import { spawn, spawnSync } from "child_process";
import readline from "readline";
import fs from "fs";
import path from "path";
import os from "os";

// ── Config ────────────────────────────────────────────────────────────────────
const PIPE_PATH = "\\\\.\\pipe\\mpv-ipc";
const PLAYLIST_DIR = path.join(os.homedir(), "mpv-playlists");
const MPV_BINARY = process.env.MPV_PATH || "mpv"; // set MPV_PATH env if not in PATH

if (!fs.existsSync(PLAYLIST_DIR)) fs.mkdirSync(PLAYLIST_DIR, { recursive: true });


// ═════════════════════════════════════════════════════════════════════════════
// ── Install Wizard ────────────────────────────────────────────────────────────
// ═════════════════════════════════════════════════════════════════════════════
function detectMpvInPath() {
  try {
    const result = spawnSync("where.exe", ["mpv"], { encoding: "utf8" });
    return result.status === 0 && result.stdout.trim().length > 0;
  } catch { return false; }
}

function detectMpv() {
  try {
    const result = spawnSync("where.exe", ["mpv"], { encoding: "utf8" });
    if (result.status === 0 && result.stdout.trim())
      return result.stdout.trim().split("\n")[0].trim();
  } catch {}
  const candidates = [
    "C:\\Program Files\\MPV Player\\mpv.exe",
    "C:\\Program Files (x86)\\MPV Player\\mpv.exe",
    path.join(os.homedir(), "scoop\\apps\\mpv\\current\\mpv.exe"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function runInstallWizard() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((res) => rl.question(q, res));

  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║      mcp-mpv-player 安装向导              ║");
  console.log("╚══════════════════════════════════════════╝\n");

  // Step 1: 检测 mpv
  console.log("【第一步】检测 mpv 播放器...");
  let mpvPath = detectMpv();

  if (mpvPath) {
    console.log(`✅ 已找到 mpv: ${mpvPath}\n`);
  } else {
    console.log("❌ 未检测到 mpv\n");
    console.log("请选择安装方式：");
    console.log("  1. 自动安装（推荐）: winget install shinchiro.mpv");
    console.log("  2. 手动下载: https://mpv.io/installation/");
    console.log("  3. 我已安装，手动输入 mpv.exe 路径");
    const choice = (await ask("\n请输入选择 (1/2/3): ")).trim();

    if (choice === "1") {
      console.log("\n正在安装 mpv，请稍候...\n");
      await new Promise((resolve) => {
        const proc = spawn("winget", ["install", "shinchiro.mpv", "--accept-source-agreements", "--accept-package-agreements"], {
          stdio: "inherit",
          shell: false,
        });
        proc.on("close", (code) => {
          if (code === 0) {
            console.log("\n✅ mpv 安装成功！");
            console.log("⚠️  请关闭此窗口，重新打开终端后再次运行 npx mcp-mpv-player 继续安装。");
          } else {
            console.log("\n❌ 自动安装失败，请手动下载: https://mpv.io/installation/");
          }
          resolve();
        });
      });
      rl.close(); process.exit(0);
    } else if (choice === "2") {
      console.log("\n请前往 https://mpv.io/installation/ 下载安装后，重新运行 npx mcp-mpv-player");
      rl.close(); process.exit(0);
    } else if (choice === "3") {
      const inputPath = (await ask("请输入 mpv.exe 的完整路径: ")).trim().replace(/^"|"$/g, "");
      if (!fs.existsSync(inputPath)) {
        console.log("❌ 路径不存在，请检查后重新运行");
        rl.close(); process.exit(1);
      }
      mpvPath = inputPath;
      console.log(`✅ 已设置 mpv 路径: ${mpvPath}\n`);
    } else {
      console.log("❌ 无效选择，请重新运行");
      rl.close(); process.exit(1);
    }
  }

  // Step 2: 当前脚本路径
  console.log("【第二步】确认安装路径...");
  const scriptPath = path.resolve(process.argv[1]);
  console.log(`✅ 工具路径: ${scriptPath}\n`);

  // Step 3: 找 opencode 配置文件
  console.log("【第三步】查找 opencode 配置文件...");
  const defaultConfigPath = path.join(os.homedir(), ".config", "opencode", "opencode.json");
  let configPath = null;

  if (fs.existsSync(defaultConfigPath)) {
    console.log(`✅ 已找到配置文件: ${defaultConfigPath}`);
    const confirm = (await ask("使用此路径？(Y/n): ")).trim().toLowerCase();
    if (confirm === "" || confirm === "y") configPath = defaultConfigPath;
  }

  if (!configPath) {
    const inputPath = (await ask("请输入 opencode config.json 的完整路径: ")).trim().replace(/^"|"$/g, "");
    if (!fs.existsSync(inputPath)) {
      console.log("❌ 配置文件不存在，请检查后重新运行");
      rl.close(); process.exit(1);
    }
    configPath = inputPath;
  }
  console.log();

  // Step 4: 注入配置
  console.log("【第四步】注册到 opencode...");
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    console.log("❌ 配置文件格式错误，无法解析 JSON");
    rl.close(); process.exit(1);
  }

  if (!config.mcp) config.mcp = {};

  if (config.mcp["mcp-mpv-player"]) {
    console.log("⚠️  检测到已有 mcp-mpv-player 配置");
    const overwrite = (await ask("是否覆盖？(y/N): ")).trim().toLowerCase();
    if (overwrite !== "y") {
      console.log("已取消，保留原有配置。");
      rl.close(); process.exit(0);
    }
  }

  const entry = { type: "local", command: ["node", scriptPath], enabled: true };
  if (!detectMpvInPath()) entry.environment = { MPV_PATH: mpvPath };
  config.mcp["mcp-mpv-player"] = entry;

  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
  } catch {
    console.log("❌ 写入配置文件失败，请检查文件权限");
    rl.close(); process.exit(1);
  }

  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║           ✅ 安装完成！                   ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log(`\n配置文件: ${configPath}`);
  console.log("\n请重启 opencode 使配置生效。");
  console.log("之后你可以对 AI 说「播放 D:/Music/xxx.mp3」来控制播放器。\n");
  rl.close();
}

// 入口：区分安装向导 vs MCP server 模式
if (process.stdin.isTTY) {
  await runInstallWizard();
  process.exit(0);
}

// ── IPC helpers ───────────────────────────────────────────────────────────────
function ipcCommand(cmd) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(PIPE_PATH);
    let buffer = "";
    const timer = setTimeout(() => {
      client.destroy();
      reject(new Error("IPC timeout"));
    }, 3000);

    client.on("connect", () => client.write(JSON.stringify(cmd) + "\n"));
    client.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.request_id !== undefined || msg.error !== undefined) {
            clearTimeout(timer);
            client.destroy();
            if (msg.error && msg.error !== "success") {
              reject(new Error(msg.error));
            } else {
              resolve(msg.data);
            }
            return;
          }
        } catch (_) {}
      }
    });
    client.on("error", (err) => { clearTimeout(timer); reject(err); });
  });
}

let reqId = 1;
async function mpv(command, args = []) {
  return ipcCommand({ command: [command, ...args], request_id: reqId++ });
}

async function getProperty(prop) {
  return ipcCommand({ command: ["get_property", prop], request_id: reqId++ });
}

async function setProperty(prop, value) {
  return ipcCommand({ command: ["set_property", prop, value], request_id: reqId++ });
}

// ── mpv process management ────────────────────────────────────────────────────
function isMpvRunning() {
  return new Promise((resolve) => {
    const client = net.createConnection(PIPE_PATH);
    client.on("connect", () => { client.destroy(); resolve(true); });
    client.on("error", () => resolve(false));
  });
}

async function ensureMpv(filePath = null) {
  const running = await isMpvRunning();
  if (running) return { started: false };

  const args = [
    "--input-ipc-server=" + PIPE_PATH,
    "--idle=yes",
    "--keep-open=yes",
    "--no-terminal",
  ];
  if (filePath) args.push(filePath);

  const proc = spawn(MPV_BINARY, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  proc.unref();

  // Wait for pipe to be ready
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await isMpvRunning()) return { started: true };
  }
  throw new Error(
    "mpv failed to start. Make sure mpv is installed and in PATH, or set MPV_PATH environment variable."
  );
}

// ── Playlist helpers ──────────────────────────────────────────────────────────
function listPlaylists() {
  return fs
    .readdirSync(PLAYLIST_DIR)
    .filter((f) => f.endsWith(".m3u"))
    .map((f) => f.replace(".m3u", ""));
}

function playlistPath(name) {
  return path.join(PLAYLIST_DIR, name.replace(/[/\\?%*:|"<>]/g, "_") + ".m3u");
}

function readPlaylist(name) {
  const p = playlistPath(name);
  if (!fs.existsSync(p)) throw new Error(`Playlist "${name}" not found`);
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

function writePlaylist(name, files) {
  const content = "#EXTM3U\n" + files.join("\n") + "\n";
  fs.writeFileSync(playlistPath(name), content, "utf8");
}

// ── Formatting helpers ────────────────────────────────────────────────────────
function formatTime(secs) {
  if (secs == null) return "N/A";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function ok(msg) {
  return { content: [{ type: "text", text: `✅ ${msg}` }] };
}
function info(msg) {
  return { content: [{ type: "text", text: msg }] };
}
function fail(msg) {
  return { content: [{ type: "text", text: `❌ ${msg}` }], isError: true };
}

// ── Tool definitions ──────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "player_play",
    description:
      "Open and play a media file or URL. If mpv is not running, it will be launched automatically.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute file path or URL (http/https/rtmp etc.)",
        },
        append: {
          type: "boolean",
          description: "Append to current playlist instead of replacing it",
          default: false,
        },
      },
      required: ["path"],
    },
  },
  {
    name: "player_pause",
    description: "Toggle pause / resume playback.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "player_stop",
    description: "Stop playback and clear the current file.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "player_next",
    description: "Skip to the next item in the playlist.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "player_prev",
    description: "Go back to the previous item in the playlist.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "player_seek",
    description: "Seek within the current media.",
    inputSchema: {
      type: "object",
      properties: {
        value: {
          type: "number",
          description:
            "Seconds to seek (positive = forward, negative = backward) when mode=relative. Absolute second when mode=absolute. 0-100 when mode=percent.",
        },
        mode: {
          type: "string",
          enum: ["relative", "absolute", "percent"],
          default: "relative",
          description: "Seek mode",
        },
      },
      required: ["value"],
    },
  },
  {
    name: "player_set_volume",
    description: "Set playback volume (0–130). 100 is default.",
    inputSchema: {
      type: "object",
      properties: {
        volume: { type: "number", description: "Volume level 0–130" },
      },
      required: ["volume"],
    },
  },
  {
    name: "player_set_speed",
    description: "Set playback speed multiplier. 1.0 = normal speed.",
    inputSchema: {
      type: "object",
      properties: {
        speed: {
          type: "number",
          description: "Speed multiplier e.g. 0.5, 1.0, 1.5, 2.0",
        },
      },
      required: ["speed"],
    },
  },
  {
    name: "player_status",
    description:
      "Get current playback status: file name, position, duration, volume, speed, pause state.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "player_shuffle",
    description: "Randomly shuffle the current playlist and start playing from the first track.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "playlist_load",
    description: "Load a saved playlist by name and start playing it.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Playlist name (without .m3u)" },
      },
      required: ["name"],
    },
  },
  {
    name: "playlist_create",
    description: "Create a new playlist with a list of file paths.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Playlist name" },
        files: {
          type: "array",
          items: { type: "string" },
          description: "Array of absolute file paths or URLs",
        },
      },
      required: ["name", "files"],
    },
  },
  {
    name: "playlist_add",
    description: "Add files to an existing playlist.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Playlist name" },
        files: {
          type: "array",
          items: { type: "string" },
          description: "Files to append",
        },
      },
      required: ["name", "files"],
    },
  },
  {
    name: "playlist_remove",
    description: "Remove a file from a saved playlist by index (0-based).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Playlist name" },
        index: { type: "number", description: "0-based index to remove" },
      },
      required: ["name", "index"],
    },
  },
  {
    name: "playlist_list",
    description: "List all saved playlists or show contents of a specific playlist.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Playlist name to inspect (omit to list all playlists)",
        },
      },
    },
  },
  {
    name: "playlist_delete",
    description: "Delete a saved playlist file.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Playlist name to delete" },
      },
      required: ["name"],
    },
  },
];

// ── Tool handlers ─────────────────────────────────────────────────────────────
async function handleTool(name, args) {
  try {
    switch (name) {
      // ── Playback controls ──────────────────────────────────────────────────
      case "player_play": {
        await ensureMpv();
        const flag = args.append ? "append-play" : "replace";
        await mpv("loadfile", [args.path, flag]);

        // If it's a video file, bring mpv window to foreground
        const VIDEO_EXTS = new Set([
          "mp4","mkv","avi","mov","wmv","flv","webm","m4v",
          "mpg","mpeg","ts","rmvb","3gp","ogv","hevc"
        ]);
        const ext = args.path.split(".").pop().toLowerCase().split("?")[0];
        if (VIDEO_EXTS.has(ext)) {
          // Wait for mpv to open the video window, then restore + focus
          await new Promise((r) => setTimeout(r, 800));
          await mpv("focus").catch(() => null);
          spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command",
            "(New-Object -ComObject Shell.Application).Windows() | ForEach-Object { if ($_.FullName -like '*mpv*') { $_.Visible = $true } };" +
            "$wshell = New-Object -ComObject wscript.shell;" +
            "$wshell.AppActivate('mpv')"
          ], { detached: true, stdio: "ignore" }).unref();
        }

        await setProperty("pause", false);
        return ok(`Playing: ${args.path}`);
      }

      case "player_pause": {
        await ensureMpv();
        await mpv("cycle", ["pause"]);
        const paused = await getProperty("pause");
        return ok(paused ? "Paused" : "Resumed");
      }

      case "player_stop": {
        await ensureMpv();
        await mpv("stop");
        return ok("Stopped");
      }

      case "player_next": {
        await ensureMpv();
        const plCount = await getProperty("playlist-count").catch(() => 0);
        const plPos = await getProperty("playlist-pos").catch(() => 0);
        if (plCount <= 1 || plPos >= plCount - 1) {
          return fail("已经是最后一首，没有下一曲");
        }
        await mpv("playlist-next", ["weak"]);
        await setProperty("pause", false);
        const nextTitle = await getProperty("media-title").catch(() => null);
        return ok(`Playing next: ${nextTitle || "unknown"}`);
      }

      case "player_prev": {
        await ensureMpv();
        const plPosPrev = await getProperty("playlist-pos").catch(() => 0);
        if (plPosPrev <= 0) {
          return fail("已经是第一首，没有上一曲");
        }
        await mpv("playlist-prev", ["weak"]);
        await setProperty("pause", false);
        const prevTitle = await getProperty("media-title").catch(() => null);
        return ok(`Playing previous: ${prevTitle || "unknown"}`);
      }

      case "player_seek": {
        await ensureMpv();
        const mode = args.mode || "relative";
        await mpv("seek", [args.value, mode]);
        const pos = await getProperty("time-pos");
        return ok(`Seeked → ${formatTime(pos)}`);
      }

      case "player_set_volume": {
        await ensureMpv();
        await setProperty("volume", Math.max(0, Math.min(130, args.volume)));
        return ok(`Volume set to ${args.volume}`);
      }

      case "player_set_speed": {
        await ensureMpv();
        await setProperty("speed", args.speed);
        return ok(`Speed set to ${args.speed}x`);
      }

      case "player_status": {
        const running = await isMpvRunning();
        if (!running) return info("mpv is not running.");

        const [filename, pos, dur, paused, vol, speed, plPos, plCount] =
          await Promise.all([
            getProperty("media-title").catch(() => null),
            getProperty("time-pos").catch(() => null),
            getProperty("duration").catch(() => null),
            getProperty("pause").catch(() => null),
            getProperty("volume").catch(() => null),
            getProperty("speed").catch(() => null),
            getProperty("playlist-pos").catch(() => null),
            getProperty("playlist-count").catch(() => null),
          ]);

        const lines = [
          `🎵 **Now playing:** ${filename || "N/A"}`,
          `⏱  **Position:** ${formatTime(pos)} / ${formatTime(dur)}`,
          `${paused ? "⏸" : "▶️"}  **State:** ${paused ? "Paused" : "Playing"}`,
          `🔊 **Volume:** ${vol != null ? Math.round(vol) : "N/A"}`,
          `⚡ **Speed:** ${speed != null ? speed + "x" : "N/A"}`,
          `📋 **Playlist:** ${plPos != null ? plPos + 1 : "N/A"} / ${plCount ?? "N/A"}`,
        ];
        return info(lines.join("\n"));
      }

      case "player_shuffle": {
        await ensureMpv();
        const count = await getProperty("playlist-count").catch(() => 0);
        if (!count || count < 2) return fail("Need at least 2 tracks in the playlist to shuffle");
        await mpv("playlist-shuffle");
        await mpv("playlist-play-index", [0]);
        await setProperty("pause", false);
        const title = await getProperty("media-title").catch(() => null);
        return ok(`Playlist shuffled (${count} tracks). Now playing: ${title || "unknown"}`);
      }

      // ── Playlist management ────────────────────────────────────────────────
      case "playlist_load": {
        const p = playlistPath(args.name);
        if (!fs.existsSync(p))
          return fail(`Playlist "${args.name}" not found. Use playlist_list to see available playlists.`);
        await ensureMpv();
        await mpv("loadlist", [p, "replace"]);
        return ok(`Loaded playlist "${args.name}"`);
      }

      case "playlist_create": {
        if (!args.files || args.files.length === 0)
          return fail("files array cannot be empty");
        writePlaylist(args.name, args.files);
        return ok(
          `Created playlist "${args.name}" with ${args.files.length} item(s)\nSaved to: ${playlistPath(args.name)}`
        );
      }

      case "playlist_add": {
        const existing = readPlaylist(args.name);
        writePlaylist(args.name, [...existing, ...args.files]);
        return ok(
          `Added ${args.files.length} item(s) to "${args.name}" (total: ${existing.length + args.files.length})`
        );
      }

      case "playlist_remove": {
        const files = readPlaylist(args.name);
        if (args.index < 0 || args.index >= files.length)
          return fail(`Index ${args.index} out of range (0–${files.length - 1})`);
        const removed = files.splice(args.index, 1);
        writePlaylist(args.name, files);

        // Also remove from live mpv queue if running
        if (await isMpvRunning()) {
          const currentPos = await getProperty("playlist-pos").catch(() => null);
          const plCount = await getProperty("playlist-count").catch(() => 0);
          // Find matching entry in mpv's live playlist
          let liveIndex = null;
          for (let i = 0; i < plCount; i++) {
            const entry = await getProperty(`playlist/${i}/filename`).catch(() => null);
            if (entry && (entry === removed[0] || entry.replace(/\\/g, "/") === removed[0].replace(/\\/g, "/"))) {
              liveIndex = i;
              break;
            }
          }
          if (liveIndex !== null) {
            await mpv("playlist-remove", [liveIndex]);
            // If we removed the currently playing track, mpv auto-advances;
            // make sure it's playing (not paused)
            if (liveIndex === currentPos) {
              await setProperty("pause", false);
            }
          }
        }

        return ok(`Removed "${removed[0]}" from "${args.name}" (live queue updated)`);
      }

      case "playlist_list": {
        if (args.name) {
          const files = readPlaylist(args.name);
          const lines = files.map((f, i) => `  ${i}. ${f}`);
          return info(`📋 Playlist "${args.name}" (${files.length} items):\n${lines.join("\n")}`);
        }
        const playlists = listPlaylists();
        if (playlists.length === 0) return info("No playlists found. Use playlist_create to make one.");
        return info(`📁 Saved playlists (${PLAYLIST_DIR}):\n${playlists.map((p) => `  • ${p}`).join("\n")}`);
      }

      case "playlist_delete": {
        const p = playlistPath(args.name);
        if (!fs.existsSync(p)) return fail(`Playlist "${args.name}" not found`);
        fs.unlinkSync(p);
        return ok(`Deleted playlist "${args.name}"`);
      }

      default:
        return fail(`Unknown tool: ${name}`);
    }
  } catch (err) {
    if (err.message?.includes("ENOENT") || err.message?.includes("IPC timeout")) {
      return fail(
        `Cannot connect to mpv. Make sure mpv is running with:\n  mpv --input-ipc-server=\\\\.\\pipe\\mpv-ipc --idle\n\nOr use player_play to start it automatically.\n\nError: ${err.message}`
      );
    }
    return fail(err.message);
  }
}

// ── MCP Server ────────────────────────────────────────────────────────────────
const server = new Server(
  { name: "mcp-mpv-player", version: "1.2.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return handleTool(name, args || {});
});

const transport = new StdioServerTransport();
await server.connect(transport);
