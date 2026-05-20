# AskBubble

在任意网页选中文字，右键即可在旁边弹出一个 AI 追问气泡，无需切换页面。

## 功能

- 选中任意文字 → 右键 → **Ask AI** → 气泡出现在文字旁边
- 鼠标悬停追问框时，对应的源文字高亮显示
- 追问框可自由拖拽
- 支持最小化、横向折叠
- 可在已有追问框内继续嵌套追问
- 支持同时打开多个追问框，点击**排序**按钮自动对齐到源文字位置
- 对话记录按 URL 持久化，刷新页面后自动恢复
- 支持 DeepSeek、OpenAI、Claude、Kimi、智谱 GLM、豆包，以及任意 OpenAI 兼容接口

## 安装

### 开发者模式安装

1. 克隆或下载本仓库
2. 打开 Chrome，访问 `chrome://extensions`
3. 打开右上角的**开发者模式**
4. 点击**加载已解压的扩展程序**，选择项目文件夹
5. 工具栏出现 AskBubble 图标即安装成功

### 配置

1. 点击工具栏中的 AskBubble 图标
2. 选择 AI 平台
3. 填入对应平台的 API Key
4. 确认模型名称和 Base URL（大多数平台会自动填写）
5. 点击**保存**

API Key 仅保存在本地浏览器中，不会上传到任何地方。

## 支持平台

| 平台 | 说明 |
|------|------|
| DeepSeek | `deepseek-chat`、`deepseek-reasoner` 等 |
| OpenAI | `gpt-4o`、`gpt-4o-mini` 等 |
| Anthropic (Claude) | `claude-sonnet-4-6`、`claude-opus-4-7` 等 |
| Moonshot (Kimi) | `moonshot-v1-8k/32k/128k` |
| 智谱 GLM | `glm-4`、`glm-4-flash` 等 |
| 豆包（火山引擎）| 模型名需手动填写接入点 ID |
| 自定义 | 任意 OpenAI 兼容接口，手动填写 Base URL 和模型名 |

## 使用方法

1. 在任意网页选中一段文字
2. 右键 → **Ask AI**
3. 在弹出的气泡中输入问题，按 Enter 或点击发送
4. 可继续追问，或选中其他文字打开新的气泡

**右下角工具栏：**
- **排序** — 将所有追问框按源文字位置重新对齐
- **全部删除** — 删除当前页面的所有追问框

## 权限说明

| 权限 | 用途 |
|------|------|
| `contextMenus` | 在右键菜单中添加「Ask AI」选项 |
| `storage` | 在本地保存 API 设置和对话记录 |
| `scripting` | 从右键菜单触发时将气泡 UI 注入当前页面 |
| `host_permissions: <all_urls>` | 扩展需要在用户访问的任意网页上运行 |

## 隐私说明

- API Key 存储在 `chrome.storage.sync`（本地浏览器存储，仅在你自己的设备间同步，不会发送给第三方）
- 对话记录存储在 `chrome.storage.local`（纯本地）
- 选中的文字直接发送给你配置的 AI 接口，没有中间服务器
