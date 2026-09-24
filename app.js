/**
 * HSK Pinyin Inspector - Application Engine
 * Integrates with kuibinlin/hsk-mcp-server (https://hsk-mcp.linsnotes.com/mcp)
 */

// ==========================================
// 1. MCP Client & Network Controller
// ==========================================
class HskMcpClient {
  constructor() {
    this.endpoint = localStorage.getItem('hsk_mcp_endpoint') || 'https://hsk-mcp.linsnotes.com/mcp';
    this.healthEndpoint = this.endpoint.replace(/\/mcp\/?$/, '/healthz');
    this.cache = new Map();
    this.activityLog = [];
    this.isOnline = false;
    this.latency = null;
    this.maxLogItems = 50;
  }

  setEndpoint(url) {
    this.endpoint = url.trim();
    this.healthEndpoint = this.endpoint.replace(/\/mcp\/?$/, '/healthz');
    localStorage.setItem('hsk_mcp_endpoint', this.endpoint);
  }

  async checkHealth() {
    const startTime = performance.now();
    try {
      const res = await fetch(this.healthEndpoint, { method: 'GET', cache: 'no-cache' });
      const duration = Math.round(performance.now() - startTime);
      if (res.ok) {
        this.isOnline = true;
        this.latency = duration;
        return { ok: true, latency: duration };
      }
    } catch (e) {
      console.warn('Health check failed:', e);
    }
    this.isOnline = false;
    this.latency = null;
    return { ok: false, error: 'Cannot connect to MCP endpoint' };
  }

