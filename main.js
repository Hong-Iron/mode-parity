'use strict';
/*
 * Mode Parity — 편집(Live Preview)을 읽기 모드와 같은 모양으로.
 *
 * 1) classify()   마크다운 줄을 블록(문단·제목·목록·인용·콜아웃·코드·수식·표·구분선…)으로 나눈다. 순수 함수.
 * 2) Calibrator   화면 밖 "읽기 모드 프로브"에 Obsidian 렌더러로 표본을 그려 블록 사이 실제 간격(px),
 *                 코드 블록·콜아웃·목록·인용의 기하를 잰다. 테마/스니펫이 바뀌면 다시 잰다.
 * 3) ViewPlugin   (CM6) 빈 줄 높이와 블록 위아래 여백을 읽기 모드 간격으로 바꾸는 줄 장식,
 *                 편집 중인 콜아웃을 렌더링된 모양 그대로 그리는 장식.
 * 4) styles.css   목록·인용·코드·수식·제목 기호의 기하를 맞추는 규칙. body 클래스로 기능별 on/off.
 */

const obsidian = require('obsidian');
const { Plugin, PluginSettingTab, Setting, MarkdownRenderer, MarkdownView, Component, Modal, Notice } = obsidian;
const { ViewPlugin, Decoration, WidgetType, EditorView } = require('@codemirror/view');
const { RangeSetBuilder, StateEffect, StateField, EditorState, Prec } = require('@codemirror/state');

/* ───────────────────────── 0. 문구(영어 기본, Obsidian 이 한국어면 한국어) ───────────────────────── */

const STRINGS = {
  en: {
    iconLabel: 'Edit callout type',
    cmdToggle: 'Toggle on/off (before/after)',
    cmdCompare: 'Open editing and reading side by side',
    cmdMeasure: 'Measure editing vs reading offsets',
    cmdRecalibrate: 'Re-measure current theme',
    noticeOn: 'Mode Parity on', noticeOff: 'Mode Parity off',
    noticeCalibrated: 'Mode Parity: theme measured',
    noticeNeedPanes: 'Open the same note in an editing pane and a reading pane side by side (use "Open editing and reading side by side").',
    modalTitle: 'Editing ↔ reading offsets',
    modalSummary: 'Compared {n} lines · max vertical offset {dy}px · max horizontal offset {dx}px (rendered part only)',
    colLine: 'Line', colDy: 'Vertical (px)', colDx: 'Horizontal (px)', colText: 'Text',
    sEnabled: 'Enabled', dEnabled: 'Turn off to get the default editing view back. The "Toggle on/off" command switches instantly for comparison.',
    hLayout: 'Layout',
    sSpacing: 'Block spacing', dSpacing: 'Gaps between paragraphs, headings, lists, code and tables match reading view to the pixel. Consecutive blank lines collapse like in reading view and expand when the cursor is on them.',
    sLists: 'List indentation', dLists: 'Bullet, number and text positions match reading view.',
    sQuotes: 'Blockquotes', dQuotes: 'Blockquote indentation matches reading view; the > marker is hidden on the line being edited.',
    sCode: 'Code blocks', dCode: 'Code line height and top/bottom padding match reading view. Fence lines (```) only appear when the cursor is on them.',
    sMath: 'Math blocks', dMath: 'Spacing around math blocks matches reading view.',
    sImages: 'Center images', dImages: 'Center images in both editing and reading view. Turn off to keep the default alignment.',
    hLive: 'Edit while rendered',
    sCallouts: 'Callouts', dCallouts: 'Clicking into a callout keeps it rendered instead of showing the raw "> [!tip]" source, and the cursor lands on the clicked character. Click the icon, or press ← at the start of the title, to edit the callout type.',
    sLenient: 'Callouts without a space', dLenient: 'Render ">[!info]Title" (no space after "]") as a callout in both views. By default Obsidian only treats it as a callout when a space follows. Your files are not changed.',
    sHang: 'Heading marks in the margin', dHang: 'Show the # marks of the heading being edited in the left margin so the heading text does not move.',
    hCalibration: 'Calibration',
    sMeasured: 'Current theme measurements',
    dMeasured: '{state} · paragraph↔paragraph {pp}px · paragraph→heading 2 {ph2}px · code line {code}px · list text {list}px',
    measured: 'measured', defaults: 'defaults',
    btnRemeasure: 'Re-measure',
  },
  ko: {
    iconLabel: '콜아웃 종류 편집',
    cmdToggle: '켜기/끄기 (전후 비교)',
    cmdCompare: '편집/읽기 나란히 비교',
    cmdMeasure: '편집/읽기 위치 차이 측정',
    cmdRecalibrate: '현재 테마로 다시 측정(보정)',
    noticeOn: 'Mode Parity 켜짐', noticeOff: 'Mode Parity 꺼짐',
    noticeCalibrated: 'Mode Parity: 보정 완료',
    noticeNeedPanes: '같은 노트를 편집 창과 읽기 창에 나란히 열어 주세요. ("편집/읽기 나란히 비교" 명령)',
    modalTitle: '편집 ↔ 읽기 위치 차이',
    modalSummary: '비교한 줄 {n}개 · 최대 세로 차이 {dy}px · 최대 가로 차이 {dx}px (화면에 그려진 부분만 측정)',
    colLine: '줄', colDy: '세로(px)', colDx: '가로(px)', colText: '내용',
    sEnabled: '사용', dEnabled: '끄면 Obsidian 기본 편집 모드로 돌아갑니다. "켜기/끄기" 명령으로 전후를 바로 비교할 수 있습니다.',
    hLayout: '모양 맞추기',
    sSpacing: '블록 간격', dSpacing: '빈 줄·제목·목록·코드·표 사이 간격을 읽기 모드와 같은 픽셀로 맞춥니다. 연속된 빈 줄은 읽기 모드처럼 하나로 접히고, 커서를 두면 펼쳐집니다.',
    sLists: '목록 들여쓰기', dLists: '글머리표·번호의 위치와 글자 시작 위치를 읽기 모드와 같게 합니다.',
    sQuotes: '인용문', dQuotes: '인용문 들여쓰기를 맞추고 편집 중인 줄의 > 기호를 숨깁니다.',
    sCode: '코드 블록', dCode: '코드 줄 높이와 위/아래 여백을 읽기 모드와 같게 합니다. ``` 줄은 그 줄에 커서가 있을 때만 나타납니다.',
    sMath: '수식 블록', dMath: '수식 블록 위아래 여백을 읽기 모드와 같게 합니다.',
    sImages: '이미지 가운데 정렬', dImages: '이미지를 편집·읽기 모드 모두에서 가운데에 놓습니다. 끄면 Obsidian/테마 기본 정렬을 따릅니다.',
    hLive: '렌더링된 채로 편집',
    sCallouts: '콜아웃', dCallouts: '콜아웃 안을 클릭해도 원문(> [!tip])으로 바뀌지 않고 렌더링된 모양 그대로 글을 고칩니다. 아이콘을 누르거나 제목 맨 앞에서 ←를 누르면 [!종류]를 고칠 수 있습니다.',
    sLenient: '붙여 쓴 콜아웃', dLenient: '">[!info]제목" 처럼 ] 뒤에 공백 없이 써도 콜아웃으로 그립니다(두 모드 모두). Obsidian 기본은 공백이 있어야 콜아웃이고, 없으면 인용문입니다. 파일 내용은 바꾸지 않습니다.',
    sHang: '제목 기호를 여백에', dHang: '편집 중인 제목의 # 기호를 왼쪽 여백에 표시해, 커서가 들어가도 제목 글자가 움직이지 않게 합니다.',
    hCalibration: '보정',
    sMeasured: '현재 테마 측정값',
    dMeasured: '{state} · 문단↔문단 {pp}px · 문단→제목2 {ph2}px · 코드 줄 {code}px · 목록 글자 {list}px',
    measured: '측정됨', defaults: '기본값',
    btnRemeasure: '다시 측정',
  },
};

