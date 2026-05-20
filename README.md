# AskBubble

A Chrome extension that lets you select any text on a webpage, right-click, and ask an AI follow-up question in a floating bubble right beside the text.

![demo](https://raw.githubusercontent.com/imayday2329-glitch/AskBubble/main/demo.gif)

## Features

- Select text on any page → right-click → **Ask AI** → a chat bubble appears next to the text
- Hover over a bubble to highlight its source text
- Drag bubbles anywhere on the page
- Minimize or collapse bubbles to save space
- Ask nested follow-ups inside an existing bubble
- Supports multiple bubbles simultaneously, with a **Sort** button to align them with their source text
- Conversations persist across page refreshes (per URL)
- Supports DeepSeek, OpenAI, Claude, Kimi, GLM, Doubao, or any OpenAI-compatible API

## Installation

### From source (developer mode)

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the project folder
5. The AskBubble icon appears in the toolbar

### Configuration

1. Click the AskBubble icon in the toolbar
2. Select your AI platform
3. Enter your API Key
4. Confirm the model and Base URL (auto-filled for most platforms)
5. Click **Save**

Your API Key is stored locally in the browser and never uploaded anywhere.

## Supported Platforms

| Platform | Notes |
|----------|-------|
| DeepSeek | `deepseek-chat`, `deepseek-reasoner`, etc. |
| OpenAI | `gpt-4o`, `gpt-4o-mini`, etc. |
| Anthropic (Claude) | `claude-sonnet-4-6`, `claude-opus-4-7`, etc. |
| Moonshot (Kimi) | `moonshot-v1-8k/32k/128k` |
| 智谱 GLM | `glm-4`, `glm-4-flash`, etc. |
| 豆包 (Volcengine) | Fill in the endpoint ID manually as the model name |
| Custom | Any OpenAI-compatible API — fill in Base URL and model manually |

## Usage

1. Select any text on a webpage
2. Right-click → **Ask AI**
3. Type your question in the bubble and press Enter or click Send
4. Ask follow-ups in the same bubble, or select more text to open a new bubble

**Toolbar buttons** (bottom-right corner):
- **Sort** — aligns all bubbles vertically with their source text
- **Delete All** — removes all bubbles from the current page

## Permissions

| Permission | Reason |
|------------|--------|
| `contextMenus` | Adds the "Ask AI" right-click menu item |
| `storage` | Saves your API settings and conversation history locally |
| `scripting` | Injects the bubble UI when triggered from the context menu |
| `host_permissions: <all_urls>` | Allows the extension to run on any webpage |

## Privacy

- API Keys are stored in `chrome.storage.sync` (local browser storage synced across your own devices, never sent to third parties)
- Conversation history is stored in `chrome.storage.local` (local only)
- Selected text is sent directly to the AI API you configured — no intermediate server
