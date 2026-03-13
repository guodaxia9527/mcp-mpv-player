# mcp-mpv-player

[中文文档](./README.zh.md)

Control mpv media player through AI conversation. Play music and video, manage playlists — all via natural language.

Works with [opencode](https://opencode.ai/) and any MCP-compatible AI tool.

## Installation

Make sure [Node.js](https://nodejs.org) is installed, then run:

```bash
npx mcp-mpv-player
```

The setup wizard will automatically:
- Detect or install mpv
- Locate your opencode config file
- Register the MCP tool

Restart opencode when done.

## Usage Examples

Just talk to your AI naturally:

```
Play D:/Music/song.mp3
Pause
Next track
Skip forward 30 seconds
Jump to 2 minutes 30 seconds
Set volume to 80
Create a playlist called "chill" with D:/Music/a.mp3 and D:/Music/b.mp3
Play the "chill" playlist
Shuffle
```

## Tools

### Playback Control

| Tool | Description |
|------|-------------|
| `player_play` | Play a file or URL, auto-starts mpv |
| `player_pause` | Toggle pause / resume |
| `player_stop` | Stop playback |
| `player_next` | Next track |
| `player_prev` | Previous track |
| `player_seek` | Seek by seconds / absolute time / percent |
| `player_set_volume` | Set volume (0–130) |
| `player_set_speed` | Set playback speed (0.5x / 1x / 2x …) |
| `player_status` | Get current playback status |
| `player_shuffle` | Shuffle playlist and play from the start |

### Playlist Management

| Tool | Description |
|------|-------------|
| `playlist_create` | Create a new playlist |
| `playlist_load` | Load and play a saved playlist |
| `playlist_add` | Add files to a playlist |
| `playlist_remove` | Remove a track from a playlist |
| `playlist_list` | List all playlists or inspect one |
| `playlist_delete` | Delete a playlist |

Playlists are saved as `.m3u` files in `%USERPROFILE%\mpv-playlists\`.

## Requirements

- Windows 10 / 11
- Node.js 18+
- mpv (can be installed automatically by the setup wizard)

## How It Works

mpv exposes a JSON IPC interface via a Windows Named Pipe (`\\.\pipe\mpv-ipc`). This tool runs as an MCP server, receives commands from the AI, and forwards them to mpv.

When `player_play` is called and mpv is not running, it is launched automatically with the IPC flag and stays running in the background between tracks.

## License

MIT