function uiLang() {
  let l = 'en';
  try { l = (typeof obsidian.getLanguage === 'function' ? obsidian.getLanguage() : window.localStorage.getItem('language')) || 'en'; } catch (e) { /* 기본 영어 */ }
  return String(l).toLowerCase().startsWith('ko') ? 'ko' : 'en';
}
function tr(key, vars) {
  const s = STRINGS[uiLang()][key] || STRINGS.en[key] || key;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k])) : s;
}

/* ───────────────────────── 1. 블록 분류 ───────────────────────── */

const RE = {
  blank: /^[ \t]*$/,
  fence: /^([ \t]*)(`{3,}|~{3,})(.*)$/,
  fenceClose: /^[ \t]*(`{3,}|~{3,})[ \t]*$/,
  heading: /^ {0,3}(#{1,6})(?=[ \t]|$)/,
  hr: /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/,
  setext: /^ {0,3}(=+|-+)[ \t]*$/,
  list: /^([ \t]*)([-*+]|\d{1,9}[.)])(?=[ \t]|$)/,
  emptyItem: /^[ \t]*([-*+]|\d{1,9}[.)])[ \t]*$/,
  quote: /^ {0,3}>/,
  quoteOnly: /^ {0,3}>[ \t]*$/,
  // Obsidian 은 "]" 뒤에 공백이나 줄 끝이 와야 콜아웃으로 본다 (>[!info]제목 은 그냥 인용문)
  callout: /^ {0,3}>[ \t]*\[!([^\]\s]+)\]([+-]?)(?=[ \t]|$)/,
  calloutPrefix: /^ {0,3}>[ \t]*\[![^\]\s]+\][+-]?(?=[ \t]|$)[ \t]*/,
  // 붙여 쓴 콜아웃 >[!info]제목 — Obsidian 은 인용문으로 보지만, 설정을 켜면 콜아웃으로 그린다
  calloutLoose: /^ {0,3}>[ \t]*\[!([^\]\s]+)\]([+-]?)/,
  calloutPrefixLoose: /^ {0,3}>[ \t]*\[![^\]\s]+\][+-]?[ \t]*/,
  // 이미지만 있는 줄: ![[그림.png|폭]] 또는 ![대체](주소)
  imageLine: /^[ \t]*(?:!\[\[[^\]|]+\.(?:png|jpe?g|gif|bmp|svg|webp|avif|heic|tiff?)(?:\|[^\]]*)?\]\]|!\[[^\]]*\]\([^)]+\))[ \t]*$/i,
  mathOpen: /^[ \t]*\$\$/,
  tableSep: /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/,
  fnDef: /^\[\^[^\]]+\]:/,
  commentOpen: /^[ \t]*%%/,
  indented: /^( {2,}|\t)/,
  stripQuote: /^ {0,3}> ?/,
};

/** 플러그인 설정 중 순수 함수(분류기)가 알아야 하는 것 */
const CFG = { lenientCallouts: true };

/** 콜아웃 제목 줄이면 "> [!종류] " 접두 길이 정보를 돌려준다 */
function calloutPrefixOf(text) {
  if (RE.callout.test(text)) return RE.calloutPrefix.exec(text);
  if (CFG.lenientCallouts && RE.calloutLoose.test(text)) return RE.calloutPrefixLoose.exec(text);
  return null;
}

function indentWidth(s) {
  let w = 0;
  for (const ch of s) w += ch === '\t' ? 4 - (w % 4) : 1;
  return w;
}
const listKind = (marker) => (/\d/.test(marker) ? 'ol' : 'ul');

function startsBlock(t) {
  return RE.heading.test(t) || RE.fence.test(t) || RE.hr.test(t) || RE.quote.test(t) ||
    RE.mathOpen.test(t) || (RE.list.test(t) && !RE.emptyItem.test(t));
}

/**
 * @param {string[]} lines
 * @returns {{blocks: Array<{type:string,start:number,end:number,level?:number,calloutType?:string}>, lineBlock: Int32Array}}
 */
function classify(lines) {
  const n = lines.length;
  const blocks = [];
  const lineBlock = new Int32Array(n).fill(-1);
  const add = (type, start, end, extra) => {
    const b = Object.assign({ type, start, end }, extra);
    for (let k = start; k <= end; k++) lineBlock[k] = blocks.length;
    blocks.push(b);
    return b;
  };

  let i = 0;
  if (n > 1 && /^---[ \t]*$/.test(lines[0])) {
    let j = 1;
    while (j < n && !/^(---|\.\.\.)[ \t]*$/.test(lines[j])) j++;
    if (j < n) { add('fm', 0, j); i = j + 1; }
  }

  while (i < n) {
    const t = lines[i];
    if (RE.blank.test(t)) { i++; continue; }
    let m, j;

    if ((m = RE.fence.exec(t))) {
      const ch = m[2][0], len = m[2].length;
      j = i + 1;
      while (j < n) {
        const c = RE.fenceClose.exec(lines[j]);
        if (c && c[1][0] === ch && c[1].length >= len) break;
        j++;
      }
      add('code', i, Math.min(j, n - 1), { closed: j < n });
      i = j + 1; continue;
    }
    if (RE.mathOpen.test(t)) {
      const rest = t.replace(RE.mathOpen, '');
      if (/\$\$[ \t]*$/.test(rest)) { add('math', i, i); i++; continue; }
      j = i + 1;
      while (j < n && !/\$\$[ \t]*$/.test(lines[j])) j++;
      add('math', i, Math.min(j, n - 1));
      i = j + 1; continue;
    }
    if (RE.commentOpen.test(t) && !t.replace(RE.commentOpen, '').includes('%%')) {
      j = i + 1;
      while (j < n && !lines[j].includes('%%')) j++;
      add('p', i, Math.min(j, n - 1), { comment: true });
      i = j + 1; continue;
    }
    if ((m = RE.heading.exec(t))) { add('h', i, i, { level: m[1].length }); i++; continue; }
    if (RE.hr.test(t)) { add('hr', i, i); i++; continue; }

    if (RE.quote.test(t)) {
      j = i + 1;
      while (j < n) {
        const u = lines[j];
        if (RE.quote.test(u)) { j++; continue; }
        // lazy continuation: 텍스트가 있는 인용 줄 바로 뒤의 일반 텍스트
        if (!RE.blank.test(u) && !startsBlock(u) && !RE.quoteOnly.test(lines[j - 1])) { j++; continue; }
        break;
      }
      const strict = RE.callout.exec(t);
      const c = strict || (CFG.lenientCallouts && RE.calloutLoose.exec(t));
      add(c ? 'callout' : 'quote', i, j - 1, c ? { calloutType: c[1].toLowerCase(), fold: c[2], lenient: !strict } : {});
      i = j; continue;
    }

    if ((m = RE.list.exec(t))) {
      const kind = listKind(m[2]);
      const base = indentWidth(m[1]);
      const otherTopKind = (lm) => indentWidth(lm[1]) <= base && listKind(lm[2]) !== kind;
      j = i + 1;
      while (j < n) {
        const u = lines[j];
        if (RE.blank.test(u)) {
          let k = j + 1;
          while (k < n && RE.blank.test(lines[k])) k++;
          if (k >= n) break;
          const lm = RE.list.exec(lines[k]);
          if (lm && otherTopKind(lm)) break;
          if (lm || RE.indented.test(lines[k])) { j = k; continue; }
          break;
        }
        const lm = RE.list.exec(u);
        if (lm) { if (otherTopKind(lm)) break; j++; continue; }
        if (RE.indented.test(u)) { j++; continue; }
        if (!startsBlock(u) && !RE.blank.test(lines[j - 1])) { j++; continue; }
        break;
      }
      add(kind, i, j - 1);
      i = j; continue;
    }

    if (RE.fnDef.test(t)) {
      j = i + 1;
      while (j < n && RE.indented.test(lines[j]) && !RE.blank.test(lines[j])) j++;
      add('fn', i, j - 1);
      i = j; continue;
    }

    if (t.includes('|') && i + 1 < n && lines[i + 1].includes('|') && RE.tableSep.test(lines[i + 1])) {
      j = i + 2;
      while (j < n && !RE.blank.test(lines[j]) && lines[j].includes('|')) j++;
      add('table', i, j - 1);
      i = j; continue;
    }

    // 문단 (+ setext 제목)
    j = i + 1;
    let setext = 0;
    while (j < n && !RE.blank.test(lines[j])) {
      const sm = RE.setext.exec(lines[j]);
      if (sm) { setext = sm[1][0] === '=' ? 1 : 2; break; }
      if (startsBlock(lines[j])) break;
      j++;
    }
    if (setext) { add('h', i, j, { level: setext, setext: true }); i = j + 1; continue; }
    add('p', i, j - 1);
    i = j;
  }
  return { blocks, lineBlock };
}