  async callTool(toolName, args = {}) {
    const cacheKey = `tool:${toolName}:${JSON.stringify(args)}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const startTime = performance.now();
    const requestId = Date.now() + Math.floor(Math.random() * 1000);
    const payload = {
      jsonrpc: '2.0',
      id: requestId,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args
      }
    };

    let logEntry = {
      id: requestId,
      timestamp: new Date().toLocaleTimeString(),
      type: 'tools/call',
      tool: toolName,
      args,
      status: 'pending'
    };
    this.addLog(logEntry);

    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream'
        },
        body: JSON.stringify(payload)
      });

      const duration = Math.round(performance.now() - startTime);
      logEntry.duration = `${duration}ms`;

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const text = await res.text();
      let parsedResult;

      // Handle streamable-http SSE response
      const dataLine = text.split('\n').find(l => l.startsWith('data: '));
      if (dataLine) {
        const json = JSON.parse(dataLine.replace('data: ', '').trim());
        if (json.error) throw new Error(json.error.message || 'JSON-RPC Error');
        if (json.result && json.result.content && json.result.content[0]) {
          try {
            parsedResult = JSON.parse(json.result.content[0].text);
          } catch {
            parsedResult = json.result.content[0].text;
          }
        } else {
          parsedResult = json.result;
        }
      } else {
        const json = JSON.parse(text);
        if (json.error) throw new Error(json.error.message || 'JSON-RPC Error');
        if (json.result && json.result.content && json.result.content[0]) {
          parsedResult = JSON.parse(json.result.content[0].text);
        } else {
          parsedResult = json.result;
        }
      }

      logEntry.status = 'success';
      logEntry.response = parsedResult;
      this.updateLog(logEntry);

      this.cache.set(cacheKey, parsedResult);
      return parsedResult;
    } catch (err) {
      logEntry.status = 'error';
      logEntry.error = err.message;
      this.updateLog(logEntry);
      throw err;
    }
  }

  addLog(entry) {
    this.activityLog.unshift(entry);
    if (this.activityLog.length > this.maxLogItems) {
      this.activityLog.pop();
    }
    if (window.renderMcpLogs) window.renderMcpLogs();
  }

  updateLog(entry) {
    const idx = this.activityLog.findIndex(e => e.id === entry.id);
    if (idx !== -1) {
      this.activityLog[idx] = { ...this.activityLog[idx], ...entry };
    }
    if (window.renderMcpLogs) window.renderMcpLogs();
  }
}

// Global MCP Client instance
const mcpClient = new HskMcpClient();

// ==========================================
// 2. Phonetic & Tone Utilities
// ==========================================
const ToneUtils = {
  // Map accented vowel to tone number
  getTone(pinyin) {
    if (!pinyin) return 5;
    const clean = pinyin.toLowerCase();
    if (/[āēīōūǖ]/.test(clean)) return 1;
    if (/[áéíóúǘ]/.test(clean)) return 2;
    if (/[ǎěǐǒǔǚ]/.test(clean)) return 3;
    if (/[àèìòùǜ]/.test(clean)) return 4;
    return 5;
  },

  // Converts accented pinyin to tone number format (e.g., hǎo -> hao3)
  toNumericPinyin(pinyin) {
    if (!pinyin) return '';
    const toneMap = {
      'ā': 'a1', 'á': 'a2', 'ǎ': 'a3', 'à': 'a4',
      'ē': 'e1', 'é': 'e2', 'ě': 'e3', 'è': 'e4',
      'ī': 'i1', 'í': 'i2', 'ǐ': 'i3', 'ì': 'i4',
      'ō': 'o1', 'ó': 'o2', 'ǒ': 'o3', 'ò': 'o4',
      'ū': 'u1', 'ú': 'u2', 'ǔ': 'u3', 'ù': 'u4',
      'ǖ': 'v1', 'ǘ': 'v2', 'ǚ': 'v3', 'ǜ': 'v4',
      'ü': 'v'
    };
    let tone = 5;
    let word = pinyin;
    for (const [accent, num] of Object.entries(toneMap)) {
      if (word.includes(accent)) {
        tone = num.slice(-1);
        word = word.replace(new RegExp(accent, 'g'), num.slice(0, -1));
      }
    }
    return word + (tone !== 5 ? tone : '');
  },

  // Strip tone marks
  stripTone(pinyin) {
    if (!pinyin) return '';
    return pinyin.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ü/g, "v");
  }
};

// ==========================================
// 3. Chinese Text Segmentation & HSK Matcher
// ==========================================
class ChineseTextAnalyzer {
  constructor() {
    this.wordDict = window.HSK_WORDS || {};
    this.charDict = window.HSK_CHARS || {};
  }

  // Check if character is CJK Hanzi
  isHanzi(char) {
    return /[\u4e00-\u9fa5]/.test(char);
  }

  // Maximum Forward Matching segmentation with HSK vocabulary
  segmentText(text) {
    const tokens = [];
    let i = 0;
    const maxWordLen = 6;

    while (i < text.length) {
      const char = text[i];

      // Handle non-Hanzi (punctuation, whitespace, latin)
      if (!this.isHanzi(char)) {
        tokens.push({
          type: 'non-hanzi',
          text: char
        });
        i++;
        continue;
      }

      // Try matching words in HSK dictionary (longest match first)
      let matchedWord = null;
      let matchedLen = 1;

      for (let len = Math.min(maxWordLen, text.length - i); len >= 2; len--) {
        const candidate = text.substr(i, len);
        if (this.wordDict[candidate]) {
          matchedWord = candidate;
          matchedLen = len;
          break;
        }
      }

      if (matchedWord) {
        const [pinyin, newLevel, oldLevel, meaning] = this.wordDict[matchedWord];
        const chars = [...matchedWord];
        const pinyinTokens = pinyin.split(/\s+/);

        const charDetails = chars.map((c, idx) => {
          const charPinyin = (pinyinTokens.length === chars.length ? pinyinTokens[idx] : (this.charDict[c]?.p || ''));
          const charTone = ToneUtils.getTone(charPinyin);
          const charMeta = this.charDict[c] || { n: newLevel, o: oldLevel };

          return {
            char: c,
            pinyin: charPinyin,
            tone: charTone,
            newLevel: charMeta.n || newLevel,
            oldLevel: charMeta.o || oldLevel,
            isHeadword: !!charMeta.isHeadword
          };
        });

        tokens.push({
          type: 'word',
          text: matchedWord,
          pinyin: pinyin,
          newLevel: newLevel,
          oldLevel: oldLevel,
          meaning: meaning,
          chars: charDetails
        });

        i += matchedLen;
      } else {
        // Single Hanzi token
        const charMeta = this.charDict[char] || null;
        let charPinyin = charMeta ? charMeta.p : '';
        let newLevel = charMeta ? charMeta.n : 0;
        let oldLevel = charMeta ? charMeta.o : 0;
        let meaning = charMeta?.m || '';

        // If not in HSK chars, provide empty or fallback
        const charTone = ToneUtils.getTone(charPinyin);

        tokens.push({
          type: 'char',
          text: char,
          pinyin: charPinyin,
          tone: charTone,
          newLevel: newLevel,
          oldLevel: oldLevel,
          meaning: meaning,
          isHeadword: !!charMeta?.isHeadword,
          chars: [{
            char: char,
            pinyin: charPinyin,
            tone: charTone,
            newLevel: newLevel,
            oldLevel: oldLevel
          }]
        });

        i++;
      }
    }

    return tokens;
  }

  // Extract all unique characters from tokens
  extractUniqueChars(tokens) {
    const charMap = new Map();
    tokens.forEach(tok => {
      if (tok.chars) {
        tok.chars.forEach(c => {
          if (!charMap.has(c.char)) {
            charMap.set(c.char, {
              ...c,
              count: 1,
              sampleWords: tok.text.length > 1 ? [tok.text] : []
            });
          } else {
            const existing = charMap.get(c.char);
            existing.count++;
            if (tok.text.length > 1 && !existing.sampleWords.includes(tok.text)) {
              existing.sampleWords.push(tok.text);
            }
          }
        });
      }
    });
    return Array.from(charMap.values());
  }

  // Extract unique words
  extractUniqueWords(tokens) {
    const wordMap = new Map();
    tokens.forEach(tok => {
      if (tok.type === 'word' || (tok.type === 'char' && tok.isHeadword)) {
        if (!wordMap.has(tok.text)) {
          wordMap.set(tok.text, {
            ...tok,
            count: 1
          });
        } else {
          wordMap.get(tok.text).count++;
        }
      }
    });
    return Array.from(wordMap.values());
  }
}

const analyzer = new ChineseTextAnalyzer();

// ==========================================
// ==========================================
// 4. Speech Synthesis Controller & Text Audio Player
// ==========================================
const SpeechController = {
  voice: null,
  rate: 0.85,

  init() {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = () => this.loadVoices();
      this.loadVoices();
    }
  },

  loadVoices() {
    if (!('speechSynthesis' in window)) return;
    const voices = window.speechSynthesis.getVoices();
    this.voice = voices.find(v => v.lang === 'zh-CN') ||
                 voices.find(v => v.lang.startsWith('zh')) ||
                 null;

    // Populate voice dropdown if present in settings
    const voiceSelect = document.getElementById('setting-tts-voice');
    if (voiceSelect) {
      voiceSelect.innerHTML = '';
      const chineseVoices = voices.filter(v => v.lang.startsWith('zh'));
      if (chineseVoices.length === 0) {
        voiceSelect.innerHTML = '<option value="">System Default Chinese Voice</option>';
      } else {
        chineseVoices.forEach(v => {
          const opt = document.createElement('option');
          opt.value = v.name;
          opt.textContent = `${v.name} (${v.lang})`;
          if (this.voice && this.voice.name === v.name) opt.selected = true;
          voiceSelect.appendChild(opt);
        });
      }
    }
  },

  speak(text) {
    if (!('speechSynthesis' in window)) {
      alert('Speech synthesis is not supported in this browser.');
      return;
    }
    RubyAudioPlayer.stop();
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    if (this.voice) utterance.voice = this.voice;
    utterance.rate = this.rate;
    window.speechSynthesis.speak(utterance);
  },

  speakWord(text, blockEl) {
    // If full text playback is active, pause it
    if (RubyAudioPlayer.isPlaying && !RubyAudioPlayer.isPaused) {
      RubyAudioPlayer.pause();
    }

    if (blockEl) {
      blockEl.classList.add('word-highlight-active');
      setTimeout(() => {
        if (!RubyAudioPlayer.isPlaying) {
          blockEl.classList.remove('word-highlight-active');
        }
      }, 750);
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    if (this.voice) utterance.voice = this.voice;
    utterance.rate = RubyAudioPlayer.speed || this.rate;
    window.speechSynthesis.speak(utterance);
  }
};

// Sequential Text Player with synchronized word highlighting
const RubyAudioPlayer = {
  isPlaying: false,
  isPaused: false,
  currentIndex: 0,
  tokens: [],
  speed: 0.8,
  timer: null,

  start(tokens) {
    if (!tokens || tokens.length === 0) return;
    this.stop();
    this.tokens = tokens;
    this.currentIndex = 0;
    this.isPlaying = true;
    this.isPaused = false;
    this.updateUI('playing');
    this.playStep();
  },

  pause() {
    if (!this.isPlaying) return;
    this.isPaused = true;
    clearTimeout(this.timer);
    window.speechSynthesis.cancel();
    this.updateUI('paused');
    const statusEl = document.getElementById('ruby-play-status');
    if (statusEl) {
      statusEl.textContent = `⏸️ Paused at word ${this.getWordStepNumber()} of ${this.getWordTokensCount()}`;
    }
  },

  resume() {
    if (!this.isPlaying || !this.isPaused) return;
    this.isPaused = false;
    this.updateUI('playing');
    this.playStep();
  },

  stop() {
    this.isPlaying = false;
    this.isPaused = false;
    clearTimeout(this.timer);
    window.speechSynthesis.cancel();
    this.clearHighlights();
    this.updateUI('idle');
    const statusEl = document.getElementById('ruby-play-status');
    if (statusEl) {
      statusEl.textContent = '💡 Hover any word to play its audio';
    }
  },

  playStep() {
    if (!this.isPlaying || this.isPaused) return;

    // Skip non-hanzi tokens
    while (this.currentIndex < this.tokens.length && this.tokens[this.currentIndex].type === 'non-hanzi') {
      this.currentIndex++;
    }

    if (this.currentIndex >= this.tokens.length) {
      this.stop();
      const statusEl = document.getElementById('ruby-play-status');
      if (statusEl) statusEl.textContent = '✨ Full text playback completed!';
      return;
    }

    const tok = this.tokens[this.currentIndex];
    const blockEl = document.querySelector(`.ruby-word-block[data-token-idx="${this.currentIndex}"]`);

    this.highlightBlock(blockEl);

    const totalWords = this.getWordTokensCount();
    const currentNum = this.getWordStepNumber();
    const statusEl = document.getElementById('ruby-play-status');
    if (statusEl) {
      statusEl.innerHTML = `🔊 Playing: <strong>${tok.text}</strong> <span style="color:var(--accent-primary);">[${tok.pinyin || ''}]</span> (${currentNum}/${totalWords})`;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(tok.text);
    utterance.lang = 'zh-CN';
    if (SpeechController.voice) utterance.voice = SpeechController.voice;
    utterance.rate = this.speed;

    let handled = false;
    const advance = () => {
      if (handled) return;
      handled = true;

      // Natural pause between words, longer after punctuation
      let pauseMs = 80;
      const nextTok = this.tokens[this.currentIndex + 1];
      if (nextTok && nextTok.type === 'non-hanzi') {
        if (/[，、；,]/.test(nextTok.text)) {
          pauseMs = 280;
        } else if (/[。！？!?\n]/.test(nextTok.text)) {
          pauseMs = 450;
        }
      }

      this.currentIndex++;
      this.timer = setTimeout(() => {
        this.playStep();
      }, pauseMs);
    };

    utterance.onend = advance;
    utterance.onerror = (e) => {
      console.warn('Speech error:', e);
      advance();
    };

    // Safety fallback timer if onend drops
    const maxTime = Math.max(1200, (tok.text.length * 650) / this.speed);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (!handled && this.isPlaying && !this.isPaused) {
        advance();
      }
    }, maxTime);

    window.speechSynthesis.speak(utterance);
  },

  highlightBlock(blockEl) {
    this.clearHighlights();
    if (blockEl) {
      blockEl.classList.add('word-highlight-active');
      blockEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  },

  clearHighlights() {
    document.querySelectorAll('.ruby-word-block.word-highlight-active').forEach(el => {
      el.classList.remove('word-highlight-active');
    });
  },

  getWordTokensCount() {
    return this.tokens.filter(t => t.type !== 'non-hanzi').length;
  },

  getWordStepNumber() {
    let count = 0;
    for (let i = 0; i <= this.currentIndex && i < this.tokens.length; i++) {
      if (this.tokens[i].type !== 'non-hanzi') count++;
    }
    return count;
  },

  updateUI(mode) {
    const playBtn = document.getElementById('btn-ruby-play');
    const pauseBtn = document.getElementById('btn-ruby-pause');
    const stopBtn = document.getElementById('btn-ruby-stop');
    const playIcon = document.getElementById('ruby-play-icon');
    const playText = document.getElementById('ruby-play-text');

    if (!playBtn) return;

    if (mode === 'playing') {
      playBtn.style.display = 'none';
      if (pauseBtn) pauseBtn.style.display = 'inline-flex';
      if (stopBtn) stopBtn.style.display = 'inline-flex';
    } else if (mode === 'paused') {
      playBtn.style.display = 'inline-flex';
      if (playIcon) playIcon.textContent = '▶️';
      if (playText) playText.textContent = 'Resume';
      if (pauseBtn) pauseBtn.style.display = 'none';
      if (stopBtn) stopBtn.style.display = 'inline-flex';
    } else { // idle
      playBtn.style.display = 'inline-flex';
      if (playIcon) playIcon.textContent = '▶️';
      if (playText) playText.textContent = 'Play Text';
      if (pauseBtn) pauseBtn.style.display = 'none';
      if (stopBtn) stopBtn.style.display = 'none';
    }
  }
};

// ==========================================
// 5. Application State & UI Controller
// ==========================================
const state = {
  inputText: '',
  tokens: [],
  uniqueChars: [],
  uniqueWords: [],
  hskStandard: 'new', // 'new' (3.0) or 'old' (2.0)
  displayMode: 'word', // 'word' or 'char'
  phoneticScript: 'pinyin', // 'pinyin' or 'numeric'
  showPinyin: true,
  showHskBadges: true,
  showToneColors: true,
  activeTab: 'ruby-view',
  charFilterLevel: 'all',
  charSortBy: 'order',
  vocabFilterLevel: 'all',
  rubyFontSize: 1.8
};

function updateRubyFontSize() {
  const size = state.rubyFontSize || 1.8;
  const rtSize = Math.max(0.65, size * 0.46);
  document.documentElement.style.setProperty('--ruby-char-size', `${size}rem`);
  document.documentElement.style.setProperty('--ruby-rt-size', `${rtSize.toFixed(2)}rem`);
}

// Presets Collection
const SAMPLE_PRESETS = {
  beginner: '你好！今天天气很好，我想去超市买苹果和牛奶。你喜欢喝茶吗？',
  intermediate: '随着科学技术的发展，互联网彻底改变了我们的生活方式与沟通模式。越来越多的人习惯在网上购物、远程办公。',
  advanced: '改革开放不仅推动了中国经济的持续繁荣，也显著促进了国际文化与学术领域的深度合作。面对复杂多变的市场环境，创新是不可或缺的动力。',
  master: '博大精深的中华文化历经数千年岁月淬炼，蕴藉着深邃的哲学思辨与独特的美学意蕴，对东亚文明演进产生了深远影响。',
  idioms: '一心一意、半途而废、温故知新、入乡随俗、自相矛盾、画蛇添足、胸有成竹、井底之蛙。',
  polyphones: '他长得很高，是银行的行长，做事非常得体，大家都觉着他很了不起。'
};

// ==========================================
// 6. UI Renderers
// ==========================================

// Render Ruby Annotated Text
function renderRubyView() {
  const container = document.getElementById('ruby-text-container');
  if (!container) return;
  container.innerHTML = '';

  // Stop any active playback if new text is rendered
  RubyAudioPlayer.stop();

  if (state.tokens.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 3rem 1rem;">
      <p style="font-size: 1.1rem; margin-bottom: 0.5rem;">No Chinese characters entered yet.</p>
      <p style="font-size: 0.85rem;">Paste Chinese text above and click <strong>Analyze Text</strong> or choose a sample preset.</p>
    </div>`;
    const statusEl = document.getElementById('ruby-play-status');
    if (statusEl) statusEl.textContent = '💡 Hover any word to play its audio';
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'ruby-text-wrapper';

  state.tokens.forEach((tok, tokIdx) => {
    if (tok.type === 'non-hanzi') {
      const span = document.createElement('span');
      span.className = 'punct-span';
      span.textContent = tok.text;
      wrapper.appendChild(span);
      return;
    }

    // Word or Character Block
    const block = document.createElement('div');
    block.className = 'ruby-word-block';
    block.setAttribute('data-token-idx', tokIdx);
    block.title = tok.meaning ? `${tok.text} [${tok.pinyin}]: ${tok.meaning}` : tok.text;
    block.onclick = () => openInspector(tok.text, tok);

    // Floating Hover Play Button directly above word
    const hoverPlayBtn = document.createElement('button');
    hoverPlayBtn.className = 'word-hover-play-btn';
    hoverPlayBtn.title = `Listen to "${tok.text}"`;
    hoverPlayBtn.setAttribute('aria-label', `Play pronunciation for ${tok.text}`);
    hoverPlayBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor">
        <polygon points="6 4 20 12 6 20 6 4"/>
      </svg>
    `;
    hoverPlayBtn.onclick = (e) => {
      e.stopPropagation();
      SpeechController.speakWord(tok.text, block);
    };
    block.appendChild(hoverPlayBtn);

    const charsGroup = document.createElement('div');
    charsGroup.className = 'ruby-chars-group';

    tok.chars.forEach(c => {
      const ruby = document.createElement('ruby');
      const charSpan = document.createElement('span');
      charSpan.className = 'chinese-char';
      charSpan.textContent = c.char;

      const rt = document.createElement('rt');
      if (state.showPinyin && c.pinyin) {
        let displayPhonetic = c.pinyin;
        if (state.phoneticScript === 'numeric') {
          displayPhonetic = ToneUtils.toNumericPinyin(c.pinyin);
        }
        rt.textContent = displayPhonetic;
        if (state.showToneColors) {
          rt.classList.add(`tone-${c.tone}`);
        }
      } else {
        rt.innerHTML = '&nbsp;';
      }

      ruby.appendChild(charSpan);
      ruby.appendChild(rt);
      charsGroup.appendChild(ruby);
    });

    block.appendChild(charsGroup);

    // HSK Pill badge
    if (state.showHskBadges) {
      const level = state.hskStandard === 'new' ? tok.newLevel : tok.oldLevel;
      const pill = document.createElement('span');
      pill.className = `hsk-pill bg-hsk-${level || 'none'}`;
      pill.textContent = level ? `HSK ${level}` : 'Non-HSK';
      block.appendChild(pill);
    }

    wrapper.appendChild(block);
  });

  container.appendChild(wrapper);
  updateRubyFontSize();
}

// Render Character Cards
function renderCardsView() {
  const container = document.getElementById('cards-grid-container');
  if (!container) return;
  container.innerHTML = '';

  let chars = [...state.uniqueChars];

  // Filter
  if (state.charFilterLevel !== 'all') {
    chars = chars.filter(c => {
      const lvl = state.hskStandard === 'new' ? c.newLevel : c.oldLevel;
      if (state.charFilterLevel === 'non-hsk') return !lvl;
      return lvl === parseInt(state.charFilterLevel, 10);
    });
  }

  // Sort
  if (state.charSortBy === 'level-asc') {
    chars.sort((a, b) => ((a.newLevel || 99) - (b.newLevel || 99)));
  } else if (state.charSortBy === 'level-desc') {
    chars.sort((a, b) => ((b.newLevel || 0) - (a.newLevel || 0)));
  } else if (state.charSortBy === 'pinyin') {
    chars.sort((a, b) => a.pinyin.localeCompare(b.pinyin));
  } else if (state.charSortBy === 'frequency') {
    chars.sort((a, b) => b.count - a.count);
  }

  if (chars.length === 0) {
    container.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; color: var(--text-muted); padding: 3rem;">No characters match the selected filter.</div>`;
    return;
  }

  chars.forEach(c => {
    const card = document.createElement('div');
    card.className = 'char-card';
    card.onclick = () => openInspector(c.char, c);

    const level = state.hskStandard === 'new' ? c.newLevel : c.oldLevel;
    const toneClass = state.showToneColors ? `tone-${c.tone}` : '';

    let displayPinyin = c.pinyin;
    if (state.phoneticScript === 'numeric') {
      displayPinyin = ToneUtils.toNumericPinyin(c.pinyin);
    }

    card.innerHTML = `
      <div class="char-card-badges">
        <span class="hsk-pill bg-hsk-${level || 'none'}">${level ? 'HSK ' + level : 'Non-HSK'}</span>
        <button class="btn-icon btn-sm" title="Listen pronunciation" onclick="event.stopPropagation(); SpeechController.speak('${c.char}')">🔊</button>
      </div>
      <div class="char-card-hanzi">${c.char}</div>
      <div class="char-card-pinyin ${toneClass}">${displayPinyin || '—'}</div>
      <div class="char-card-meaning">${c.meaning || (c.sampleWords?.length ? 'In: ' + c.sampleWords.join(', ') : 'Single Hanzi')}</div>
      <div class="char-card-footer">
        <span>Tone ${c.tone}</span>
        <span>Count: ${c.count}</span>
      </div>
    `;

    container.appendChild(card);
  });
}

// Render Vocabulary Table
function renderVocabTableView() {
  const tbody = document.getElementById('vocab-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  let words = [...state.uniqueWords];

  // Filter
  if (state.vocabFilterLevel !== 'all') {
    words = words.filter(w => {
      const lvl = state.hskStandard === 'new' ? w.newLevel : w.oldLevel;
      if (state.vocabFilterLevel === 'non-hsk') return !lvl;
      return lvl === parseInt(state.vocabFilterLevel, 10);
    });
  }

  if (words.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 2rem;">No vocabulary items found.</td></tr>`;
    return;
  }

  words.forEach(w => {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.onclick = () => openInspector(w.text, w);

    const newLvl = w.newLevel ? `<span class="hsk-pill bg-hsk-${w.newLevel}">HSK 3.0 L${w.newLevel}</span>` : '<span class="hsk-pill bg-hsk-none">None</span>';
    const oldLvl = w.oldLevel ? `<span class="hsk-pill bg-hsk-${w.oldLevel}">HSK 2.0 L${w.oldLevel}</span>` : '<span class="hsk-pill bg-hsk-none">None</span>';

    tr.innerHTML = `
      <td><span class="vocab-hanzi">${w.text}</span></td>
      <td><strong>${w.pinyin || '—'}</strong></td>
      <td>${newLvl}</td>
      <td>${oldLvl}</td>
      <td><span style="color: var(--text-secondary);">${w.meaning || '—'}</span></td>
      <td>
        <button class="btn btn-sm btn-outline" onclick="event.stopPropagation(); SpeechController.speak('${w.text}')">🔊 Play</button>
        <button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); openInspector('${w.text}', null)">Inspect</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Render Analytics Dashboard
function renderAnalyticsView() {
  const container = document.getElementById('analytics-content-container');
  if (!container) return;

  const totalChars = state.tokens.reduce((acc, t) => acc + (t.chars ? t.chars.length : 0), 0);
  const uniqueCount = state.uniqueChars.length;
  const wordCount = state.uniqueWords.length;

  // Level counts
  const levelCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 0: 0 };
  state.uniqueChars.forEach(c => {
    const lvl = state.hskStandard === 'new' ? (c.newLevel || 0) : (c.oldLevel || 0);
    levelCounts[lvl] = (levelCounts[lvl] || 0) + 1;
  });

  const hskCharsCount = uniqueCount - (levelCounts[0] || 0);
  const coveragePercent = uniqueCount > 0 ? Math.round((hskCharsCount / uniqueCount) * 100) : 0;

  // Render HTML
  container.innerHTML = `
    <div class="analytics-grid">
      <div class="analytics-card">
        <h3>HSK Level Distribution (${state.hskStandard === 'new' ? 'HSK 3.0' : 'HSK 2.0'})</h3>
        <p style="font-size: 0.8rem; color: var(--text-secondary);">Breakdown of unique characters in the text</p>
        <div style="margin-top: 0.5rem;">
          ${[1, 2, 3, 4, 5, 6, 7].map(lvl => {
            const count = levelCounts[lvl] || 0;
            const pct = uniqueCount > 0 ? Math.round((count / uniqueCount) * 100) : 0;
            return `
              <div class="stat-bar-item">
                <div class="stat-bar-header">
                  <span><strong>Level ${lvl}</strong> (${count} chars)</span>
                  <span>${pct}%</span>
                </div>
                <div class="progress-track">
                  <div class="progress-fill bg-hsk-${lvl}" style="width: ${pct}%;"></div>
                </div>
              </div>
            `;
          }).join('')}
          <div class="stat-bar-item">
            <div class="stat-bar-header">
              <span><strong>Non-HSK</strong> (${levelCounts[0] || 0} chars)</span>
              <span>${uniqueCount > 0 ? Math.round(((levelCounts[0] || 0) / uniqueCount) * 100) : 0}%</span>
            </div>
            <div class="progress-track">
              <div class="progress-fill bg-hsk-none" style="width: ${uniqueCount > 0 ? Math.round(((levelCounts[0] || 0) / uniqueCount) * 100) : 0}%;"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="analytics-card">
        <h3>Vocabulary & Density Metrics</h3>
        <div style="display: flex; flex-direction: column; gap: 0.8rem; margin-top: 0.5rem;">
          <div style="display: flex; justify-content: space-between; border-bottom: 1px solid var(--border-subtle); padding-bottom: 0.5rem;">
            <span>Total Hanzi Length:</span>
            <strong>${totalChars}</strong>
          </div>
          <div style="display: flex; justify-content: space-between; border-bottom: 1px solid var(--border-subtle); padding-bottom: 0.5rem;">
            <span>Unique Chinese Characters:</span>
            <strong>${uniqueCount}</strong>
          </div>
          <div style="display: flex; justify-content: space-between; border-bottom: 1px solid var(--border-subtle); padding-bottom: 0.5rem;">
            <span>Recognized Vocabulary Words:</span>
            <strong>${wordCount}</strong>
          </div>
          <div style="display: flex; justify-content: space-between; border-bottom: 1px solid var(--border-subtle); padding-bottom: 0.5rem;">
            <span>HSK Syllabus Coverage:</span>
            <strong style="color: var(--accent-primary);">${coveragePercent}%</strong>
          </div>
          <div style="display: flex; justify-content: space-between; border-bottom: 1px solid var(--border-subtle); padding-bottom: 0.5rem;">
            <span>Lexical Diversity (TTR):</span>
            <strong>${totalChars > 0 ? (uniqueCount / totalChars).toFixed(2) : '0'}</strong>
          </div>
        </div>
        <div style="margin-top: 1rem; padding: 0.75rem; border-radius: var(--radius-md); background-color: var(--bg-surface-elevated); font-size: 0.8rem;">
          💡 <strong>HSK Coverage Insight:</strong> Texts with >85% HSK 1-3 vocabulary are suitable for elementary learners. Advanced materials typically encompass HSK 5-7 words.
        </div>
      </div>
    </div>
  `;
}

// Render Summary Banner
function renderSummaryBanner() {
  const totalChars = state.tokens.reduce((acc, t) => acc + (t.chars ? t.chars.length : 0), 0);
  const uniqueCount = state.uniqueChars.length;
  const wordCount = state.uniqueWords.length;

  document.getElementById('metric-total-chars').textContent = totalChars;
  document.getElementById('metric-unique-chars').textContent = uniqueCount;
  document.getElementById('metric-total-words').textContent = wordCount;

  // Level counts for progress bar
  const levelCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 0: 0 };
  state.uniqueChars.forEach(c => {
    const lvl = state.hskStandard === 'new' ? (c.newLevel || 0) : (c.oldLevel || 0);
    levelCounts[lvl] = (levelCounts[lvl] || 0) + 1;
  });

  const barContainer = document.getElementById('hsk-distribution-bar');
  if (barContainer) {
    barContainer.innerHTML = '';
    if (uniqueCount === 0) {
      barContainer.innerHTML = '<div class="hsk-bar-segment" style="width: 100%; background-color: var(--border-subtle);"></div>';
    } else {
      [1, 2, 3, 4, 5, 6, 7, 0].forEach(lvl => {
        const count = levelCounts[lvl] || 0;
        if (count > 0) {
          const pct = ((count / uniqueCount) * 100).toFixed(1);
          const seg = document.createElement('div');
          seg.className = `hsk-bar-segment bg-hsk-${lvl || 'none'}`;
          seg.style.width = `${pct}%`;
          seg.title = `HSK ${lvl || 'None'}: ${count} chars (${pct}%)`;
          barContainer.appendChild(seg);
        }
      });
    }
  }
}

// Render MCP Activity Logs
window.renderMcpLogs = function() {
  const container = document.getElementById('mcp-logs-container');
  if (!container) return;

  if (mcpClient.activityLog.length === 0) {
    container.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem; text-align: center; padding: 2rem;">No MCP calls executed yet. Inspect any word or test tools below to see live JSON-RPC traffic.</div>';
    return;
  }

  container.innerHTML = mcpClient.activityLog.map(entry => {
    const statusColor = entry.status === 'success' ? '#10b981' : (entry.status === 'error' ? '#ef4444' : '#f59e0b');
    return `
      <div style="border-bottom: 1px solid var(--border-subtle); padding: 0.5rem 0; font-size: 0.78rem;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-weight: 700; color: var(--accent-primary);">${entry.tool}</span>
          <span style="font-family: var(--font-mono); color: var(--text-muted);">${entry.duration || ''} [${entry.timestamp}]</span>
        </div>
        <div style="color: var(--text-secondary); margin: 2px 0;">Args: ${JSON.stringify(entry.args)}</div>
        <div style="color: ${statusColor}; font-weight: 600;">Status: ${entry.status.toUpperCase()}</div>
      </div>
    `;
  }).join('');
};

// ==========================================
// 7. Interactive Character & Word Inspector
// ==========================================
async function openInspector(queryWord, initialData = null) {
  const modal = document.getElementById('inspector-modal');
  if (!modal) return;

  // Open modal with loading state
  modal.classList.add('open');
  document.getElementById('modal-char-title').textContent = queryWord;
  document.getElementById('modal-char-traditional').textContent = '...';
  document.getElementById('modal-char-pinyin').textContent = 'Loading MCP details...';
  document.getElementById('modal-char-meaning').textContent = 'Querying https://hsk-mcp.linsnotes.com/mcp...';
  document.getElementById('modal-raw-json').textContent = 'Fetching JSON-RPC response...';

  // Audio button setup
  document.getElementById('modal-btn-speak').onclick = () => SpeechController.speak(queryWord);

  try {
    // 1. Call MCP hsk_lookup
    const lookupRes = await mcpClient.callTool('hsk_lookup', { word: queryWord });
    const firstHit = lookupRes?.results && lookupRes.results[0];

    // 2. Call MCP hsk_convert_script for full transcription systems
    let scriptRes = null;
    try {
      scriptRes = await mcpClient.callTool('hsk_convert_script', { word: queryWord });
    } catch (e) {
      console.warn('Script convert call failed:', e);
    }

    // 3. Call MCP hsk_classifier for nouns
    let classifierRes = null;
    try {
      classifierRes = await mcpClient.callTool('hsk_classifier', { word: queryWord });
    } catch (e) {
      console.warn('Classifier call failed:', e);
    }

    // Populate Modal Fields
    if (firstHit) {
      const primaryForm = firstHit.forms && firstHit.forms[0];
      const trad = primaryForm?.traditional || queryWord;
      const pinyin = primaryForm?.pinyin || initialData?.pinyin || '';
      const meanings = primaryForm?.meanings ? primaryForm.meanings.join('; ') : (firstHit.meaning || 'No definition available');
      const newLvl = firstHit.new_level ? `HSK 3.0 Level ${firstHit.new_level}` : 'Non-HSK';
      const oldLvl = firstHit.old_level ? `HSK 2.0 Level ${firstHit.old_level}` : 'None';
      const radical = firstHit.radical || '—';
      const rank = firstHit.frequency_rank ? `#${firstHit.frequency_rank}` : '—';
      const rarity = firstHit.frequency_rarity || 'common';

      document.getElementById('modal-char-traditional').textContent = trad !== queryWord ? `(Trad: ${trad})` : '';
      document.getElementById('modal-char-pinyin').textContent = pinyin;
      document.getElementById('modal-char-meaning').textContent = meanings;

      document.getElementById('modal-meta-levels').innerHTML = `
        <span class="hsk-pill bg-hsk-${firstHit.new_level || 'none'}">${newLvl}</span>
        <span class="hsk-pill bg-hsk-${firstHit.old_level || 'none'}">${oldLvl}</span>
      `;

      document.getElementById('modal-meta-stats').textContent = `Radical: ${radical} | Freq Rank: ${rank} (${rarity})`;

      // Transcriptions
      const trans = primaryForm?.transcriptions || scriptRes?.results?.[0]?.transcriptions || {};
      document.getElementById('trans-pinyin').textContent = pinyin || '—';
      document.getElementById('trans-numeric').textContent = trans.numeric || ToneUtils.toNumericPinyin(pinyin);
      document.getElementById('trans-bopomofo').textContent = trans.bopomofo || '—';
      document.getElementById('trans-wadegiles').textContent = trans.wadegiles || '—';
      document.getElementById('trans-romatzyh').textContent = trans.romatzyh || '—';

      // Classifiers (量词)
      const classifiersList = classifierRes?.classifiers || primaryForm?.classifiers || [];
      const classEl = document.getElementById('modal-classifiers');
      if (classEl) {
        classEl.textContent = classifiersList.length > 0 ? classifiersList.join(', ') : 'None listed';
      }

      // Raw JSON preview
      document.getElementById('modal-raw-json').textContent = JSON.stringify({ lookup: lookupRes, script: scriptRes, classifier: classifierRes }, null, 2);
    } else {
      // Fallback if not an official headword in HSK
      const fallbackPinyin = initialData?.pinyin || window.HSK_CHARS[queryWord]?.p || '';
      document.getElementById('modal-char-pinyin').textContent = fallbackPinyin;
      document.getElementById('modal-char-meaning').textContent = initialData?.meaning || 'Character not listed as an independent headword in HSK dataset.';
      document.getElementById('modal-meta-levels').innerHTML = `<span class="hsk-pill bg-hsk-${initialData?.newLevel || 'none'}">HSK ${initialData?.newLevel || 'None'}</span>`;
      document.getElementById('modal-meta-stats').textContent = 'Single Hanzi (Evaluated via contextual vocabulary)';
      document.getElementById('trans-pinyin').textContent = fallbackPinyin || '—';
      document.getElementById('trans-numeric').textContent = ToneUtils.toNumericPinyin(fallbackPinyin);
      document.getElementById('trans-bopomofo').textContent = '—';
      document.getElementById('trans-wadegiles').textContent = '—';
      document.getElementById('trans-romatzyh').textContent = '—';
      document.getElementById('modal-raw-json').textContent = JSON.stringify(lookupRes || {}, null, 2);
    }
  } catch (err) {
    document.getElementById('modal-char-pinyin').textContent = initialData?.pinyin || 'Error';
    document.getElementById('modal-char-meaning').textContent = `MCP query failed: ${err.message}. Showing local cache.`;
  }
}

// Close Modal helper
function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('open');
}

// ==========================================
// 8. Main Application Processing Pipeline
// ==========================================
function processInputText() {
  const inputEl = document.getElementById('chinese-input');
  if (!inputEl) return;
  const rawText = inputEl.value.trim();
  state.inputText = rawText;

  // Segment and analyze
  state.tokens = analyzer.segmentText(rawText);
  state.uniqueChars = analyzer.extractUniqueChars(state.tokens);
  state.uniqueWords = analyzer.extractUniqueWords(state.tokens);

  // Render all active views
  renderSummaryBanner();
  renderRubyView();
  renderCardsView();
  renderVocabTableView();
  renderAnalyticsView();
}

// Export functions
function exportVocabCSV() {
  if (state.uniqueWords.length === 0) {
    alert('No vocabulary to export.');
    return;
  }
  let csv = 'Word,Pinyin,HSK 3.0 Level,HSK 2.0 Level,Meaning\n';
  state.uniqueWords.forEach(w => {
    const meaning = (w.meaning || '').replace(/"/g, '""');
    csv += `"${w.text}","${w.pinyin || ''}","${w.newLevel || ''}","${w.oldLevel || ''}","${meaning}"\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hsk_vocabulary_${Date.now()}.csv`;
  a.click();
}

function exportAnkiTSV() {
  if (state.uniqueWords.length === 0) {
    alert('No vocabulary to export.');
    return;
  }
  // Front: Chinese, Back: Pinyin<br>HSK Level<br>Meaning
  let tsv = '';
  state.uniqueWords.forEach(w => {
    const front = w.text;
    const back = `${w.pinyin || ''}<br><b>HSK 3.0: Level ${w.newLevel || 'None'}</b><br>${w.meaning || ''}`;
    tsv += `${front}\t${back}\n`;
  });

  const blob = new Blob([tsv], { type: 'text/tab-separated-values;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hsk_anki_cards_${Date.now()}.txt`;
  a.click();
}

// ==========================================
// 9. Event Listeners & Initialization
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  // Speech initialization
  SpeechController.init();

  // Check MCP Server Health
  mcpClient.checkHealth().then(res => {
    const dot = document.getElementById('mcp-status-dot');
    const txt = document.getElementById('mcp-status-text');
    if (res.ok) {
      dot.className = 'status-dot online';
      txt.textContent = `HSK MCP Online (${res.latency}ms)`;
    } else {
      dot.className = 'status-dot error';
      txt.textContent = 'HSK MCP Offline (Using local baseline)';
    }
  });

  // Textarea input event for live counters
  const inputEl = document.getElementById('chinese-input');
  if (inputEl) {
    inputEl.addEventListener('input', () => {
      const len = inputEl.value.length;
      document.getElementById('input-char-count').textContent = `${len} characters`;
    });
  }

  // Analyze button
  document.getElementById('btn-analyze')?.addEventListener('click', processInputText);

  // Clear button
  document.getElementById('btn-clear')?.addEventListener('click', () => {
    if (inputEl) {
      inputEl.value = '';
      inputEl.dispatchEvent(new Event('input'));
      processInputText();
    }
  });

  // Paste clipboard button
  document.getElementById('btn-paste')?.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (inputEl) {
        inputEl.value = text;
        inputEl.dispatchEvent(new Event('input'));
        processInputText();
      }
    } catch {
      alert('Clipboard access not allowed by browser. Please use Ctrl+V / Cmd+V directly.');
    }
  });

  // Speech speak all button
  document.getElementById('btn-speak-all')?.addEventListener('click', () => {
    if (state.inputText) {
      SpeechController.speak(state.inputText);
    }
  });

  // Presets click events
  document.querySelectorAll('.preset-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const presetKey = chip.getAttribute('data-preset');
      if (SAMPLE_PRESETS[presetKey] && inputEl) {
        inputEl.value = SAMPLE_PRESETS[presetKey];
        inputEl.dispatchEvent(new Event('input'));
        processInputText();
      }
    });
  });

