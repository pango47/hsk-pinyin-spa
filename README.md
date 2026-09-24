# HSK Pinyin Inspector (HTML5 SPA)

An interactive, responsive HTML5 Single Page Application (SPA) that allows you to paste Mandarin characters, view their Pinyin, and inspect their official HSK level (both HSK 3.0 Levels 1–7 and HSK 2.0 Levels 1–6), powered by the **[kuibinlin/hsk-mcp-server](https://github.com/kuibinlin/hsk-mcp-server)**.

---

## ✨ Features

- **Pinyin for Every Character & Compound Word**:
  - Automatically breaks down sentences and paragraphs into vocabulary words and individual characters.
  - Displays accurate tone marks and Pleco standard tone color coding:
    - **Tone 1 (High flat)**: Red (`#ef4444`)
    - **Tone 2 (Rising)**: Orange (`#f59e0b`)
    - **Tone 3 (Dipping)**: Green (`#10b981`)
    - **Tone 4 (Falling)**: Blue (`#3b82f6`)
    - **Tone 5 (Neutral)**: Slate (`#94a3b8`)
  - Supports toggling between standard Pinyin tone marks (`hǎo`) and numeric tone notation (`hao3`).

- **Official HSK Level Classification**:
  - **HSK 3.0 (New Standard)**: Levels 1, 2, 3, 4, 5, 6, 7 (advanced band covering 7–9).
  - **HSK 2.0 (Legacy Standard)**: Levels 1, 2, 3, 4, 5, 6.
  - Color-coded badges for all levels. Non-HSK characters clearly flagged with neutral badges.

- **Multiple Interactive View Modes**:
  1. **📖 Annotated Text (Ruby View)**:
     - **Full-Text Playback with Synchronized Word Highlighting**: Click **▶️ Play Text** in the Ruby toolbar to listen to the entire passage with smooth, real-time karaoke-style word highlighting that scrolls automatically as it reads. Includes Pause, Resume, Stop, and customizable playback speed (`0.6x`, `0.8x`, `1.0x`, `1.2x`).
     - **Individual Word Hover-to-Play**: Hover over any word in the text to reveal a floating audio button (`▶`) positioned directly above the word to hear its pronunciation on demand.
     - **Dynamic Font Size Scaling**: One-click `A-` and `A+` buttons to adjust Chinese character and Pinyin sizing.
     - Furigana/Ruby layout with Pinyin floating above characters and color-coded HSK level badges underneath. Click any word to open the deep-dive inspection card.
  2. **🀄 Character Cards Grid**: Visual flashcard grid of every unique character in the text with Hanzi, Pinyin, tone badge, audio button, and primary definition. Filterable by HSK level and sortable.
  3. **📋 Vocabulary Table**: Table listing all identified compound words and headwords with simplified/traditional forms, Pinyin, HSK levels, and English meanings.
  4. **📊 Level Analytics**: Text difficulty dashboard showing percentage distribution of HSK levels, lexical diversity (Type-Token Ratio), and syllabus coverage.
  5. **⚡ Live MCP Server Explorer**: Test and trigger any of the 13 MCP tools from `kuibinlin/hsk-mcp-server` directly with custom arguments, and observe the live JSON-RPC network activity log.

- **Interactive Character & Word Inspector Modal**:
  - Shows all **5 phonetic transcription systems**:
    1. Standard Hanyu Pinyin
    2. Numeric Pinyin (`hao3`)
    3. Bopomofo / Zhuyin (`ㄏㄠˇ`)
    4. Wade-Giles (`hao³`)
    5. Gwoyeu Romatzyh (`hao`)
  - Radical (部首), Frequency Rank (e.g. `#18 out of 11,470`), and Rarity Class (`common`, `frequent`, `uncommon`).
  - Classifiers / Measure Words (量词) for nouns (e.g. `本` for `书`).
  - Native browser audio pronunciation via Web Speech API (`zh-CN` Text-to-Speech).
  - Raw JSON inspection for developers.

- **Direct Integration with `kuibinlin/hsk-mcp-server`**:
  - Connects to the remote Streamable HTTP MCP endpoint: `https://hsk-mcp.linsnotes.com/mcp`.
  - Zero authentication required; server includes CORS support for client-side web apps.
  - Automatically caches responses locally for instant subsequent lookups.
  - Includes an embedded offline baseline dataset compiled from all 11,470 HSK headwords.

- **Export Options**:
  - Export vocabulary to **CSV**.
  - Export to **Anki Flashcards TSV** for spaced repetition study.

---

## 🚀 How to Run

### Method 1: Double-Click `start.bat` (Windows)
Double-click `start.bat` in this folder. It will start the local server and automatically launch `http://localhost:3000` in your default browser.

### Method 2: Node.js
```bash
node server.js
```
Then visit `http://localhost:3000`.

### Method 3: Python
```bash
python -m http.server 3000
```
Then visit `http://localhost:3000`.

### Method 4: Direct Browser File (Offline)
You can also open `index.html` directly in modern web browsers (Chrome, Edge, Firefox, Safari).

---

## 🛠️ Project Structure

- `index.html` - HTML5 Single Page Application container, UI components, modals, and views.
- `styles.css` - Modern styling, Pleco tone colors, HSK level badge themes, light/dark mode support.
- `app.js` - Core application engine: MCP client (JSON-RPC over Streamable HTTP), text segmentation, Pinyin mapping, audio controller, view renderers.
- `hsk_data.js` - Baseline dataset extracted from `kuibinlin/hsk-mcp-server` covering 10,969 words and 2,970 unique characters.
- `build_data.js` - Build script used to fetch and regenerate `hsk_data.js` directly from the MCP server.
- `server.js` - Lightweight Node.js static HTTP server.
- `start.bat` - One-click Windows launcher.