/* ───────────────────────── 2. 간격 계획 ───────────────────────── */

const BLOCK_KEYS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'quote', 'callout', 'code', 'math', 'table', 'hr'];
const keyOf = (b) => (b.type === 'h' ? 'h' + b.level : (b.type === 'fn' ? 'p' : b.type));
// 편집 모드에서 줄 대신 위젯으로 그려지는 블록: 블록 자신의 첫 줄을 꾸밀 수 없다.
const WIDGETISH = new Set(['table', 'callout', 'math', 'hr']);
// 붙여 쓴 콜아웃은 Obsidian 이 위젯으로 바꾸지 않으므로 줄로 남는다
const isWidget = (b) => WIDGETISH.has(b.type) && !b.lenient;

/** 기본 테마(Obsidian 1.15)에서 잰 값. 보정이 실패하면 이 값을 쓴다. */
function defaultMetrics() {
  const mt = { p: 16, ul: 16, ol: 16, quote: 16, callout: 16, code: 16, math: 16, table: 16, hr: 32 };
  const mb = Object.assign({}, mt);
  for (let l = 1; l <= 6; l++) { mt['h' + l] = 16; mb['h' + l] = 16; }
  const gap = {};
  for (const a of BLOCK_KEYS) {
    gap[a] = {};
    for (const b of BLOCK_KEYS) {
      let top = mt[b];
      if (/^h\d$/.test(b) && ['p', 'code', 'table', 'ul', 'ol', 'quote'].includes(a)) top = 40;
      gap[a][b] = Math.max(mb[a], top);
    }
  }
  return {
    version: 0, calibrated: false, gap,
    lpInset: { table: { top: 16, bottom: 16 } },
    code: { lh: 24, pt: 12, pb: 12, preFs: '16px', preFf: 'var(--font-monospace)', codeFs: 'var(--code-size)', codeFf: 'var(--font-monospace)', codeLh: '21px' },
    math: { pt: 4.8, pb: 4.8 },
    hr: { h: 2 },
    list: { ulText: 29.8, ulBullet: 17, olText: 29.8 },
    quote: { text: 25 },
    callout: { pt: 12, pr: 12, pb: 12, pl: 24, titleLh: 20.8, titleFs: '16px', titleFw: '400', titleToBody: 16, bodyToBottom: 16, radius: '4px', iconW: 16, iconGap: 4, iconSize: 16, bw: 0 },
    calloutStyles: new Map(),
  };
}

/**
 * 문서 전체에 대한 줄 장식 계획.
 * out[i] = { c: string[] (클래스), s: string (인라인 CSS 변수) }
 * titles: Map<줄번호, {prefixLen, type}>  (편집 중 콜아웃 제목 줄)
 */
function makePlan(lines, M, getCalloutStyle) {
  const { blocks, lineBlock } = classify(lines);
  const out = new Array(lines.length);
  const titles = new Map();
  const spacers = [];
  const add = (i, c, s) => {
    const o = out[i] || (out[i] = { c: [], s: '', g: -1 });
    for (const x of c.split(' ')) if (x && !o.c.includes(x)) o.c.push(x);
    if (s) o.s += s;
  };
  const gapOf = (a, b) => {
    const g = (M.gap[keyOf(a)] || {})[keyOf(b)];
    const insetB = (M.lpInset[a.type] || {}).bottom || 0;
    const insetT = (M.lpInset[b.type] || {}).top || 0;
    return Math.max(0, Math.round(((g == null ? 16 : g) - insetB - insetT) * 10) / 10);
  };
  const setGapLine = (i, g) => {
    add(i, 'mp-gap', `--mp-g:${g}px;`);
    out[i].g = g;
  };

  /** 블록들 사이의 빈 줄/여백. inner=true 이면 인용·콜아웃 안쪽(배경이 이어져야 하므로 padding 사용) */
  function planGaps(src, blks, base, inner) {
    for (let k = 0; k < blks.length; k++) {
      const b = blks[k], prev = blks[k - 1];
      const from = prev ? prev.end + 1 : 0, to = b.start - 1;
      const leading = !prev || prev.type === 'fm';
      if (to >= from) {
        if (leading) { for (let i = from; i <= to; i++) add(base + i, 'mp-collapse'); continue; }
        setGapLine(base + from, gapOf(prev, b));
        for (let i = from + 1; i <= to; i++) add(base + i, 'mp-collapse');
      } else if (!leading) {
        const g = gapOf(prev, b);
        if (g <= 0) continue;
        // 줄 테두리로 간격을 줄 수 있는 쪽: 위젯이 아니고, 배경을 테두리까지 칠하는 콜아웃 줄도 아닌 블록
        const canTake = (x) => !isWidget(x) && x.type !== 'callout';
        if (inner && !isWidget(b)) add(base + b.start, 'mp-gbi', `--mp-gb:${g}px;`);
        else if (inner && !isWidget(prev)) add(base + prev.end, 'mp-gai', `--mp-ga:${g}px;`);
        else if (!inner && canTake(b)) add(base + b.start, 'mp-gb', `--mp-gb:${g}px;`);
        else if (!inner && canTake(prev)) add(base + prev.end, 'mp-ga', `--mp-ga:${g}px;`);
        else if (!inner) spacers.push({ line: base + b.start, g }); // 둘 사이에 블록 간격 위젯
      }
    }
    const last = blks[blks.length - 1];
    for (let i = last ? last.end + 1 : 0; i < src.length; i++) if (RE.blank.test(src[i])) add(base + i, 'mp-collapse');
  }

  planGaps(lines, blocks, 0, false);

  for (const b of blocks) {
    if (b.type === 'p') {
      for (let i = b.start; i <= b.end; i++) if (RE.imageLine.test(lines[i])) add(i, 'mp-img-line');
    }
    switch (b.type) {
      case 'h':
        for (let i = b.start; i <= b.end; i++) add(i, 'mp-h');
        break;
      case 'ul': case 'ol': {
        // 중첩 목록: 읽기 모드에서는 부모 li 의 아래 여백이 자식 목록 "뒤"에 붙는다.
        // 항목 줄의 아래 여백 = list-spacing × (1 + 내 깊이 − 다음 항목 깊이), 다음이 더 깊으면 0.
        const items = [], stack = [];
        for (let i = b.start; i <= b.end; i++) {
          const lm = RE.list.exec(lines[i]);
          if (!lm) continue;
          const w = indentWidth(lm[1]);
          while (stack.length && stack[stack.length - 1] >= w) stack.pop();
          stack.push(w);
          items.push({ i, depth: stack.length });
        }
        for (let k = 0; k < items.length; k++) {
          const d = items[k].depth, nd = k + 1 < items.length ? items[k + 1].depth : 1;
          const mult = Math.max(0, 1 + d - nd);
          if (mult !== 1) add(items[k].i, 'mp-lpb', `--mp-lpb:${mult};`);
        }
        // 목록 안의 빈 줄: 다음이 항목이면 읽기 모드에서 간격 0, 이어지는 문단이면 문단 간격
        for (let i = b.start; i <= b.end; i++) {
          if (!RE.blank.test(lines[i])) continue;
          let k = i;
          while (k <= b.end && RE.blank.test(lines[k])) k++;
          const nextIsItem = k <= b.end && RE.list.test(lines[k]);
          if (nextIsItem) for (let x = i; x < k; x++) add(x, 'mp-collapse');
          else { setGapLine(i, M.gap.p.p); for (let x = i + 1; x < k; x++) add(x, 'mp-collapse'); }
          i = k - 1;
        }
        break;
      }
      case 'quote': {
        const src = [];
        for (let i = b.start; i <= b.end; i++) src.push(lines[i].replace(RE.stripQuote, ''));
        const inner = classify(src).blocks;
        planGaps(src, inner, b.start, true);
        break;
      }
      case 'callout': {
        const st = getCalloutStyle(b.calloutType);
        const vars = `--mp-co-bg:${st.bg};--mp-co-color:${st.color};--mp-co-bc:${st.bc};`;
        const single = b.end === b.start;
        add(b.start, 'mp-co mp-co-title' + (single ? ' mp-co-last' : ''), vars);
        const pm = calloutPrefixOf(lines[b.start]);
        titles.set(b.start, { prefixLen: pm ? pm[0].length : 0, type: b.calloutType, icon: st.icon, color: st.color });
        if (!single) {
          const src = [];
          for (let i = b.start + 1; i <= b.end; i++) {
            src.push(lines[i].replace(RE.stripQuote, ''));
            add(i, 'mp-co mp-co-body' + (i === b.end ? ' mp-co-last' : ''), vars);
          }
          planGaps(src, classify(src).blocks, b.start + 1, true);
        }
        break;
      }
      case 'code':
        add(b.start, 'mp-code-b');
        for (let i = b.start + 1; i < b.end; i++) add(i, 'mp-code');
        if (b.closed && b.end > b.start) add(b.end, 'mp-code-e');
        break;
      case 'hr':
        add(b.start, 'mp-hr');
        break;
    }
  }
  return { out, titles, blocks, lineBlock, spacers };
}

