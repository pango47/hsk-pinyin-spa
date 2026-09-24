// build_data.js - Fetches HSK 3.0 & 2.0 vocabulary directly from kuibinlin/hsk-mcp-server
// and compiles a high-performance offline baseline dataset for the SPA.

const fs = require('fs');
const path = require('path');

const MCP_ENDPOINT = 'https://hsk-mcp.linsnotes.com/mcp';

async function fetchResource(uri) {
  const res = await fetch(MCP_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'resources/read',
      params: { uri }
    })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const dataLine = text.split('\n').find(l => l.startsWith('data: '));
  if (!dataLine) throw new Error('No SSE data line in response');
  const json = JSON.parse(dataLine.replace('data: ', ''));
  return JSON.parse(json.result.contents[0].text);
}

async function run() {
  console.log('Fetching HSK metadata from MCP server...');
  const meta = await fetchResource('hsk://meta');
  console.log('Metadata:', meta);

  const words = [];
  for (let i = 1; i <= 7; i++) {
    console.log(`Fetching level ${i}...`);
    const data = await fetchResource(`hsk://level/${i}`);
    const list = data.words || data;
    words.push(...list);
    console.log(`Level ${i} fetched (${list.length} words)`);
  }

  console.log(`Total words fetched: ${words.length}`);

  // Word dictionary: simplified -> [pinyin, new_level, old_level, meaning]
  const wordDict = {};
  // Character dictionary: char -> { p: pinyin, n: min_new_level, o: min_old_level, w: [samples] }
  const charDict = {};

  // First pass: single character words have direct ground-truth pinyin and level
  for (const item of words) {
    const w = item.simplified;
    const p = item.pinyin;
    const n = item.new_level;
    const o = item.old_level || 0;
    const m = (item.meanings && item.meanings[0]) ? item.meanings[0] : '';

    wordDict[w] = [p, n, o, m];

    if (w.length === 1 && /[\u4e00-\u9fa5]/.test(w)) {
      charDict[w] = {
        p: p,
        n: n,
        o: o,
        isHeadword: true,
        m: m,
        words: [w]
      };
    }
  }

  // Second pass: multi-character words populate missing characters or secondary sample words
  for (const item of words) {
    const w = item.simplified;
    const p = item.pinyin;
    const n = item.new_level;
    const o = item.old_level || 0;
    const pinyinParts = p.split(/\s+/);
    const chars = [...w];

    chars.forEach((c, idx) => {
      if (/[\u4e00-\u9fa5]/.test(c)) {
        const charPinyin = (pinyinParts.length === chars.length ? pinyinParts[idx] : pinyinParts[0]) || '';
        if (!charDict[c]) {
          charDict[c] = {
            p: charPinyin,
            n: n,
            o: o,
            isHeadword: false,
            words: [w]
          };
        } else {
          // If not a headword or if lower level discovered
          if (!charDict[c].isHeadword && n < charDict[c].n) {
            charDict[c].n = n;
            if (charPinyin) charDict[c].p = charPinyin;
          }
          if (o > 0 && (charDict[c].o === 0 || o < charDict[c].o)) {
            charDict[c].o = o;
          }
          if (!charDict[c].words.includes(w) && charDict[c].words.length < 4) {
            charDict[c].words.push(w);
          }
        }
      }
    });
  }

  console.log(`Total unique characters mapped in HSK: ${Object.keys(charDict).length}`);

  const outputJs = `// Auto-generated HSK baseline dataset from https://github.com/kuibinlin/hsk-mcp-server
// Dataset version: ${meta.dataset_version}, Generated: ${new Date().toISOString()}

window.HSK_META = ${JSON.stringify(meta)};
window.HSK_WORDS = ${JSON.stringify(wordDict)};
window.HSK_CHARS = ${JSON.stringify(charDict)};
`;

  const outputPath = path.join(__dirname, 'hsk_data.js');
  fs.writeFileSync(outputPath, outputJs, 'utf8');
  console.log(`Saved hsk_data.js (${(fs.statSync(outputPath).size / 1024).toFixed(1)} KB)`);
}

run().catch(err => {
  console.error('Error in build_data:', err);
  process.exit(1);
});
