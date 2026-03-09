# Breeze 🌬️

A Zotero plugin that uses LLMs to **summarize your research interests** from your library and **filter RSS feed articles** by relevance.

## Features

### 📚 Research Interest Summarization
- Analyzes your entire Zotero library (titles, abstracts, collection structure)
- Uses configurable sampling rates to handle large libraries
- Produces a structured summary: Topics, Methods, Theoretical Frameworks, Application Domains, Interdisciplinary Connections
- Schedule: run manually or automatically every month

### 📰 RSS Feed Filtering
- Toggle the **Breeze Filter** button when viewing any RSS feed or the aggregate Feeds view
- Uses your research interest summary to identify relevant articles via LLM
- Hides irrelevant articles from the feed list
- Results are cached for fast repeated use
- Auto-deactivates when switching folders

## Installation

1. Download `breeze.xpi` from [Releases](../../releases)
2. Open Zotero → Tools → Add-ons
3. Click the gear icon → **Install Add-on From File…**
4. Select the downloaded `.xpi` file
5. Restart Zotero

## Configuration

Go to **Zotero → Settings → Breeze** to configure:

| Setting | Description | Default |
|---------|-------------|---------|
| API Base URL | OpenAI-compatible API endpoint | `https://api.openai.com/v1` |
| API Key | Your API key | — |
| Model | LLM model to use | `gpt-4o-mini` |
| Title Sampling Rate | % of paper titles to include in prompt | 50% |
| Abstract Sampling Rate | % of sampled titles to also include abstracts | 30% |
| Update Schedule | Manual or monthly auto-update | Once (manual) |

## Usage

### Summarize Research Interests
1. Set your API key in Breeze settings
2. Click **"Summarize Now"** in the settings pane, or use **Tools → Summarize Research Interests**
3. Monitor progress in the Status Log
4. View your summary in the settings pane or via **Tools → Show Research Interest Summary**

### Filter RSS Feeds
1. Subscribe to journal RSS feeds in Zotero (Edit → New Feed from URL)
2. Click a feed or the **Feeds** header in the left pane
3. Click the **Breeze Filter** button in the toolbar
4. Wait for the LLM to evaluate articles (cached for future use)
5. Click again to restore all articles

## Building from Source

```bash
git clone https://github.com/zeyu42/breeze.git
cd breeze
./build.sh
```

The built plugin will be at `builds/breeze.xpi`.

## Requirements

- **Zotero 7 or 8** (tested on Zotero 8.0.3)
- An OpenAI-compatible API key (OpenAI, or any compatible provider)

## License

This project is vibe coded in Antigravity with the Claude Opus 4.6 (Thinking) model. I don't know what license would be appropriate here. Feel free to use this project in any way you want, but do so at your own (legal) risk.