/* ───────────────────────── 3. 보정(읽기 모드 프로브) ───────────────────────── */

function eulerSequence(types, noLoop) {
  const adj = new Map(types.map((a) => [a, types.filter((b) => !(a === b && noLoop.has(a))).reverse()]));
  const stack = [types[0]], path = [];
  while (stack.length) {
    const v = stack[stack.length - 1];
    const e = adj.get(v);
    if (e.length) stack.push(e.pop()); else path.push(stack.pop());
  }
  return path.reverse();
}

const SAMPLE = {
  p: (i) => `mp${i} 문단`,
  h1: (i) => `# mp${i}`, h2: (i) => `## mp${i}`, h3: (i) => `### mp${i}`,
  h4: (i) => `#### mp${i}`, h5: (i) => `##### mp${i}`, h6: (i) => `###### mp${i}`,
  ul: (i) => `- mp${i}`, ol: (i) => `1. mp${i}`,
  quote: (i) => `> mp${i}`, callout: (i) => `> [!note] mp${i}\n> 본문`,
  code: (i) => '```\nmp' + i + '\n```', math: () => '$$\nx^2\n$$',
  table: (i) => `| a${i} | b |\n| --- | --- |\n| 1 | 2 |`, hr: () => '***',
};

class Calibrator {
  constructor(plugin) { this.plugin = plugin; this.host = null; this.version = 0; }

  ensureHost() {
    if (this.host && this.host.isConnected) return this.host;
    const host = document.body.createDiv({ cls: 'mp-probe workspace-leaf-content', attr: { 'data-type': 'markdown', 'data-mode': 'preview', 'aria-hidden': 'true' } });
    host.createDiv({ cls: 'view-content' })
      .createDiv({ cls: 'markdown-reading-view' })
      .createDiv({ cls: 'markdown-preview-view markdown-rendered node-insert-event is-readable-line-width allow-fold-headings allow-fold-lists show-indentation-guide' })
      .createDiv({ cls: 'markdown-preview-sizer markdown-preview-section' });
    host.createDiv({ cls: 'markdown-source-view mod-cm6 is-live-preview' })
      .createDiv({ cls: 'cm-embed-block cm-table-widget' });
    this.host = host;
    return host;
  }

  destroy() { if (this.host) this.host.remove(); this.host = null; }

  /** 블록 쌍마다 실제 간격, 코드/콜아웃/목록/인용 기하를 잰다. */
  async run() {
    const M = defaultMetrics();
    const host = this.ensureHost();
    const sizer = host.querySelector('.markdown-preview-sizer');
    sizer.empty();
    const comp = new Component();
    comp.load();
    try {
      const within = (p, ms) => Promise.race([Promise.resolve(p).catch(() => null), new Promise((r) => setTimeout(r, ms))]);
      try { await within(obsidian.loadMathJax(), 3000); } catch (e) { /* 수식 없이 진행 */ }
      const seq = eulerSequence(BLOCK_KEYS, new Set(['ul', 'ol']));
      const md = seq.map((t, i) => SAMPLE[t](i)).join('\n\n') +
        '\n\n- mpL1\n    - mpL2\n\n1. mpO1\n\n> mpQ1\n> > mpQ2\n\n```\nmpC1\nmpC2\nmpC3\n```\n\n> [!note] mpT\n> mpB1\n>\n> mpB2';
      await MarkdownRenderer.render(this.plugin.app, md, sizer, '', comp);
      try { if (obsidian.finishRenderMath) await within(obsidian.finishRenderMath(), 2000); } catch (e) { /* ignore */ }
      // requestAnimationFrame 은 창이 가려져 있으면 멈추므로 타이머로 기다린다(측정은 동기 레이아웃으로 충분)
      await new Promise((r) => setTimeout(r, 30));

      // 읽기 모드는 블록마다 div.el-<태그> 로 감싼다(표는 overflow-x:auto → 여백이 겹치지 않음). 똑같이 감싼다.
      for (const el of Array.from(sizer.children)) {
        if (/(^|\s)el-/.test(el.className)) continue;
        const w = document.createElement('div');
        const tag = el.tagName.toLowerCase();
        w.className = 'el-' + tag;
        el.replaceWith(w);
        w.appendChild(el);
      }
      const els = [];
      for (const c of Array.from(sizer.children)) {
        if (c.classList.contains('mod-ui') || c.classList.contains('markdown-preview-pusher')) continue;
        const el = /(^|\s)el-/.test(c.className) ? c.firstElementChild : c;
        if (el) els.push(el);
      }
      const box = (el) => el.getBoundingClientRect();
      const r1 = (v) => Math.round(v * 10) / 10;

      if (els.length >= seq.length) {
        for (let i = 1; i < seq.length; i++) {
          const a = seq[i - 1], b = seq[i];
          M.gap[a][b] = r1(box(els[i]).top - box(els[i - 1]).bottom);
        }
        M.calibrated = true;
      }
      // 블록 수가 맞지 않으면(테마가 구조를 바꾼 경우 등) 기본값을 그대로 쓴다

      const find = (sel, text) => Array.from(sizer.querySelectorAll(sel)).find((e) => e.textContent.includes(text));
      const textRect = (el, text) => {
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = w.nextNode())) {
          const idx = n.data.indexOf(text);
          if (idx >= 0) { const r = document.createRange(); r.setStart(n, idx); r.setEnd(n, idx + 1); return r.getBoundingClientRect(); }
        }
        return null;
      };