  // View Tabs Navigation
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      document.getElementById(targetId)?.classList.add('active');
      state.activeTab = targetId;
    });
  });

  // HSK Standard Toggle (New 3.0 vs Old 2.0)
  document.querySelectorAll('[data-standard]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-standard]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.hskStandard = btn.getAttribute('data-standard');
      renderRubyView();
      renderCardsView();
      renderVocabTableView();
      renderAnalyticsView();
      renderSummaryBanner();
    });
  });

  // Display Toggles (Pinyin, HSK Badges, Tone Colors)
  document.getElementById('toggle-pinyin')?.addEventListener('click', function() {
    state.showPinyin = !state.showPinyin;
    this.classList.toggle('active', state.showPinyin);
    renderRubyView();
  });

  // Ruby toolbar audio controls
  document.getElementById('btn-ruby-play')?.addEventListener('click', () => {
    if (RubyAudioPlayer.isPlaying && RubyAudioPlayer.isPaused) {
      RubyAudioPlayer.resume();
    } else {
      RubyAudioPlayer.start(state.tokens);
    }
  });

  document.getElementById('btn-ruby-pause')?.addEventListener('click', () => {
    RubyAudioPlayer.pause();
  });

  document.getElementById('btn-ruby-stop')?.addEventListener('click', () => {
    RubyAudioPlayer.stop();
  });

  document.getElementById('ruby-speed-select')?.addEventListener('change', (e) => {
    RubyAudioPlayer.speed = parseFloat(e.target.value);
  });

  // Ruby font size zoom controls
  document.getElementById('btn-font-increase')?.addEventListener('click', () => {
    state.rubyFontSize = Math.min(3.4, (state.rubyFontSize || 1.8) + 0.2);
    updateRubyFontSize();
  });

  document.getElementById('btn-font-decrease')?.addEventListener('click', () => {
    state.rubyFontSize = Math.max(1.2, (state.rubyFontSize || 1.8) - 0.2);
    updateRubyFontSize();
  });

  document.getElementById('toggle-badges')?.addEventListener('click', function() {
    state.showHskBadges = !state.showHskBadges;
    this.classList.toggle('active', state.showHskBadges);
    renderRubyView();
  });

  document.getElementById('toggle-tone-colors')?.addEventListener('click', function() {
    state.showToneColors = !state.showToneColors;
    this.classList.toggle('active', state.showToneColors);
    renderRubyView();
    renderCardsView();
  });

  // Phonetic script toggle (pinyin vs numeric)
  document.querySelectorAll('[data-script]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-script]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.phoneticScript = btn.getAttribute('data-script');
      renderRubyView();
      renderCardsView();
    });
  });

  // Character Cards Filters & Sorts
  document.getElementById('card-level-filter')?.addEventListener('change', (e) => {
    state.charFilterLevel = e.target.value;
    renderCardsView();
  });

  document.getElementById('card-sort-by')?.addEventListener('change', (e) => {
    state.charSortBy = e.target.value;
    renderCardsView();
  });

  // Vocab Table Filter
  document.getElementById('vocab-level-filter')?.addEventListener('change', (e) => {
    state.vocabFilterLevel = e.target.value;
    renderVocabTableView();
  });

  // Export buttons
  document.getElementById('btn-export-csv')?.addEventListener('click', exportVocabCSV);
  document.getElementById('btn-export-anki')?.addEventListener('click', exportAnkiTSV);

  // Theme toggle
  const themeToggleBtn = document.getElementById('btn-theme-toggle');
  if (themeToggleBtn) {
    const savedTheme = localStorage.getItem('hsk_theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', savedTheme);
    themeToggleBtn.textContent = savedTheme === 'dark' ? '☀️' : '🌙';

    themeToggleBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('hsk_theme', next);
      themeToggleBtn.textContent = next === 'dark' ? '☀️' : '🌙';
    });
  }

  // Settings Modal
  document.getElementById('btn-open-settings')?.addEventListener('click', () => {
    document.getElementById('setting-endpoint-url').value = mcpClient.endpoint;
    document.getElementById('settings-modal').classList.add('open');
  });

  document.getElementById('btn-save-settings')?.addEventListener('click', () => {
    const url = document.getElementById('setting-endpoint-url').value;
    mcpClient.setEndpoint(url);
    mcpClient.checkHealth().then(res => {
      const dot = document.getElementById('mcp-status-dot');
      const txt = document.getElementById('mcp-status-text');
      if (res.ok) {
        dot.className = 'status-dot online';
        txt.textContent = `HSK MCP Online (${res.latency}ms)`;
      } else {
        dot.className = 'status-dot error';
        txt.textContent = 'HSK MCP Offline';
      }
    });
    closeModal('settings-modal');
  });

  // MCP Explorer Tool Execution
  document.getElementById('btn-run-mcp-tool')?.addEventListener('click', async () => {
    const tool = document.getElementById('mcp-test-tool-select').value;
    const argVal = document.getElementById('mcp-test-arg').value.trim();
    const resultBox = document.getElementById('mcp-tool-result-box');
    resultBox.textContent = `Executing ${tool} ...`;

    try {
      let args = {};
      if (tool === 'hsk_lookup' || tool === 'hsk_frequency' || tool === 'hsk_classifier' || tool === 'hsk_convert_script') {
        args = { word: argVal || '好' };
      } else if (tool === 'hsk_search_meaning') {
        args = { query: argVal || 'learn' };
      } else if (tool === 'hsk_words_by_radical') {
        args = { radical: argVal || '女' };
      } else if (tool === 'hsk_homophones') {
        args = { pinyin: argVal || 'hǎo' };
      } else if (tool === 'hsk_build_study_set') {
        args = { level: parseInt(argVal, 10) || 1 };
      }
      const res = await mcpClient.callTool(tool, args);
      resultBox.textContent = JSON.stringify(res, null, 2);
    } catch (err) {
      resultBox.textContent = `Error: ${err.message}`;
    }
  });

  // Initialize with beginner sample
  if (inputEl) {
    inputEl.value = SAMPLE_PRESETS.beginner;
    inputEl.dispatchEvent(new Event('input'));
    processInputText();
  }
});
