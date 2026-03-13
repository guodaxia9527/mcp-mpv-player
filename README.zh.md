# mcp-mpv-player

[English](./README.md)

通过 AI 对话控制 mpv 播放器，支持播放音乐、视频，管理播放列表。

适用于 [opencode](https://opencode.ai/) 等支持 MCP 协议的 AI 编程工具。

## 安装

确保电脑上已安装 [Node.js](https://nodejs.org)，然后运行：

```bash
npx mcp-mpv-player
```

安装向导会自动完成以下步骤：
- 检测或安装 mpv 播放器
- 找到 opencode 配置文件
- 自动注册 MCP 工具

完成后重启 opencode 即可使用。

## 使用示例

安装完成后，直接用自然语言对 AI 说：

```
播放 D:/Music/周杰伦 - 晴天.mp3
暂停
下一曲
快进30秒
跳到第2分30秒
音量调到80
创建一个叫 "周末" 的播放列表，包含 D:/Music/a.mp3 和 D:/Music/b.mp3
播放 "周末" 播放列表
随机播放
```

## 功能列表

### 播放控制

| 工具 | 说明 |
|------|------|
| `player_play` | 播放文件或 URL，自动启动 mpv |
| `player_pause` | 暂停 / 继续 |
| `player_stop` | 停止播放 |
| `player_next` | 下一曲 |
| `player_prev` | 上一曲 |
| `player_seek` | 快进快退 / 跳到指定时间 / 按百分比跳转 |
| `player_set_volume` | 设置音量（0–130） |
| `player_set_speed` | 设置播放速度（0.5x / 1x / 2x …） |
| `player_status` | 查看当前播放状态 |
| `player_shuffle` | 随机打乱播放列表并播放 |

### 播放列表管理

| 工具 | 说明 |
|------|------|
| `playlist_create` | 创建新播放列表 |
| `playlist_load` | 加载并播放已保存的播放列表 |
| `playlist_add` | 向播放列表添加文件 |
| `playlist_remove` | 从播放列表移除指定曲目 |
| `playlist_list` | 查看所有播放列表或列表内容 |
| `playlist_delete` | 删除播放列表 |

播放列表以 `.m3u` 格式保存在 `%USERPROFILE%\mpv-playlists\`。

## 系统要求

- Windows 10 / 11
- Node.js 18+
- mpv（安装向导可自动安装）

## 工作原理

mpv 提供了 JSON IPC 接口，通过 Windows Named Pipe（`\\.\pipe\mpv-ipc`）通信。本工具作为 MCP server 运行，接收 AI 发来的指令并转发给 mpv 执行。

调用 `player_play` 时如果 mpv 未运行，会自动启动并附带 IPC 参数，之后保持后台运行。

## License

MIT