      // 코드 블록: 위/아래 안쪽 여백과 줄 높이
      const pre = find('pre', 'mpC1');
      if (pre) {
        const cs = getComputedStyle(pre);
        const pt = parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth);
        const pb = parseFloat(cs.paddingBottom) + parseFloat(cs.borderBottomWidth);
        const a = textRect(pre, 'mpC1'), c = textRect(pre, 'mpC3');
        const lh = a && c ? (c.top - a.top) / 2 : 24;
        const code = pre.querySelector('code');
        // pre 의 글꼴(줄 상자의 strut)과 code 글꼴을 따로 기록 → 편집 모드에서 같은 기준선을 만든다
        M.code = { lh: r1(lh), pt: r1(pt), pb: r1(pb), preFs: cs.fontSize, preFf: cs.fontFamily,
          codeFs: code ? getComputedStyle(code).fontSize : cs.fontSize, codeFf: code ? getComputedStyle(code).fontFamily : cs.fontFamily,
          codeLh: code ? getComputedStyle(code).lineHeight : 'normal' };
      }

      // 수식: MathJax 상자 안쪽 여백(편집 모드는 1em 을 따로 쓴다)
      const mjx = sizer.querySelector('.math-block mjx-container');
      if (mjx) {
        const cs = getComputedStyle(mjx);
        M.math = { pt: r1(parseFloat(cs.paddingTop)), pb: r1(parseFloat(cs.paddingBottom)) };
      }

      // 구분선 두께
      const hr = sizer.querySelector('hr');
      if (hr) M.hr = { h: r1(box(hr).height) };

      // 목록: 글자 시작 x, 글머리표 중심 x
      const ul = find('ul', 'mpL1');
      if (ul) {
        const ulBox = box(ul), li = ul.querySelector('li');
        const t = textRect(li, 'mpL1');
        const bullet = li.querySelector('.list-bullet');
        const bb = bullet ? box(bullet) : null;
        if (t) M.list.ulText = r1(t.left - ulBox.left);
        if (bb) M.list.ulBullet = r1(bb.left + bb.width / 2 - ulBox.left);
      }
      const ol = find('ol', 'mpO1');
      if (ol) { const t = textRect(ol, 'mpO1'); if (t) M.list.olText = r1(t.left - box(ol).left); }

      // 인용: 글자 시작 x
      const bq = find('blockquote', 'mpQ1');
      if (bq) { const t = textRect(bq, 'mpQ1'); if (t) M.quote.text = r1(t.left - box(bq).left); }

      // 콜아웃 기하
      const co = find('.callout', 'mpT');
      if (co) {
        const cb = box(co), cs = getComputedStyle(co);
        const inner = co.querySelector('.callout-title-inner');
        const icon = co.querySelector('.callout-icon');
        const ib = box(inner), ic = icon ? box(icon) : null;
        const svg = icon && icon.querySelector('svg');
        const b1 = textRect(co, 'mpB1'), b2 = textRect(co, 'mpB2');
        const ps = Array.from(co.querySelectorAll('.callout-content p'));
        const p1 = ps[0] ? box(ps[0]) : null, p2 = ps[ps.length - 1] ? box(ps[ps.length - 1]) : null;
        const ti = getComputedStyle(inner);
        const bw = parseFloat(cs.borderTopWidth) || 0;
        M.callout = {
          pt: r1(ib.top - cb.top - bw),
          pl: r1((ic ? ic.left : ib.left) - cb.left - bw),
          pr: r1(parseFloat(cs.paddingRight) + 0),
          titleLh: r1(ib.height), titleFs: ti.fontSize, titleFw: ti.fontWeight, titleFf: ti.fontFamily,
          titleToBody: p1 ? r1(p1.top - ib.bottom) : 16,
          bodyToBottom: p2 ? r1(cb.bottom - bw - p2.bottom) : r1(parseFloat(cs.paddingBottom)),
          pb: r1(parseFloat(cs.paddingBottom)),
          radius: cs.borderTopLeftRadius,
          iconW: ic ? r1(ic.width) : 0, iconGap: ic ? r1(ib.left - ic.right) : 0,
          iconSize: svg ? r1(box(svg).width) : 16,
          bw,
          bodyLeft: b1 ? r1(b1.left - cb.left - bw) : null,
          innerGap: b1 && b2 ? null : null,
        };
      }

      // 편집 모드 표 위젯의 위/아래 안쪽 여백(손잡이 자리)
      const tw = host.querySelector('.cm-table-widget');
      if (tw) {
        const cs = getComputedStyle(tw);
        M.lpInset.table = { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
      }
    } catch (e) {
      console.error('[mode-parity] calibration failed', e);
    } finally {
      comp.unload();
      sizer.empty();
    }
    M.version = ++this.version;
    return M;
  }

  /** 콜아웃 종류별 색/아이콘 (사용자 정의 콜아웃 포함) */
  calloutStyle(type, cache) {
    if (cache.has(type)) return cache.get(type);
    const host = this.ensureHost();
    const sizer = host.querySelector('.markdown-preview-sizer');
    const el = sizer.createDiv({ cls: 'callout', attr: { 'data-callout': type } });
    const title = el.createDiv({ cls: 'callout-title' });
    title.createDiv({ cls: 'callout-icon' });
    const inner = title.createDiv({ cls: 'callout-title-inner', text: 'x' });
    const cs = getComputedStyle(el);
    const st = {
      bg: cs.backgroundColor,
      color: getComputedStyle(inner).color,
      icon: (cs.getPropertyValue('--callout-icon') || 'lucide-pencil').trim(),
      bc: cs.borderTopColor,
    };
    el.remove();
    cache.set(type, st);
    return st;
  }
}

/* ───────────────────────── 4. CM6 확장 ───────────────────────── */

const refreshEffect = StateEffect.define();
const FOOTREF = /\[\^[^\]\s]+\]/g;
const HIDE = Decoration.replace({});

/** 위젯 두 개(예: 수식 → 콜아웃)가 빈 줄 없이 붙었을 때 둘 사이에 넣는 간격 */
class SpacerWidget extends WidgetType {
  constructor(px) { super(); this.px = px; }
  eq(o) { return o.px === this.px; }
  toDOM() {
    const d = createDiv({ cls: 'mp-spacer' });
    d.setCssProps({ '--mp-spacer-h': this.px + 'px' });
    return d;
  }
  get estimatedHeight() { return this.px; }
  ignoreEvent() { return false; }
}

class CalloutIconWidget extends WidgetType {
  constructor(icon, color, lineFrom, typeOffset) {
    super();
    this.icon = icon; this.color = color; this.lineFrom = lineFrom; this.typeOffset = typeOffset;
  }
  eq(o) { return o.icon === this.icon && o.color === this.color && o.lineFrom === this.lineFrom && o.typeOffset === this.typeOffset; }
  toDOM(view) {
    const span = document.createElement('span');
    span.className = 'mp-co-icon';
    span.setAttribute('aria-label', tr('iconLabel'));
    setIconSafe(span, this.icon);
    span.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      // 아이콘을 누르면 [!종류] 를 드러내고 종류 이름 안에 커서를 둔다
      view.dispatch({ selection: { anchor: this.lineFrom + this.typeOffset } });
      view.focus();
    });
    return span;
  }
  ignoreEvent() { return true; }
}

function buildExtension(plugin) {
  const planCache = new WeakMap();
  const getPlan = (state) => {
    const doc = state.doc;
    let p = planCache.get(doc);
    if (p && p.version === plugin.metrics.version && p.optsKey === plugin.optsKey) return p;
    const lines = doc.toString().split('\n');
    p = makePlan(lines, plugin.metrics, (t) => plugin.calibrator.calloutStyle(t, plugin.metrics.calloutStyles));
    p.version = plugin.metrics.version;
    p.optsKey = plugin.optsKey;
    planCache.set(doc, p);
    return p;
  };

  const isLive = (state) => {
    try { return state.field(obsidian.editorLivePreviewField); } catch (e) { return true; }
  };

  // 블록 위젯은 ViewPlugin 이 아니라 StateField 로만 줄 수 있다
  const buildSpacers = (state) => {
    if (!plugin.settings.enabled || !plugin.settings.spacing || !isLive(state)) return Decoration.none;
    const plan = getPlan(state);
    if (!plan.spacers.length) return Decoration.none;
    const b = new RangeSetBuilder();
    for (const sp of plan.spacers) {
      if (sp.line + 1 > state.doc.lines) continue;
      b.add(state.doc.line(sp.line + 1).from, state.doc.line(sp.line + 1).from,
        Decoration.widget({ widget: new SpacerWidget(sp.g), block: true, side: -1 }));
    }
    return b.finish();
  };
  const spacerField = StateField.define({
    create: buildSpacers,
    update(deco, tr) {
      const refresh = tr.effects.some((e) => e.is(refreshEffect));
      if (tr.docChanged || refresh || isLive(tr.startState) !== isLive(tr.state)) return buildSpacers(tr.state);
      return deco;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  class ParityView {
    constructor(view) {
      this.view = view;
      this.decorations = Decoration.none;
      this.atomic = Decoration.none;
      this.build();
    }
    update(u) {
      const refresh = u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshEffect)));
      const modeChanged = isLive(u.startState) !== isLive(u.state);
      if (u.docChanged || u.viewportChanged || u.selectionSet || refresh || modeChanged) this.build();
    }
    build() {
      const view = this.view, state = view.state;
      if (!plugin.settings.enabled || !isLive(state)) {
        this.decorations = Decoration.none; this.atomic = Decoration.none; return;
      }
      const plan = getPlan(state);
      const doc = state.doc;
      const sel = state.selection.ranges;
      const touched = new Set();
      for (const r of sel) {
        const a = doc.lineAt(r.from).number, b = doc.lineAt(r.to).number;
        for (let x = a; x <= b && x - a < 2000; x++) touched.add(x - 1);
      }
      const blockOf = (i) => (plan.lineBlock[i] >= 0 ? plan.blocks[plan.lineBlock[i]] : null);
      const activeBlocks = new Set();
      for (const i of touched) { const b = blockOf(i); if (b) activeBlocks.add(b); }

      const S = plugin.settings;
      const builder = new RangeSetBuilder();
      const atomic = new RangeSetBuilder();
      let lastLine = -1;
      for (const { from, to } of view.visibleRanges) {
        let pos = from;
        while (pos <= to) {
          const line = doc.lineAt(pos);
          pos = line.to + 1;
          const i = line.number - 1;
          if (i <= lastLine) continue;
          lastLine = i;
          const spec = plan.out[i];
          const cursorHere = touched.has(i);
          const b = blockOf(i);
          let cls = spec ? spec.c : [];
          if (!S.spacing) cls = cls.filter((c) => !/^mp-(gap|collapse|ga|gb|gai|gbi|lpb)$/.test(c));
          if (cursorHere) {
            // 커서가 있는 빈 줄은 접지 않는다(캐럿이 보이도록)
            cls = cls.filter((c) => c !== 'mp-collapse' && !(c === 'mp-gap' && spec.g < 12));
          }
          if (!S.liveCallouts) cls = cls.filter((c) => !c.startsWith('mp-co'));
          const extra = [];
          if (b && activeBlocks.has(b)) extra.push('mp-act');
          if (cursorHere) extra.push('mp-cur');
          // 콜아웃 제목 맨 앞에 커서가 있으면 "> [!종류]" 를 흐리게 드러낸다
          const tt = S.liveCallouts && plan.titles.get(i);
          const revealTitle = !!(tt && tt.prefixLen > 0 && sel.some((r) => r.from < line.from + tt.prefixLen && r.to >= line.from));
          if (revealTitle) extra.push('mp-co-reveal');
          const all = cls.concat(extra);
          if (spec && all.length) {
            builder.add(line.from, line.from, Decoration.line({ attributes: { class: all.join(' '), style: spec.s } }));
          }

          // 편집 중 콜아웃: 제목 줄의 "> [!종류] " 를 아이콘으로 바꾼다
          let after = line.from;
          const t = S.liveCallouts && plan.titles.get(i);
          if (t && t.prefixLen > 0 && cls.includes('mp-co-title')) {
            const pEnd = line.from + t.prefixLen;
            if (!revealTitle) {
              const typeOffset = line.text.indexOf('[!') + 2;
              const deco = Decoration.replace({ widget: new CalloutIconWidget(t.icon, t.color, line.from, typeOffset) });
              builder.add(line.from, pEnd, deco);
              atomic.add(line.from, pEnd, deco);
            }
            after = pEnd;
          }

          // 각주 참조 [^1]: 읽기 모드는 [1] 로 보인다 → 커서가 없는 줄에서 ^ 를 숨긴다
          if (S.spacing && !cursorHere && line.text.includes('[^') && !(b && (b.type === 'code' || b.type === 'math'))) {
            FOOTREF.lastIndex = 0;
            let m;
            while ((m = FOOTREF.exec(line.text))) {
              const at = line.from + m.index + 1; // '^' 위치
              if (m.index === 0 && line.text[m[0].length] === ':') continue; // 각주 정의 줄
              if (at <= after) continue;
              if ((line.text.slice(0, m.index).match(/`/g) || []).length % 2) continue; // 인라인 코드 안
              builder.add(at, at + 1, HIDE);
              after = at + 1;
            }
          }
        }
      }
      this.decorations = builder.finish();
      this.atomic = atomic.finish();
    }
  }

  const viewPlugin = ViewPlugin.fromClass(ParityView, {
    decorations: (v) => v.decorations,
    provide: (p) => EditorView.atomicRanges.of((view) => {
      const inst = view.plugin(p);
      return inst ? inst.atomic : Decoration.none;
    }),
  });

  // 콜아웃 제목 맨 앞으로 커서가 "들어올" 때는 제목 글자 앞으로 옮긴다.
  // (제목 글자 앞에서 ← 를 누른 경우에만 [!종류] 가 드러난다)
  const titleSnap = EditorState.transactionFilter.of((tr) => {
    if (!plugin.settings.enabled || !plugin.settings.liveCallouts || !tr.selection || tr.docChanged) return tr;
    const sel = tr.selection;
    if (sel.ranges.length !== 1 || !sel.main.empty) return tr;
    const state = tr.startState;
    if (!isLive(state)) return tr;
    const head = sel.main.head;
    const line = state.doc.lineAt(head);
    if (head !== line.from) return tr;
    const pm = calloutPrefixOf(line.text);
    if (!pm) return tr;
    const pEnd = line.from + pm[0].length;
    const prev = state.selection.main;
    if (prev.empty && prev.head >= line.from && prev.head <= pEnd) return tr; // 같은 줄 안에서 키보드로 이동
    return [tr, { selection: { anchor: pEnd }, sequential: true }];
  });

  // 렌더된 콜아웃 위젯을 클릭하면: Obsidian 은 블록 전체를 선택하며 원문으로 바꾼다.
  // 대신 캡처 단계에서 가로채 → 원문 줄(이 플러그인이 렌더된 모양으로 그림)로 바꾼 뒤
  // 클릭한 좌표의 글자에 커서를 둔다. 두 모양이 픽셀 단위로 같으므로 클릭한 그 글자에 정확히 들어간다.
  const clickThrough = ViewPlugin.fromClass(class {
    constructor(view) {
      this.view = view;
      this.swallow = false;
      this.onDown = (ev) => this.mousedown(ev);
      this.onUpClick = (ev) => {
        if (!this.swallow) return;
        ev.preventDefault();
        ev.stopPropagation();
        if (ev.type === 'click') this.swallow = false;
      };
      view.dom.addEventListener('mousedown', this.onDown, true);
      view.dom.addEventListener('mouseup', this.onUpClick, true);
      view.dom.addEventListener('click', this.onUpClick, true);
    }
    destroy() {
      this.view.dom.removeEventListener('mousedown', this.onDown, true);
      this.view.dom.removeEventListener('mouseup', this.onUpClick, true);
      this.view.dom.removeEventListener('click', this.onUpClick, true);
    }
    mousedown(ev) {
      const view = this.view;
      this.swallow = false;
      if (!plugin.settings.enabled || !plugin.settings.liveCallouts || ev.button !== 0 || ev.detail > 1) return;
      if (!isLive(view.state)) return;
      const target = ev.target;
      if (!(target instanceof Element)) return;
      const block = target.closest('.cm-embed-block.cm-callout');
      if (!block || target.closest('a, input, button, .callout-fold, .embed-actions, .edit-block-button, .internal-embed, .callout-icon')) return;
      let start;
      try { start = view.posAtDOM(block); } catch (e) { return; }
      const startLine = view.state.doc.lineAt(start);
      const pm = RE.calloutPrefix.exec(startLine.text);
      if (!pm) return;
      ev.preventDefault();
      ev.stopPropagation();
      this.swallow = true;
      const x = ev.clientX, y = ev.clientY;
      const minPos = startLine.from + pm[0].length;
      view.dispatch({ selection: { anchor: minPos }, userEvent: 'select.pointer' });
      view.focus();
      // dispatch 직후 DOM 은 이미 원문 줄(렌더된 모양)로 바뀌어 있다 → 같은 좌표의 글자 위치
      const place = () => {
        const pos = view.posAtCoords({ x, y });
        if (pos == null) return;
        const p = Math.max(pos, minPos);
        if (p !== view.state.selection.main.head) view.dispatch({ selection: { anchor: p }, userEvent: 'select.pointer' });
      };
      place();
      setTimeout(place, 50); // Obsidian 의 들여쓰기 측정 등으로 줄 모양이 한 번 더 바뀌는 경우
    }
  });

  plugin.viewPlugin = viewPlugin; // 디버깅/측정용
  // Obsidian 의 Live Preview 장식(예: [!tip] 숨김)보다 우선해야 아이콘 치환이 살아남는다
  return [Prec.highest(viewPlugin), spacerField, titleSnap, clickThrough];
}

/* ───────────────────────── 4-1. 읽기 모드: 붙여 쓴 콜아웃 ───────────────────────── */

/**
 * 읽기 모드에서 ">[!info]제목" 처럼 ] 뒤에 공백 없이 쓴 인용문을
 * Obsidian 이 만드는 것과 같은 콜아웃 DOM 으로 바꾼다. (파일 내용은 그대로)
 */
function convertLooseCallouts(root, plugin) {
  for (const bq of Array.from(root.querySelectorAll('blockquote'))) {
    if (bq.closest('.callout')) continue;
    const firstP = bq.firstElementChild;
    if (!firstP || firstP.tagName !== 'P') continue;
    const tw = document.createTreeWalker(firstP, NodeFilter.SHOW_TEXT);
    let tn = tw.nextNode();
    while (tn && !tn.data.trim()) tn = tw.nextNode();
    if (!tn || tn.parentNode !== firstP) continue;
    const m = /^\s*\[!([^\]\s]+)\]([+-]?)(?=\S)/.exec(tn.data);
    if (!m) continue;
    tn.data = tn.data.slice(m[0].length);
    const type = m[1].toLowerCase();
    const st = plugin.calibrator.calloutStyle(type, plugin.metrics.calloutStyles);

    const callout = createDiv({ cls: 'callout', attr: { 'data-callout': type, 'data-callout-fold': '', 'data-callout-metadata': '' } });
    const title = callout.createDiv({ cls: 'callout-title', attr: { dir: 'auto' } });
    const icon = title.createDiv({ cls: 'callout-icon' });
    setIconSafe(icon, st.icon);
    const inner = title.createDiv({ cls: 'callout-title-inner' });
    // 첫 줄(첫 <br> 전까지) = 제목
    while (firstP.firstChild && firstP.firstChild.nodeName !== 'BR') inner.appendChild(firstP.firstChild);
    if (firstP.firstChild && firstP.firstChild.nodeName === 'BR') firstP.firstChild.remove();
    while (firstP.firstChild && firstP.firstChild.nodeType === 3 && !firstP.firstChild.data.trim()) firstP.firstChild.remove();
    if (!firstP.childNodes.length) firstP.remove();
    if (bq.childNodes.length && bq.textContent.trim() !== '' || bq.querySelector('img, .internal-embed, table, ul, ol, pre')) {
      const content = callout.createDiv({ cls: 'callout-content' });
      while (bq.firstChild) content.appendChild(bq.firstChild);
    }
    const wrap = bq.parentElement;
    bq.replaceWith(callout);
    // 읽기 모드 블록 래퍼도 진짜 콜아웃과 같게(제목 앞 간격 규칙 등)
    if (wrap && wrap.classList.contains('el-blockquote')) { wrap.classList.remove('el-blockquote'); wrap.classList.add('el-div'); }
  }
}

function setIconSafe(el, icon) {
  try { obsidian.setIcon(el, icon.replace(/^lucide-/, '')); } catch (e) { /* ignore */ }
  if (!el.firstChild) try { obsidian.setIcon(el, icon); } catch (e) { /* ignore */ }
}

/* ───────────────────────── 5. 차이 측정(검사기) ───────────────────────── */

function anchorText(line) {
  let t = line;
  if (/^\s*$/.test(t) || /^\s*(```|~~~|\$\$|---\s*$|\*\*\*\s*$|\|\s*:?-)/.test(t)) return null;
  t = t.replace(/^\s*(>\s*)+/, '').replace(/^\[![^\]]+\][+-]?\s*/, '')
    .replace(/^\s*#{1,6}\s+/, '').replace(/^\s*([-*+]|\d+[.)])\s+(\[.\]\s+)?/, '')
    .replace(/^\|\s*/, '').replace(/\s*\|.*$/, '');
  t = t.trim();
  if (!t || /[*_=`[\]$%<>]/.test(t.slice(0, 12)) || /^[\w-]+:\s/.test(t)) return null;
  return t.slice(0, 12);
}

function measurePanes(lpView, rvView) {
  const src = lpView.editor.getValue().split('\n');
  const lpScroller = lpView.contentEl.querySelector('.cm-scroller');
  const lpRoot = lpView.contentEl.querySelector('.cm-content');
  const rvScroller = rvView.contentEl.querySelector('.markdown-preview-view');
  const rvRoot = rvView.contentEl.querySelector('.markdown-preview-sizer');
  const anchors = src.map((l, i) => [i, anchorText(l)]).filter(([, a]) => a);
  const locate = (sc, root) => {
    const scRect = sc.getBoundingClientRect(), rootRect = root.getBoundingClientRect();
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [], starts = [];
    let flat = '', n;
    while ((n = w.nextNode())) { if (n.data.length) { nodes.push(n); starts.push(flat.length); flat += n.data; } }
    const nodeAt = (off) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= off) lo = m; else hi = m - 1; } return lo; };
    const res = {};
    let pos = 0;
    for (const [i, a] of anchors) {
      const idx = flat.indexOf(a, pos);
      if (idx < 0) continue;
      const k = nodeAt(idx), off = idx - starts[k];
      const r = document.createRange();
      r.setStart(nodes[k], off); r.setEnd(nodes[k], Math.min(off + 1, nodes[k].data.length));
      const rc = r.getClientRects()[0] || r.getBoundingClientRect();
      res[i] = { y: rc.top - scRect.top + sc.scrollTop, x: rc.left - rootRect.left };
      pos = idx + 1;
    }
    return res;
  };
  const A = locate(lpScroller, lpRoot), B = locate(rvScroller, rvRoot);
  const common = anchors.filter(([i]) => A[i] && B[i]);
  if (!common.length) return { rows: [], maxDy: 0, maxDx: 0 };
  const f = common[0][0];
  const rows = [];
  let maxDy = 0, maxDx = 0;
  for (const [i, a] of common) {
    const dy = Math.round(((A[i].y - A[f].y) - (B[i].y - B[f].y)) * 10) / 10;
    const dx = Math.round((A[i].x - B[i].x) * 10) / 10;
    maxDy = Math.max(maxDy, Math.abs(dy)); maxDx = Math.max(maxDx, Math.abs(dx));
    rows.push({ line: i + 1, text: a, dy, dx });
  }
  return { rows, maxDy, maxDx };
}

class MeasureModal extends Modal {
  constructor(app, result) { super(app); this.result = result; }
  onOpen() {
    const { contentEl } = this;
    const r = this.result;
    contentEl.addClass('mp-measure');
    this.titleEl.setText(tr('modalTitle'));
    contentEl.createEl('p', { text: tr('modalSummary', { n: r.rows.length, dy: r.maxDy, dx: r.maxDx }) });
    const table = contentEl.createEl('table');
    const head = table.createEl('tr');
    [tr('colLine'), tr('colDy'), tr('colDx'), tr('colText')].forEach((h) => head.createEl('th', { text: h }));
    let prev = 0;
    for (const row of r.rows) {
      const tr = table.createEl('tr');
      const step = Math.round((row.dy - prev) * 10) / 10;
      prev = row.dy;
      if (Math.abs(step) >= 1 || Math.abs(row.dx) >= 1) tr.addClass('mp-off');
      tr.createEl('td', { text: String(row.line) });
      tr.createEl('td', { text: String(row.dy) });
      tr.createEl('td', { text: String(row.dx) });
      tr.createEl('td', { text: row.text });
    }
  }
  onClose() { this.contentEl.empty(); }
}

/* ───────────────────────── 6. 플러그인 ───────────────────────── */

const DEFAULT_SETTINGS = {
  enabled: true,
  spacing: true,
  lists: true,
  quotes: true,
  codeBlocks: true,
  mathBlocks: true,
  liveCallouts: true,
  hangingHeadingMarks: true,
  centerImages: true,
  lenientCallouts: true,
};

const FEATURE_CLASSES = {
  spacing: 'mp-spacing', lists: 'mp-lists', quotes: 'mp-quotes', codeBlocks: 'mp-code',
  mathBlocks: 'mp-math', liveCallouts: 'mp-callouts', hangingHeadingMarks: 'mp-hang',
  centerImages: 'mp-img-center',
};

class ModeParityPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.metrics = defaultMetrics();
    this.optsKey = '';
    this.calibrator = new Calibrator(this);
    this.applyBodyClasses();
    this.applyMetricVars();

    this.registerEditorExtension(buildExtension(this));
    this.registerMarkdownPostProcessor((el) => {
      if (this.settings.enabled && this.settings.lenientCallouts) convertLooseCallouts(el, this);
    });
    this.addSettingTab(new ModeParitySettingTab(this.app, this));

    this.addCommand({
      id: 'toggle',
      name: tr('cmdToggle'),
      callback: async () => {
        this.settings.enabled = !this.settings.enabled;
        await this.saveSettings();
        new Notice(tr(this.settings.enabled ? 'noticeOn' : 'noticeOff'));
      },
    });
    this.addCommand({
      id: 'open-compare',
      name: tr('cmdCompare'),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== 'md') return false;
        if (!checking) this.openCompare(file);
        return true;
      },
    });
    this.addCommand({
      id: 'measure',
      name: tr('cmdMeasure'),
      callback: () => this.measure(),
    });
    this.addCommand({
      id: 'recalibrate',
      name: tr('cmdRecalibrate'),
      callback: async () => { await this.recalibrate(); new Notice(tr('noticeCalibrated')); },
    });

    const recal = obsidian.debounce(() => this.recalibrate(), 400, true);
    this.registerEvent(this.app.workspace.on('css-change', recal));
    this.app.workspace.onLayoutReady(() => this.recalibrate());
  }

  onunload() {
    document.body.classList.remove('mp-on', ...Object.values(FEATURE_CLASSES));
    if (this.varNames) document.body.setCssProps(Object.fromEntries(this.varNames.map((k) => [k, ''])));
    this.calibrator.destroy();
  }

  applyBodyClasses() {
    const b = document.body;
    b.classList.toggle('mp-on', !!this.settings.enabled);
    CFG.lenientCallouts = !!(this.settings.enabled && this.settings.lenientCallouts);
    for (const [k, c] of Object.entries(FEATURE_CLASSES)) b.classList.toggle(c, !!this.settings[k]);
    this.optsKey = JSON.stringify(this.settings);
  }

  applyMetricVars() {
    const M = this.metrics, c = M.callout;
    const vars = {
      '--mp-code-lh': M.code.lh + 'px', '--mp-code-pt': M.code.pt + 'px', '--mp-code-pb': M.code.pb + 'px',
      '--mp-pre-fs': M.code.preFs, '--mp-pre-ff': M.code.preFf, '--mp-code-fs': M.code.codeFs, '--mp-code-ff': M.code.codeFf, '--mp-code-ilh': M.code.codeLh,
      '--mp-mjx-pt': M.math.pt + 'px', '--mp-mjx-pb': M.math.pb + 'px', '--mp-hr-h': M.hr.h + 'px',
      '--mp-ul-text': M.list.ulText + 'px', '--mp-ul-bullet': M.list.ulBullet + 'px', '--mp-ol-text': M.list.olText + 'px',
      '--mp-bq-text': M.quote.text + 'px',
      '--mp-co-pt': c.pt + 'px', '--mp-co-pr': c.pr + 'px', '--mp-co-pb': c.pb + 'px', '--mp-co-pl': c.pl + 'px',
      '--mp-co-tlh': c.titleLh + 'px', '--mp-co-tfs': c.titleFs, '--mp-co-tfw': c.titleFw,
      '--mp-co-t2b': c.titleToBody + 'px', '--mp-co-b2e': c.bodyToBottom + 'px', '--mp-co-r': c.radius,
      '--mp-co-iw': c.iconW + 'px', '--mp-co-ig': c.iconGap + 'px', '--mp-co-is': c.iconSize + 'px', '--mp-co-bw': c.bw + 'px',
    };
    this.varNames = Object.keys(vars);
    document.body.setCssProps(vars);
  }

  async recalibrate() {
    this.metrics = await this.calibrator.run();
    this.applyMetricVars();
    this.refreshEditors();
  }

  refreshEditors(rerenderPreview) {
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (!(leaf.view instanceof MarkdownView)) return;
      const cm = leaf.view.editor && leaf.view.editor.cm;
      if (cm && cm.dispatch) cm.dispatch({ effects: refreshEffect.of(null) });
      if (rerenderPreview && leaf.view.previewMode) leaf.view.previewMode.rerender(true);
    });
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.applyBodyClasses();
    this.refreshEditors(true);
  }

  async openCompare(file) {
    const ws = this.app.workspace;
    let left = ws.getMostRecentLeaf();
    if (!left || !(left.view instanceof MarkdownView)) left = ws.getLeaf(false);
    await left.openFile(file, { state: { mode: 'source', source: false } });
    const right = ws.createLeafBySplit(left, 'vertical');
    await right.openFile(file, { state: { mode: 'preview' } });
    // 두 창을 연결해 스크롤 위치를 같이 움직인다
    const group = 'mode-parity-' + Date.now();
    left.setGroup(group);
    right.setGroup(group);
    ws.setActiveLeaf(left, { focus: true });
  }

  measure() {
    const leaves = this.app.workspace.getLeavesOfType('markdown');
    const active = this.app.workspace.getActiveFile();
    const same = leaves.filter((l) => l.view.file && active && l.view.file.path === active.path);
    const lp = same.find((l) => l.view.getMode() === 'source');
    const rv = same.find((l) => l.view.getMode() === 'preview');
    if (!lp || !rv) { new Notice(tr('noticeNeedPanes')); return; }
    new MeasureModal(this.app, measurePanes(lp.view, rv.view)).open();
  }
}

class ModeParitySettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    const p = this.plugin;
    containerEl.empty();
    const toggle = (key, name, desc) => new Setting(containerEl).setName(name).setDesc(desc)
      .addToggle((t) => t.setValue(!!p.settings[key]).onChange(async (v) => { p.settings[key] = v; await p.saveSettings(); }));

    const heading = (key) => new Setting(containerEl).setName(tr(key)).setHeading();

    toggle('enabled', tr('sEnabled'), tr('dEnabled'));
    heading('hLayout');
    toggle('spacing', tr('sSpacing'), tr('dSpacing'));
    toggle('lists', tr('sLists'), tr('dLists'));
    toggle('quotes', tr('sQuotes'), tr('dQuotes'));
    toggle('codeBlocks', tr('sCode'), tr('dCode'));
    toggle('mathBlocks', tr('sMath'), tr('dMath'));
    toggle('centerImages', tr('sImages'), tr('dImages'));
    heading('hLive');
    toggle('liveCallouts', tr('sCallouts'), tr('dCallouts'));
    toggle('lenientCallouts', tr('sLenient'), tr('dLenient'));
    toggle('hangingHeadingMarks', tr('sHang'), tr('dHang'));

    heading('hCalibration');
    const M = p.metrics;
    new Setting(containerEl)
      .setName(tr('sMeasured'))
      .setDesc(tr('dMeasured', { state: tr(M.calibrated ? 'measured' : 'defaults'), pp: M.gap.p.p, ph2: M.gap.p.h2, code: M.code.lh, list: M.list.ulText }))
      .addButton((b) => b.setButtonText(tr('btnRemeasure')).onClick(async () => { await p.recalibrate(); this.display(); }));
  }
}

module.exports = ModeParityPlugin;
module.exports.default = ModeParityPlugin;
module.exports._internal = { classify, makePlan, defaultMetrics, eulerSequence, anchorText };
