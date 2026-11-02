(() => {
  "use strict";

  const DATA = window.KIRIN_DATA;
  const CODEX_TOTAL = Object.keys(DATA.codex).length;
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const statusNode = document.getElementById("sr-status");
  const loadingScreen = document.getElementById("loading-screen");
  const loadingFill = document.getElementById("loading-fill");
  const loadingCopy = document.getElementById("loading-copy");
  const W = 1280;
  const H = 720;
  const bootStartedAt = performance.now();
  const SAVE_KEY = "kirin-treads-snow-save-v1";
  const PAPER = "#f3ead9";
  const INK = "#111c20";
  const INK_SOFT = "#203137";
  const GOLD = "#d6b978";
  const GOLD_DARK = "#9d7b3f";
  const CINNABAR = "#ab4637";
  const JADE = "#7ea79a";
  const FONT_SANS = '"Microsoft YaHei", "Noto Sans SC", sans-serif';
  const FONT_SERIF = '"STKaiti", "KaiTi", "Songti SC", serif';
  const AI_DISCLOSURE = "AI 生成内容";
  const EMBEDDED_ASSET_DATA = window.KIRIN_EMBEDDED_ASSETS || {};
  const assetObjectUrls = new Map();

  let renderDpr = 1;

  function configureCanvasResolution() {
    renderDpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = Math.round(W * renderDpr);
    canvas.height = Math.round(H * renderDpr);
    ctx.setTransform(renderDpr, 0, 0, renderDpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
  }

  configureCanvasResolution();

  const assets = {};
  let hitTargets = [];
  let loadedCount = 0;
  let failedAssets = 0;
  let totalAssets = 0;
  let criticalSettled = 0;
  let splashCache = null;
  let lastFrame = performance.now();
  let lastSaveAt = null;

  const blankState = () => ({
    mode: "loading",
    time: 0,
    sceneId: "train",
    visited: [],
    flags: {},
    clues: [],
    achievements: [],
    codex: [],
    codexQueue: [],
    scores: { memory: 0, liu: 0, huang: 0, qiu: 0 },
    choices: [],
    finalComplete: false,
    hovered: null,
    hoverTarget: null,
    focusedHotspot: null,
    dialogue: null,
    overlay: null,
    overlayReturnMode: null,
    transition: null,
    sceneIntro: 0,
    toasts: [],
    pointer: { x: -1, y: -1 },
    muted: false,
    loadingProgress: 0,
  });

  let state = blankState();

  const allImagePaths = Array.from(
    new Set([
      ...Object.values(DATA.scenes).map((scene) => scene.bg),
      ...Object.values(DATA.people).filter((person) => person.portrait).map((person) => person.portrait),
      ...Object.values(DATA.codex).map((card) => card.image),
    ])
  );
  const criticalImagePaths = new Set([
    "assets/cg_qilin.jpg",
    "assets/scene_train.jpg",
    "assets/portrait_mentor.jpg",
    "assets/portrait_ajie.jpg",
  ]);

  function resolveAssetSource(path) {
    if (assetObjectUrls.has(path)) return assetObjectUrls.get(path);
    const encoded = EMBEDDED_ASSET_DATA[path];
    if (!encoded) return path;
    const mimeType = /\.(?:jpe?g)$/i.test(path) ? "image/jpeg" : "image/webp";
    try {
      const binary = window.atob(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      const source = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
      assetObjectUrls.set(path, source);
      return source;
    } catch (error) {
      return `data:${mimeType};base64,${encoded}`;
    }
  }

  function updateBootUi(progress, message) {
    if (loadingFill) loadingFill.style.width = `${Math.max(6, Math.round(progress * 100))}%`;
    if (message && loadingCopy) loadingCopy.textContent = message;
  }

  function preloadAssets() {
    totalAssets = allImagePaths.length;
    allImagePaths.forEach((path, index) => {
      const image = new Image();
      image.onload = () => {
        assets[path] = image;
        loadedCount += 1;
        if (criticalImagePaths.has(path)) criticalSettled += 1;
        state.loadingProgress = Math.min(1, criticalSettled / criticalImagePaths.size);
        if (criticalImagePaths.has(path)) {
          updateBootUi(
            state.loadingProgress,
            `正在加载首屏素材 ${criticalSettled} / ${criticalImagePaths.size}`
          );
        }
        if (criticalSettled === criticalImagePaths.size) {
          window.setTimeout(() => {
            state.mode = "title";
            updateBootUi(1, "准备就绪");
            loadingScreen?.classList.add("is-hidden");
            refreshTitleCache();
            updateStatus("游戏已就绪。按 Enter 或点击“启程”开始。");
          }, Math.max(160, 650 - (performance.now() - bootStartedAt)));
        }
      };
      image.onerror = () => {
        if (EMBEDDED_ASSET_DATA[path] && image.dataset.embeddedRetry !== "true") {
          image.dataset.embeddedRetry = "true";
          const mimeType = /\.(?:jpe?g)$/i.test(path) ? "image/jpeg" : "image/webp";
          image.src = `data:${mimeType};base64,${EMBEDDED_ASSET_DATA[path]}`;
          return;
        }
        failedAssets += 1;
        loadedCount += 1;
        if (criticalImagePaths.has(path)) criticalSettled += 1;
        state.loadingProgress = Math.min(1, criticalSettled / criticalImagePaths.size);
        if (criticalImagePaths.has(path)) {
          updateBootUi(
            state.loadingProgress,
            `正在加载首屏素材 ${criticalSettled} / ${criticalImagePaths.size}`
          );
        }
        if (criticalSettled === criticalImagePaths.size) {
          state.mode = "title";
          updateBootUi(1, "准备就绪");
          loadingScreen?.classList.add("is-hidden");
        }
      };
      if (criticalImagePaths.has(path)) {
        image.src = resolveAssetSource(path);
      } else {
        window.setTimeout(() => {
          image.src = resolveAssetSource(path);
        }, 900 + index * 60);
      }
    });
  }

  function updateStatus(text) {
    if (statusNode) statusNode.textContent = text;
  }

  function refreshTitleCache() {
    splashCache = null;
  }

  function currentScene() {
    return DATA.scenes[state.sceneId] || DATA.scenes.train;
  }

  function image(path) {
    return path ? assets[path] : null;
  }

  function font(size, family = FONT_SANS, weight = 400) {
    return `${weight} ${size}px ${family}`;
  }

  function roundRect(x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function fillRound(x, y, w, h, r, color) {
    roundRect(x, y, w, h, r);
    ctx.fillStyle = color;
    ctx.fill();
  }

  function strokeRound(x, y, w, h, r, color, lineWidth = 1) {
    roundRect(x, y, w, h, r);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }

  function drawCover(source, x, y, w, h) {
    if (!source) {
      const gradient = ctx.createLinearGradient(x, y, x, y + h);
      gradient.addColorStop(0, "#3f6868");
      gradient.addColorStop(1, "#172325");
      ctx.fillStyle = gradient;
      ctx.fillRect(x, y, w, h);
      return;
    }
    const scale = Math.max(w / source.width, h / source.height);
    const sw = w / scale;
    const sh = h / scale;
    const sx = (source.width - sw) / 2;
    const sy = (source.height - sh) / 2;
    ctx.drawImage(source, sx, sy, sw, sh, x, y, w, h);
  }

  function drawWrapped(text, x, y, maxWidth, lineHeight, color, maxLines = Infinity, align = "left") {
    ctx.fillStyle = color;
    ctx.textAlign = align;
    const chars = Array.from(String(text));
    const lines = [];
    let current = "";
    for (const char of chars) {
      const attempted = current + char;
      if (ctx.measureText(attempted).width > maxWidth && current) {
        const sticksToPrevious = /[，。！？；、：…）】》」』”’]/.test(char);
        if (sticksToPrevious) {
          lines.push(current + char);
          current = "";
        } else {
          lines.push(current);
          current = char;
        }
      } else {
        current = attempted;
      }
    }
    if (current) lines.push(current);
    const visible = lines.slice(0, maxLines);
    visible.forEach((line, index) => {
      let textLine = line;
      if (index === maxLines - 1 && lines.length > maxLines) {
        while (ctx.measureText(`${textLine}…`).width > maxWidth && textLine.length > 1) {
          textLine = textLine.slice(0, -1);
        }
        textLine += "…";
      }
      ctx.fillText(textLine, x, y + index * lineHeight);
    });
    return visible.length;
  }

  function verticalText(text, x, y, size, gap, color, align = "center") {
    ctx.fillStyle = color;
    ctx.font = font(size, FONT_SERIF, 700);
    ctx.textAlign = align;
    Array.from(text).forEach((char, index) => {
      ctx.fillText(char, x, y + index * gap);
    });
  }

  function isHovered(id) {
    return state.hoverTarget === id;
  }

  function addHit(id, x, y, w, h, onClick, cursor = "pointer") {
    hitTargets.push({ id, x, y, w, h, onClick, cursor });
  }

  function pointInRect(px, py, target) {
    return px >= target.x && px <= target.x + target.w && py >= target.y && py <= target.y + target.h;
  }

  function screenPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * W,
      y: ((event.clientY - rect.top) / rect.height) * H,
    };
  }

  function hotspotRect(hotspot) {
    return {
      x: hotspot.x - hotspot.w / 2,
      y: hotspot.y - hotspot.h / 2,
      w: hotspot.w,
      h: hotspot.h,
    };
  }

  function hasFlags(required = []) {
    return required.every((flag) => Boolean(state.flags[flag]));
  }

  function hotspotVisible(hotspot) {
    if (hotspot.hideWhen && hasFlags(hotspot.hideWhen)) return false;
    return true;
  }

  function hotspotEnabled(hotspot) {
    return !hotspot.requires || hasFlags(hotspot.requires);
  }

  function getHotspots() {
    return currentScene().hotspots.filter(hotspotVisible);
  }

  function pingHovered() {
    if (state.hovered) playTone("soft");
  }

  function vibrate(pattern = 12) {
    if (navigator.vibrate) navigator.vibrate(pattern);
  }

  class AmbientAudio {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.drone = null;
      this.timer = null;
      this.step = 0;
    }

    ensure() {
      if (this.ctx) return;
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.createDrone();
      this.startLoop();
    }

    createDrone() {
      const gain = this.ctx.createGain();
      gain.gain.value = state.muted ? 0 : 0.018;
      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 360;
      const oscA = this.ctx.createOscillator();
      const oscB = this.ctx.createOscillator();
      oscA.type = "sine";
      oscB.type = "triangle";
      oscA.frequency.value = 73.42;
      oscB.frequency.value = 110;
      oscA.connect(filter);
      oscB.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      oscA.start();
      oscB.start();
      this.drone = gain;
    }

    startLoop() {
      if (this.timer) return;
      const notes = [220, 261.63, 293.66, 329.63, 392, 440, 523.25];
      this.timer = window.setInterval(() => {
        if (state.muted || !this.ctx || this.ctx.state !== "running") return;
        this.step += 1;
        const note = notes[(this.step * 3 + Math.floor(this.step / 3)) % notes.length];
        this.pluck(note, 0.035, 2.8);
        if (this.step % 5 === 0) this.pluck(note / 2, 0.018, 4.2);
      }, 2350);
    }

    pluck(frequency, volume = 0.03, duration = 2.5) {
      if (!this.ctx || state.muted) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(frequency, now);
      osc.frequency.exponentialRampToValueAtTime(frequency * 0.996, now + duration);
      filter.type = "lowpass";
      filter.frequency.value = 1800;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(volume, now + 0.035);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      osc.start(now);
      osc.stop(now + duration + 0.1);
    }

    async start() {
      this.ensure();
      if (this.ctx && this.ctx.state === "suspended") await this.ctx.resume();
    }

    setMuted(muted) {
      if (this.drone && this.ctx) {
        this.drone.gain.setTargetAtTime(muted ? 0 : 0.018, this.ctx.currentTime, 0.08);
      }
    }
  }

  const audio = new AmbientAudio();

  function playTone(type = "tap") {
    if (state.muted) return;
    audio.start().then(() => {
      const config = {
        tap: [440, 0.026, 0.5],
        soft: [330, 0.012, 0.32],
        clue: [659.25, 0.03, 1.3],
        achievement: [523.25, 0.036, 1.8],
      }[type] || [440, 0.02, 0.5];
      audio.pluck(...config);
      if (type === "achievement") window.setTimeout(() => audio.pluck(783.99, 0.024, 1.6), 140);
    });
  }

  function toast(text, options = {}) {
    state.toasts.push({
      text,
      kicker: options.kicker || "记录",
      tone: options.tone || "gold",
      icon: options.icon || "笺",
      remaining: options.remaining || 3.8,
      life: options.remaining || 3.8,
    });
    if (state.toasts.length > 3) state.toasts.shift();
  }

  function unlockClue(personId) {
    if (state.clues.includes(personId)) return false;
    state.clues.push(personId);
    const person = DATA.people[personId];
    toast(`${person.name} · ${person.role}`, {
      kicker: "人物线索",
      icon: person.clueNo || "人",
      tone: "jade",
      remaining: 4.4,
    });
    playTone("clue");
    autosave();
    return true;
  }

  function unlockAchievement(achievementId) {
    if (state.achievements.includes(achievementId)) return false;
    state.achievements.push(achievementId);
    const item = DATA.achievements[achievementId];
    toast(`成就解锁 · ${item.title}`, {
      kicker: item.chapter,
      icon: "印",
      tone: "gold",
      remaining: 5,
    });
    playTone("achievement");
    autosave();
    return true;
  }

  function unlockCodex(cardId) {
    if (state.codex.includes(cardId)) return false;
    state.codex.push(cardId);
    queueCodexPopup(cardId);
    const card = DATA.codex[cardId];
    toast(`科普图谱 · ${card.title}`, {
      kicker: `残页 ${card.no}`,
      icon: "图",
      tone: "jade",
      remaining: 4.2,
    });
    playTone("clue");
    autosave();
    return true;
  }

  function queueCodexPopup(cardId) {
    if (!DATA.codex[cardId] || state.codexQueue.includes(cardId)) return;
    state.codexQueue.push(cardId);
  }

  function showNextCodexPopup() {
    if (
      !state.codexQueue.length ||
      state.dialogue ||
      state.transition ||
      state.mode === "title" ||
      state.mode === "loading" ||
      (state.mode === "overlay" && state.overlay?.type !== "codex")
    ) {
      return false;
    }
    openCodex(state.codexQueue.shift());
    return true;
  }

  function getObjective() {
    if (state.sceneId === "train") {
      if (state.flags.call && state.flags.window) return "到站下车，去陈婶家取钥匙。";
      return currentScene().objective;
    }
    if (state.sceneId === "chen") {
      if (state.flags.box) return "带着旧纸箱，去祠堂后的老屋。";
      if (state.flags.chenTalk) return "收下陈婶保管的旧纸箱。";
    }
    if (state.sceneId === "oldHouse") {
      if (state.flags.openedBox) return "循着鼓声，回到十年前。";
    }
    if (state.sceneId === "memory") {
      if (state.flags.memoryDone) return "让鼓声带你回到祠堂后天井。";
    }
    if (state.sceneId === "courtyard") {
      if (state.flags.liuDone) return "带着记录，去非遗分馆。";
    }
    if (state.sceneId === "office") {
      if (state.flags.huangDone) return "去老街工作室，找小满。";
    }
    if (state.sceneId === "studio") {
      if (state.flags.qiuDone) return "该返程了。";
    }
    if (state.sceneId === "ending" && state.finalComplete) return "旅程仍在继续。";
    return currentScene().objective;
  }

  function createSave() {
    return {
      version: 1,
      sceneId: state.sceneId,
      visited: [...state.visited],
      flags: { ...state.flags },
      clues: [...state.clues],
      achievements: [...state.achievements],
      codex: [...state.codex],
      codexQueue: [...state.codexQueue],
      scores: { ...state.scores },
      choices: [...state.choices],
      finalComplete: state.finalComplete,
      savedAt: new Date().toISOString(),
      summary: {
        clues: state.clues.length,
        achievements: state.achievements.length,
        codex: state.codex.length,
      },
    };
  }

  function saveGame(showFeedback = false) {
    try {
      const save = createSave();
      localStorage.setItem(SAVE_KEY, JSON.stringify(save));
      lastSaveAt = new Date(save.savedAt);
      if (showFeedback) {
        toast("旅程已经收进存档。", { kicker: "存档成功", icon: "存", tone: "jade" });
        playTone("tap");
      }
      return true;
    } catch (error) {
      if (showFeedback) toast("浏览器阻止了本地存档。", { kicker: "存档失败", icon: "!", tone: "red" });
      return false;
    }
  }

  function autosave() {
    if (state.mode === "title" || state.mode === "loading") return;
    saveGame(false);
  }

  function readSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function startNewGame() {
    const muted = state.muted;
    state = blankState();
    state.mode = "play";
    state.muted = muted;
    state.sceneId = "train";
    state.visited = ["train"];
    state.time = performance.now() / 1000;
    state.sceneIntro = 2.5;
    audio.start();
    state.toasts.push({
      text: "移动鼠标靠近场景要素，按 E 或点击开始互动。",
      kicker: "启程",
      tone: "gold",
      icon: "启",
      remaining: 5,
      life: 5,
    });
    saveGame(false);
    updateStatus("序章开始。接起导师电话，再望向窗外。");
  }

  function continueGame() {
    const save = readSave();
    if (!save) {
      startNewGame();
      return;
    }
    const muted = state.muted;
    state = blankState();
    state.mode = "play";
    state.muted = muted;
    state.sceneId = DATA.scenes[save.sceneId] ? save.sceneId : "train";
    state.visited = Array.isArray(save.visited) ? save.visited : [state.sceneId];
    state.flags = save.flags || {};
    state.clues = Array.isArray(save.clues) ? save.clues.filter((id) => DATA.people[id]) : [];
    state.achievements = Array.isArray(save.achievements)
      ? save.achievements.filter((id) => DATA.achievements[id])
      : [];
    state.codex = Array.isArray(save.codex) ? save.codex.filter((id) => DATA.codex[id]) : [];
    state.codexQueue = Array.isArray(save.codexQueue)
      ? save.codexQueue.filter((id) => DATA.codex[id] && !state.codex.includes(id))
      : [];
    state.scores = { ...blankState().scores, ...(save.scores || {}) };
    state.choices = Array.isArray(save.choices) ? save.choices : [];
    state.finalComplete = Boolean(save.finalComplete);
    state.sceneIntro = 2.2;
    audio.start();
    toast("已从上一次停留的场景继续。", { kicker: "续游", icon: "续", tone: "jade" });
    updateStatus(`继续游戏，当前场景：${currentScene().title}。`);
    showNextCodexPopup();
  }

  function changeScene(targetId, instant = false) {
    if (!DATA.scenes[targetId]) return;
    state.hovered = null;
    state.focusedHotspot = null;
    state.dialogue = null;
    state.overlay = null;
    if (instant) {
      state.sceneId = targetId;
      if (!state.visited.includes(targetId)) state.visited.push(targetId);
      state.sceneIntro = 2.2;
      autosave();
      return;
    }
    state.transition = {
      target: targetId,
      elapsed: 0,
      duration: 1000,
      swapped: false,
    };
    playTone("soft");
  }

  function update(delta) {
    state.time += delta;
    if (state.sceneIntro > 0) state.sceneIntro = Math.max(0, state.sceneIntro - delta);
    if (state.transition) {
      state.transition.elapsed += delta * 1000;
      if (!state.transition.swapped && state.transition.elapsed >= state.transition.duration / 2) {
        state.sceneId = state.transition.target;
        if (!state.visited.includes(state.sceneId)) state.visited.push(state.sceneId);
        state.transition.swapped = true;
        state.sceneIntro = 2.1;
        autosave();
      }
      if (state.transition.elapsed >= state.transition.duration) {
        state.transition = null;
        showNextCodexPopup();
      }
    }

    if (state.dialogue) {
      const node = currentDialogueNode();
      if (node && node.type === "line") {
        const total = Array.from(node.text).length;
        state.dialogue.typeChars = Math.min(total, state.dialogue.typeChars + delta * 48);
      }
    }

    state.toasts.forEach((item) => {
      item.remaining -= delta;
    });
    state.toasts = state.toasts.filter((item) => item.remaining > 0);
  }

  function splitLongText(text, maxChars = 96) {
    const chars = Array.from(text);
    if (chars.length <= maxChars) return [text];
    const chunks = [];
    let rest = chars;
    while (rest.length > maxChars) {
      const windowText = rest.slice(0, maxChars + 12).join("");
      let cut = -1;
      const punctuation = ["。", "！", "？", "；", "…", "，", "、"];
      punctuation.forEach((mark) => {
        const index = windowText.lastIndexOf(mark);
        if (index >= Math.floor(maxChars * 0.55)) cut = Math.max(cut, index + 1);
      });
      if (cut < 1) cut = maxChars;
      while (cut < rest.length && /[”’」』】）]/.test(rest[cut])) cut += 1;
      chunks.push(rest.slice(0, cut).join("").trim());
      rest = rest.slice(cut);
      while (rest.length && /[，。！？；、\s]/.test(rest[0])) rest = rest.slice(1);
    }
    if (rest.length) chunks.push(rest.join("").trim());
    return chunks.filter(Boolean);
  }

  function paginateNodes(nodes) {
    return nodes.flatMap((node) => {
      if (node.type !== "line") return [node];
      const pages = splitLongText(node.text);
      return pages.map((text) => ({ ...node, text }));
    });
  }

  function startDialogue(actionId, nodes, options = {}) {
    if (!nodes || !nodes.length) return;
    state.overlay = null;
    state.hovered = null;
    state.focusedHotspot = null;
    state.mode = "dialogue";
    state.dialogue = {
      actionId,
      nodes: paginateNodes(nodes),
      index: 0,
      typeChars: 0,
      scoreKey: options.scoreKey || null,
      onDone: options.onDone || null,
      title: options.title || null,
    };
    if (state.dialogue.nodes[0].type === "choice") state.dialogue.typeChars = 9999;
    updateStatus(
      state.dialogue.nodes[0].narration
        ? state.dialogue.nodes[0].text
        : `${DATA.people[state.dialogue.nodes[0].who]?.name || "旁白"}：${state.dialogue.nodes[0].text}`
    );
  }

  function currentDialogueNode() {
    if (!state.dialogue) return null;
    return state.dialogue.nodes[state.dialogue.index] || null;
  }

  function dialogueTextComplete() {
    const node = currentDialogueNode();
    if (!node) return true;
    if (node.type === "choice") return true;
    return state.dialogue.typeChars >= Array.from(node.text).length;
  }

  function advanceDialogue() {
    if (!state.dialogue || state.transition) return;
    const node = currentDialogueNode();
    if (!node) {
      finishDialogue();
      return;
    }
    if (node.type === "choice") return;
    if (!dialogueTextComplete()) {
      state.dialogue.typeChars = Array.from(node.text).length;
      return;
    }
    playTone("soft");
    if (state.dialogue.index >= state.dialogue.nodes.length - 1) {
      finishDialogue();
      return;
    }
    state.dialogue.index += 1;
    state.dialogue.typeChars = 0;
    const next = currentDialogueNode();
    if (next?.type === "choice") state.dialogue.typeChars = 9999;
    if (next) {
      updateStatus(
        next.type === "choice"
          ? next.prompt
          : next.narration
            ? next.text
            : `${DATA.people[next.who]?.name || "旁白"}：${next.text}`
      );
    }
  }

  function selectDialogueChoice(optionIndex) {
    if (!state.dialogue) return;
    const node = currentDialogueNode();
    if (!node || node.type !== "choice") return;
    const option = node.options[optionIndex];
    if (!option) return;
    const score = Number(option.score || 0);
    if (score && state.dialogue.scoreKey) {
      state.scores[state.dialogue.scoreKey] = (state.scores[state.dialogue.scoreKey] || 0) + score;
    }
    state.choices.push({
      scene: state.sceneId,
      action: state.dialogue.actionId,
      choice: option.key,
      text: option.text,
      score,
    });
    playTone("tap");
    vibrate(10);
    const remaining = state.dialogue.nodes.slice(state.dialogue.index + 1);
    const branch = (option.reply || []).map((item) => ({ ...item }));
    state.dialogue.nodes = [...paginateNodes(branch), ...remaining];
    state.dialogue.index = 0;
    state.dialogue.typeChars = 0;
    if (state.dialogue.nodes[0]?.type === "choice") state.dialogue.typeChars = 9999;
    if (state.dialogue.nodes[0]) {
      updateStatus(
        state.dialogue.nodes[0].narration
          ? state.dialogue.nodes[0].text
          : `${DATA.people[state.dialogue.nodes[0].who]?.name || "旁白"}：${state.dialogue.nodes[0].text}`
      );
    }
  }

  function finishDialogue() {
    if (!state.dialogue) return;
    const dialogue = state.dialogue;
    state.dialogue = null;
    state.mode = "play";
    if (dialogue.onDone) dialogue.onDone();
    autosave();
    showNextCodexPopup();
  }

  function openCodex(cardId) {
    if (!DATA.codex[cardId]) return;
    const returnMode =
      state.mode === "overlay" && state.overlayReturnMode ? state.overlayReturnMode : state.mode;
    state.mode = "overlay";
    state.overlayReturnMode = returnMode === "title" ? "title" : "play";
    state.overlay = { type: "codex", id: cardId };
    playTone("clue");
    updateStatus(`科普图谱：${DATA.codex[cardId].title}`);
  }

  function openOverlay(type, extra = {}) {
    const returnMode =
      state.mode === "overlay" && state.overlayReturnMode ? state.overlayReturnMode : state.mode;
    state.mode = "overlay";
    state.overlayReturnMode = returnMode;
    state.overlay = { type, openedAt: state.time, ...extra };
    playTone("tap");
    if (type === "clues") updateStatus(`线索面板已打开，收集${state.clues.length}位人物。`);
  }

  function closeOverlay() {
    state.overlay = null;
    state.mode = state.overlayReturnMode === "title" ? "title" : "play";
    state.overlayReturnMode = null;
    playTone("soft");
    showNextCodexPopup();
  }

  function getEndingData() {
    const advanced = ["chuancheng", "xieshou", "fayang"].filter((id) => state.achievements.includes(id));
    const key = advanced.join(",");
    return DATA.endings[key] || DATA.endings[""];
  }

  function chunkReaderParagraphs(paragraphs, maxChars = 250) {
    const units = paragraphs.flatMap((paragraph) => splitLongText(paragraph, 175));
    const chunks = [];
    let current = [];
    let count = 0;
    units.forEach((unit) => {
      if (current.length && count + unit.length > maxChars) {
        chunks.push(current);
        current = [];
        count = 0;
      }
      current.push(unit);
      count += unit.length;
    });
    if (current.length) chunks.push(current);
    return chunks.length ? chunks : [[""]];
  }

  function buildEndingReaderPages(ending) {
    return chunkReaderParagraphs(ending.paragraphs).map((paragraphs, index) => ({
      title: index === 0 ? ending.title : `${ending.title}（续）`,
      paragraphs,
    }));
  }

  function buildFinalIntroPages() {
    const chapter = DATA.finalChapter;
    const pages = chunkReaderParagraphs(chapter.intro).map((paragraphs) => ({
      title: chapter.title,
      section: "序",
      paragraphs,
    }));
    chapter.sections.forEach((section) => {
      chunkReaderParagraphs(section.paragraphs).forEach((paragraphs, index) => {
        pages.push({
          title: `${section.title}${index ? "（续）" : ""}`,
          section: section.title,
          paragraphs,
        });
      });
    });
    return pages;
  }

  function showReader(type, pages, extra = {}) {
    state.mode = "overlay";
    state.overlayReturnMode = "play";
    state.overlay = {
      type,
      page: 0,
      pages,
      openedAt: state.time,
      ...extra,
    };
    playTone("tap");
    updateStatus(`${extra.label || "阅读"}：第 1 / ${pages.length} 页。`);
  }

  function openEndingReader() {
    const ending = getEndingData();
    const advanced = ["chuancheng", "xieshou", "fayang"].filter((id) => state.achievements.includes(id));
    const key = advanced.join(",");
    showReader("endingReader", buildEndingReaderPages(ending), {
      label: ending.label,
      title: ending.title,
      endingKey: key,
    });
  }

  function openFinalIntroReader() {
    showReader("finalIntro", buildFinalIntroPages(), {
      label: DATA.finalChapter.label,
      title: DATA.finalChapter.title,
    });
  }

  function advanceReader() {
    if (!state.overlay || !["endingReader", "finalIntro"].includes(state.overlay.type)) return;
    const lastPage = state.overlay.pages.length - 1;
    if (state.overlay.page < lastPage) {
      state.overlay.page += 1;
      playTone("soft");
      updateStatus(
        `${state.overlay.label || "阅读"}：第 ${state.overlay.page + 1} / ${state.overlay.pages.length} 页。`
      );
      return;
    }
    if (state.overlay.type === "endingReader") {
      openFinalIntroReader();
    } else {
      openOverlay("finale");
    }
  }

  function previousReader() {
    if (!state.overlay || !["endingReader", "finalIntro"].includes(state.overlay.type)) return;
    if (state.overlay.page > 0) {
      state.overlay.page -= 1;
      playTone("soft");
      updateStatus(
        `${state.overlay.label || "阅读"}：第 ${state.overlay.page + 1} / ${state.overlay.pages.length} 页。`
      );
    }
  }

  function skipReaderStage() {
    if (!state.overlay) return;
    if (state.overlay.type === "endingReader") {
      openFinalIntroReader();
    } else if (state.overlay.type === "finalIntro") {
      openOverlay("finale");
    }
  }

  function repeatPersonDialogue(personId, text) {
    startDialogue(`repeat-${personId}`, [{ type: "line", who: personId, text }]);
  }

  function triggerHotspot(hotspot) {
    if (!hotspot || state.dialogue || state.overlay || state.transition) return;
    if (!hotspotEnabled(hotspot)) {
      toast(hotspot.lockedLabel || "现在还不适合去那里。", {
        kicker: "尚未解锁",
        icon: "锁",
        tone: "red",
      });
      playTone("soft");
      return;
    }
    playTone("tap");
    vibrate(8);
    handleAction(hotspot.action);
  }

  function handleAction(actionId) {
    switch (actionId) {
      case "phoneCall":
        startDialogue("phoneCall", DATA.dialogues.phoneCall, {
          onDone: () => {
            state.flags.call = true;
            toast("选题确定：家乡非遗口述史。", { kicker: "归乡列车", icon: "题", tone: "jade" });
          },
        });
        break;
      case "windowLook":
        startDialogue("windowLook", DATA.dialogues.windowLook, {
          onDone: () => {
            state.flags.window = true;
          },
        });
        break;
      case "arriveVillage":
        startDialogue("arriveVillage", DATA.dialogues.arriveVillage, {
          onDone: () => changeScene("chen"),
        });
        break;
      case "chenTalk":
        if (state.flags.chenTalk) {
          repeatPersonDialogue("chen", "箱子我没拆过，里面的东西应该还在。路上慢些走。");
        } else {
          startDialogue("chenTalk", DATA.dialogues.chenTalk, {
            onDone: () => {
              state.flags.chenTalk = true;
            },
          });
        }
        break;
      case "takeBox":
        startDialogue("takeBox", DATA.dialogues.takeBox, {
          onDone: () => {
            state.flags.box = true;
            autosave();
          },
        });
        break;
      case "toOldHouse":
        changeScene("oldHouse");
        break;
      case "openBox":
        startDialogue("openBox", DATA.dialogues.openBox, {
          onDone: () => {
            state.flags.openedBox = true;
            unlockCodex("white");
          },
        });
        break;
      case "toMemory":
        changeScene("memory");
        break;
      case "memoryTalk":
        if (state.flags.memoryDone) {
          startDialogue("memory-repeat", [
            {
              type: "line",
              who: "grandpa",
              text: "看了一辈子，早看会了。看看也一样。",
            },
          ]);
        } else {
          startDialogue("memoryTalk", DATA.dialogues.memoryTalk, {
            scoreKey: "memory",
            onDone: () => {
              state.flags.memoryDone = true;
              unlockClue("grandpa");
              unlockAchievement("chuxin");
              unlockCodex("suite");
            },
          });
        }
        break;
      case "collectYoungMemory":
        startDialogue("youngMemory", DATA.dialogues.collectYoungMemory);
        break;
      case "toCourtyard":
        changeScene("courtyard");
        break;
      case "liuTalk":
        if (state.flags.liuDone) {
          repeatPersonDialogue(
            "liu",
            "竹篾不能急。你下次回来，我再给你留一根好的。你爷爷那只头，也记得带回来给我看看。"
          );
        } else {
          startDialogue("liuTalk", DATA.dialogues.liuTalk, {
            scoreKey: "liu",
            onDone: () => {
              state.flags.liuDone = true;
              unlockClue("liu");
              unlockCodex("suite");
              unlockCodex("craft");
              unlockCodex("team");
              unlockCodex("learning");
              if (state.scores.liu >= 5) {
                unlockAchievement("chuancheng");
              } else {
                toast(`本章 ${state.scores.liu}/9：你记下了手艺，还可以再靠近一点。`, {
                  kicker: "刘伯的天井",
                  icon: "记",
                  tone: "jade",
                  remaining: 4.6,
                });
              }
            },
          });
        }
        break;
      case "ahuiTalk":
        if (state.flags.ahuiDone) {
          repeatPersonDialogue("ahui", "我明天先拍削篾。天亮光好，刀口和竹青都能看清。");
        } else {
          startDialogue("ahuiTalk", DATA.dialogues.ahuiTalk, {
            onDone: () => {
              state.flags.ahuiDone = true;
              unlockClue("ahui");
              unlockCodex("reality");
            },
          });
        }
        break;
      case "inspectQilinHeads":
        startDialogue("inspectHeads", DATA.dialogues.inspectQilinHeads, {
          onDone: () => {
            unlockCodex("craft");
            unlockCodex("qingxi");
          },
        });
        break;
      case "toOffice":
        changeScene("office");
        break;
      case "huangTalk":
        if (state.flags.huangDone) {
          repeatPersonDialogue(
            "huang",
            "材料你可以带回学校。纪录片、口述史、动作记录都能成为课程的入口，关键是下一次还有没有人接。"
          );
        } else {
          startDialogue("huangTalk", DATA.dialogues.huangTalk, {
            scoreKey: "huang",
            onDone: () => {
              state.flags.huangDone = true;
              unlockClue("huang");
              unlockCodex("policy");
              unlockCodex("innovation");
              unlockCodex("community");
              if (state.scores.huang >= 6) {
                unlockAchievement("xieshou");
              } else {
                toast(`本章 ${state.scores.huang}/9：合作的门已经看见，还缺一个具体接口。`, {
                  kicker: "非遗分馆",
                  icon: "记",
                  tone: "jade",
                  remaining: 4.6,
                });
              }
            },
          });
        }
        break;
      case "readFiles":
        startDialogue("readFiles", DATA.dialogues.readFiles, {
          onDone: () => {
            unlockCodex("policy");
            unlockCodex("archive");
            unlockCodex("activation");
          },
        });
        break;
      case "toStudio":
        changeScene("studio");
        break;
      case "qiuTalk":
        if (state.flags.qiuDone) {
          repeatPersonDialogue(
            "qiu",
            "明天拍阿辉糊纸。记得先别急着找漂亮镜头，完整比漂亮更重要。"
          );
        } else {
          startDialogue("qiuTalk", DATA.dialogues.qiuTalk, {
            scoreKey: "qiu",
            onDone: () => {
              state.flags.qiuDone = true;
              unlockClue("qiu");
              unlockCodex("video");
              unlockCodex("digital");
              if (state.scores.qiu >= 6) {
                unlockAchievement("fayang");
              } else {
                toast(`本章 ${state.scores.qiu}/9：你已经看见镜头，还差一个真正开始的理由。`, {
                  kicker: "小满工作室",
                  icon: "记",
                  tone: "jade",
                  remaining: 4.6,
                });
              }
            },
          });
        }
        break;
      case "inspectStoryboard":
        startDialogue("storyboard", DATA.dialogues.inspectStoryboard, {
          onDone: () => {
            unlockCodex("video");
          },
        });
        break;
      case "toEnding":
        changeScene("ending");
        break;
      case "endingReflection":
        if (state.finalComplete) {
          openEndingReader();
        } else {
          startDialogue("endingReflection", DATA.dialogues.endingReflection, {
            onDone: () => {
              state.finalComplete = true;
              unlockCodex("reality");
              openEndingReader();
              updateStatus("尾声结束。正在阅读根据你的选择生成的结局。");
            },
          });
        }
        break;
      case "endingLetter":
        startDialogue("endingLetter", DATA.dialogues.endingLetter);
        break;
      default:
        break;
    }
  }

  function handleTarget(target, event) {
    if (!target) return false;
    if (target.onClick) target.onClick(event);
    return true;
  }

  function findTargetAt(x, y) {
    const matching = [];
    for (let index = hitTargets.length - 1; index >= 0; index -= 1) {
      if (pointInRect(x, y, hitTargets[index])) matching.push(hitTargets[index]);
    }
    const hotspotMatches = matching.filter((target) => target.id.startsWith("hotspot:"));
    if (hotspotMatches.length) {
      return hotspotMatches.sort((a, b) => a.w * a.h - b.w * b.h)[0];
    }
    if (matching.length) return matching[0];
    return null;
  }

  function cycleHotspots(direction = 1) {
    const available = getHotspots().filter(hotspotEnabled);
    if (!available.length) return;
    const currentIndex = available.findIndex((item) => item.id === state.focusedHotspot);
    const nextIndex =
      currentIndex < 0
        ? 0
        : (currentIndex + direction + available.length) % available.length;
    state.focusedHotspot = available[nextIndex].id;
    state.hovered = state.focusedHotspot;
    state.hoverTarget = `hotspot:${state.focusedHotspot}`;
    playTone("soft");
    updateStatus(`已选中：${available[nextIndex].label}。按 E 互动。`);
  }

  function activateFocusedHotspot() {
    const id = state.hovered || state.focusedHotspot;
    if (!id) {
      toast("先移动鼠标靠近一个场景要素，或按 Tab 选择。", {
        kicker: "操作提示",
        icon: "指",
        tone: "jade",
      });
      return;
    }
    const hotspot = getHotspots().find((item) => item.id === id);
    triggerHotspot(hotspot);
  }

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (error) {
      toast("当前浏览器没有开放全屏权限。", { kicker: "全屏", icon: "!", tone: "red" });
    }
  }

  function toggleMute() {
    state.muted = !state.muted;
    audio.setMuted(state.muted);
    if (!state.muted) audio.start();
    toast(state.muted ? "环境音乐已关闭。" : "环境音乐已打开。", {
      kicker: "声音",
      icon: state.muted ? "静" : "乐",
      tone: "jade",
    });
  }

  canvas.addEventListener("pointermove", (event) => {
    const point = screenPoint(event);
    state.pointer = point;
    const target = findTargetAt(point.x, point.y);
    state.hoverTarget = target?.id || null;
    canvas.style.cursor = target?.cursor || "default";
    if (!target || !target.id.startsWith("hotspot:")) {
      if (state.mode !== "title") state.hovered = null;
      return;
    }
    const hotspotId = target.id.replace("hotspot:", "");
    if (state.hovered !== hotspotId) {
      state.hovered = hotspotId;
      state.focusedHotspot = hotspotId;
      pingHovered();
    }
  });

  canvas.addEventListener("pointerleave", () => {
    state.pointer = { x: -1, y: -1 };
    state.hoverTarget = null;
    state.hovered = null;
    canvas.style.cursor = "default";
  });

  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    canvas.focus();
    audio.start();
    const point = screenPoint(event);
    const target = findTargetAt(point.x, point.y);
    if (handleTarget(target, event)) return;
    if (state.mode === "dialogue" && !state.dialogue) return;
    if (state.dialogue && currentDialogueNode()?.type === "line") advanceDialogue();
  });

  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (key === "f") {
      event.preventDefault();
      toggleFullscreen();
      return;
    }
    if (key === "m") {
      event.preventDefault();
      toggleMute();
      return;
    }

    if (state.mode === "title") {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const save = readSave();
        if (save) continueGame();
        else startNewGame();
      }
      if (key === "h") openOverlay("help");
      if (key === "i") openOverlay("aiDisclosure");
      return;
    }

    if (state.mode === "overlay") {
      if (["endingReader", "finalIntro"].includes(state.overlay?.type)) {
        if (["ArrowRight", "ArrowDown", "Enter", " ", "e"].includes(key === " " ? " " : event.key)) {
          event.preventDefault();
          advanceReader();
          return;
        }
        if (["ArrowLeft", "ArrowUp"].includes(event.key)) {
          event.preventDefault();
          previousReader();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          skipReaderStage();
          return;
        }
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeOverlay();
      }
      return;
    }

    if (state.mode === "dialogue") {
      const node = currentDialogueNode();
      if (node?.type === "choice") {
        const numericIndex = ["1", "2", "3"].indexOf(event.key);
        const letterIndex = ["a", "b", "c"].indexOf(key);
        const choiceIndex = numericIndex >= 0 ? numericIndex : letterIndex;
        if (choiceIndex >= 0) {
          event.preventDefault();
          selectDialogueChoice(choiceIndex);
          return;
        }
      }
      if (["Enter", " ", "e"].includes(key)) {
        event.preventDefault();
        advanceDialogue();
        return;
      }
    }

    if (state.mode !== "play" || state.transition) return;
    if (key === "tab") {
      event.preventDefault();
      cycleHotspots(event.shiftKey ? -1 : 1);
    } else if (key === "e") {
      event.preventDefault();
      activateFocusedHotspot();
    } else if (key === "l") {
      event.preventDefault();
      openOverlay("clues");
    } else if (key === "a") {
      event.preventDefault();
      openOverlay("achievements");
    } else if (key === "s") {
      event.preventDefault();
      openOverlay("save");
    } else if (event.key === "Escape") {
      event.preventDefault();
      state.hovered = null;
      state.focusedHotspot = null;
    }
  });

  window.addEventListener("fullscreenchange", () => {
    canvas.focus();
  });

  window.addEventListener("blur", () => {
    state.hovered = null;
    state.hoverTarget = null;
  });

  function drawPaperTexture(alpha = 0.035) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = PAPER;
    for (let index = 0; index < 90; index += 1) {
      const x = (index * 149 + 41) % W;
      const y = (index * 83 + 29) % H;
      ctx.fillRect(x, y, index % 3 === 0 ? 2 : 1, 1);
    }
    ctx.restore();
  }

  function drawVignette(strength = 0.6) {
    const gradient = ctx.createRadialGradient(W / 2, H * 0.44, H * 0.2, W / 2, H * 0.45, H * 0.78);
    gradient.addColorStop(0, "rgba(2,8,9,0)");
    gradient.addColorStop(0.68, `rgba(2,8,9,${strength * 0.22})`);
    gradient.addColorStop(1, `rgba(2,8,9,${strength})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);
  }

  function drawAmbientMotes() {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (let index = 0; index < 22; index += 1) {
      const baseX = (index * 157 + 63) % W;
      const drift = Math.sin(state.time * 0.15 + index * 1.7) * 20;
      const y = (H + 60 - ((state.time * (7 + (index % 5)) + index * 91) % (H + 80))) % (H + 80);
      const alpha = 0.08 + (Math.sin(state.time * 0.9 + index) + 1) * 0.04;
      ctx.fillStyle = `rgba(239,220,177,${alpha})`;
      ctx.beginPath();
      ctx.arc(baseX + drift, y, index % 3 === 0 ? 2 : 1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawScreenFrame() {
    ctx.save();
    ctx.strokeStyle = "rgba(238,220,181,0.22)";
    ctx.lineWidth = 1;
    ctx.strokeRect(24, 22, W - 48, H - 44);
    ctx.strokeStyle = "rgba(8,15,17,0.45)";
    ctx.lineWidth = 5;
    ctx.strokeRect(5, 5, W - 10, H - 10);
    ctx.fillStyle = CINNABAR;
    const corners = [
      [24, 22, 1, 1],
      [W - 24, 22, -1, 1],
      [24, H - 22, 1, -1],
      [W - 24, H - 22, -1, -1],
    ];
    corners.forEach(([x, y, dx, dy]) => {
      ctx.fillRect(x, y, dx * 28, 2);
      ctx.fillRect(x, y, 2, dy * 28);
    });
    ctx.restore();
  }

  function drawAiGeneratedWatermark() {
    if (state.mode === "title" || state.mode === "overlay") return;

    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.shadowColor = "rgba(0,0,0,0.28)";
    ctx.shadowBlur = 3;
    ctx.fillStyle = PAPER;
    ctx.font = font(9, FONT_SERIF, 700);
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText("AI 生成", W - 42, H - 34);
    ctx.restore();
  }

  function drawAiDisclosureButton(x, y, w, h) {
    const id = "title:ai-disclosure";
    const hover = isHovered(id);
    ctx.save();
    roundRect(x, y, w, h, 7);
    const goldFill = ctx.createLinearGradient(x, y, x + w, y + h);
    goldFill.addColorStop(0, hover ? "#f0d795" : "#dfc17c");
    goldFill.addColorStop(0.55, hover ? "#e4c273" : "#cda65b");
    goldFill.addColorStop(1, hover ? "#d5ad58" : "#b98d43");
    ctx.fillStyle = goldFill;
    ctx.fill();
    strokeRound(x, y, w, h, 7, hover ? "rgba(255,239,191,0.94)" : "rgba(242,217,154,0.78)", 1);
    ctx.fillStyle = "rgba(255,248,213,0.25)";
    ctx.fillRect(x + 8, y + 2, w - 16, 1);

    ctx.fillStyle = INK;
    ctx.font = font(18, FONT_SERIF, 700);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("AI生成", x + w / 2 - 8, y + h / 2 + 1);
    ctx.fillStyle = "rgba(17,28,32,0.62)";
    ctx.font = font(22, FONT_SERIF, 700);
    ctx.fillText("›", x + w - 22, y + h / 2);
    ctx.restore();
    addHit(id, x, y, w, h, () => openOverlay("aiDisclosure"));
  }

  function drawButton(id, x, y, w, h, label, onClick, options = {}) {
    const hover = isHovered(id);
    const active = options.active !== false;
    ctx.save();
    ctx.globalAlpha = active ? 1 : 0.45;
    fillRound(x, y, w, h, options.radius || 8, hover ? "rgba(244,234,215,0.96)" : "rgba(17,28,32,0.86)");
    strokeRound(x, y, w, h, options.radius || 8, hover ? GOLD : "rgba(214,185,120,0.48)", 1);
    ctx.fillStyle = hover ? INK : PAPER;
    ctx.font = font(options.size || 16, options.serif ? FONT_SERIF : FONT_SANS, options.weight || 600);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + w / 2, y + h / 2 + 1);
    ctx.restore();
    if (active) addHit(id, x, y, w, h, onClick);
  }

  function drawTopBar() {
    const scene = currentScene();
    const canInteract = state.mode === "play";
    ctx.save();
    fillRound(38, 34, 300, 64, 6, "rgba(12,24,27,0.83)");
    ctx.fillStyle = CINNABAR;
    ctx.fillRect(38, 34, 5, 64);
    ctx.fillStyle = GOLD;
    ctx.font = font(14, FONT_SERIF, 700);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(scene.chapter, 58, 46);
    ctx.fillStyle = PAPER;
    ctx.font = font(20, FONT_SERIF, 700);
    ctx.fillText(scene.title, 58, 67);

    const objective = getObjective();
    ctx.font = font(14);
    const objectiveWidth = Math.min(620, Math.max(290, ctx.measureText(objective).width + 56));
    fillRound(38, 108, objectiveWidth, 38, 19, "rgba(244,234,215,0.9)");
    ctx.fillStyle = CINNABAR;
    ctx.font = font(13, FONT_SANS, 700);
    ctx.fillText("此行", 56, 119);
    ctx.fillStyle = INK;
    ctx.font = font(14);
    ctx.fillText(objective, 92, 119);

    const clueLabel = `线索  ${state.clues.length}/5`;
    drawButton(
      "btn-clues",
      526,
      34,
      184,
      46,
      clueLabel,
      () => openOverlay("clues"),
      { active: canInteract, radius: 23, size: 15, weight: 700 }
    );

    drawButton(
      "btn-save",
      1080,
      34,
      64,
      46,
      "存档",
      () => openOverlay("save"),
      { active: canInteract, radius: 7, size: 15 }
    );
    drawButton(
      "btn-achievements",
      1152,
      34,
      64,
      46,
      "成就",
      () => openOverlay("achievements"),
      { active: canInteract, radius: 7, size: 15 }
    );
    drawButton(
      "btn-audio",
      962,
      34,
      46,
      46,
      state.muted ? "静" : "乐",
      toggleMute,
      { active: true, radius: 23, size: 17, serif: true }
    );
    ctx.restore();
  }

  function drawHotspot(hotspot) {
    const rect = hotspotRect(hotspot);
    const hover = state.hovered === hotspot.id;
    const focused = state.focusedHotspot === hotspot.id;
    const enabled = hotspotEnabled(hotspot);
    const completionFlags = {
      chen: "chenTalk",
      liu: "liuDone",
      ahui: "ahuiDone",
      huang: "huangDone",
      qiu: "qiuDone",
    };
    const completed = Boolean(hotspot.main && state.flags[completionFlags[hotspot.id] || `${hotspot.id}Done`]);
    const phase = (state.time * 1.6 + hotspot.x * 0.01) % (Math.PI * 2);
    const pulse = 1 + Math.sin(phase) * 0.08;
    const markerX = hotspot.x;
    const markerY = hotspot.y;
    const color = enabled ? (hotspot.main ? GOLD : JADE) : "rgba(239,230,210,0.36)";
    ctx.save();
    if (hotspot.main && enabled && !completed) {
      ctx.globalAlpha = 0.16 + (Math.sin(phase) + 1) * 0.05;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(markerX, markerY, 31 * pulse, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = hover ? 1 : 0.82;
    ctx.fillStyle = enabled ? "rgba(13,25,28,0.88)" : "rgba(13,25,28,0.55)";
    ctx.beginPath();
    ctx.arc(markerX, markerY, hover ? 23 : 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = hover ? 2.5 : 1.5;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = font(hover ? 16 : 13, FONT_SERIF, 700);
    ctx.fillText(enabled ? (hover ? "E" : "·") : "锁", markerX, markerY + 1);

    if (hover || focused) {
      ctx.font = font(15, FONT_SANS, 600);
      const label = enabled ? `E · ${hotspot.label}` : hotspot.lockedLabel || hotspot.label;
      const labelWidth = Math.min(390, ctx.measureText(label).width + 42);
      let labelX = markerX - labelWidth / 2;
      let labelY = markerY - 58;
      labelX = Math.max(44, Math.min(W - labelWidth - 44, labelX));
      if (labelY < 155) labelY = markerY + 35;
      fillRound(labelX, labelY, labelWidth, 38, 19, "rgba(13,25,28,0.94)");
      strokeRound(labelX, labelY, labelWidth, 38, 19, "rgba(214,185,120,0.48)", 1);
      ctx.fillStyle = enabled ? PAPER : "rgba(243,234,217,0.62)";
      ctx.textAlign = "center";
      ctx.font = font(15, FONT_SANS, 600);
      ctx.fillText(label, labelX + labelWidth / 2, labelY + 19);
    }
    ctx.restore();
    addHit(`hotspot:${hotspot.id}`, rect.x, rect.y, rect.w, rect.h, () => triggerHotspot(hotspot));
  }

  function drawSceneIntro() {
    if (state.sceneIntro <= 0) return;
    const scene = currentScene();
    const elapsed = 2.2 - Math.min(2.2, state.sceneIntro);
    const fadeIn = Math.min(1, elapsed / 0.3);
    const fadeOut = Math.min(1, state.sceneIntro / 0.45);
    const alpha = Math.min(fadeIn, fadeOut);
    ctx.save();
    ctx.globalAlpha = alpha;
    const width = 500;
    const x = 64;
    const y = 224;
    ctx.fillStyle = "rgba(8,17,20,0.76)";
    ctx.fillRect(x, y, width, 150);
    ctx.fillStyle = CINNABAR;
    ctx.fillRect(x, y, 6, 150);
    ctx.fillStyle = GOLD;
    ctx.font = font(15, FONT_SERIF, 700);
    ctx.textAlign = "left";
    ctx.fillText(scene.chapter, x + 34, y + 42);
    ctx.fillStyle = PAPER;
    ctx.font = font(38, FONT_SERIF, 700);
    ctx.fillText(scene.title, x + 34, y + 90);
    ctx.fillStyle = "rgba(243,234,217,0.7)";
    ctx.font = font(14);
    ctx.fillText(scene.micro, x + 36, y + 120);
    ctx.restore();
  }

  function drawToasts() {
    state.toasts.forEach((item, index) => {
      const targetY = 172 + index * 92;
      const enter = Math.min(1, (item.life - item.remaining) / 0.26);
      const exit = Math.min(1, item.remaining / 0.35);
      const x = 844 + (1 - Math.min(enter, exit)) * 170;
      const y = targetY;
      const tone = item.tone === "red" ? CINNABAR : item.tone === "jade" ? JADE : GOLD;
      ctx.save();
      ctx.globalAlpha = Math.min(enter, exit);
      fillRound(x + 5, y + 8, 390, 76, 8, "rgba(2,7,9,0.3)");
      fillRound(x, y, 390, 76, 8, "rgba(18,30,33,0.94)");
      ctx.fillStyle = tone;
      ctx.fillRect(x, y, 5, 76);
      ctx.beginPath();
      ctx.arc(x + 38, y + 38, 21, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(244,234,215,0.08)";
      ctx.fill();
      ctx.strokeStyle = tone;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = tone;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = font(16, FONT_SERIF, 700);
      ctx.fillText(item.icon, x + 38, y + 39);
      ctx.textAlign = "left";
      ctx.fillStyle = tone;
      ctx.textBaseline = "top";
      ctx.font = font(12, FONT_SANS, 700);
      ctx.fillText(item.kicker, x + 74, y + 15);
      ctx.fillStyle = PAPER;
      ctx.font = font(16, FONT_SANS, 600);
      const line = ctx.measureText(item.text).width > 294 ? `${item.text.slice(0, 17)}…` : item.text;
      ctx.fillText(line, x + 74, y + 39);
      ctx.restore();
    });
  }

  function speakerFor(who) {
    return DATA.people[who] || { name: "旁白", portrait: null };
  }

  function drawDialoguePortrait(x, y, size, who, narration = false) {
    const person = speakerFor(who);
    if (narration || !who) {
      ctx.save();
      fillRound(x, y, size, size, 8, "rgba(244,234,215,0.07)");
      ctx.strokeStyle = "rgba(214,185,120,0.4)";
      ctx.lineWidth = 1;
      roundRect(x, y, size, size, 8);
      ctx.stroke();
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + size * 0.27, y + size * 0.62);
      ctx.quadraticCurveTo(x + size * 0.5, y + size * 0.37, x + size * 0.73, y + size * 0.62);
      ctx.stroke();
      ctx.fillStyle = "rgba(243,234,217,0.45)";
      ctx.font = font(13, FONT_SERIF, 700);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("叙", x + size / 2, y + size * 0.5);
      ctx.restore();
      return;
    }
    if (person.portrait && image(person.portrait)) {
      ctx.save();
      roundRect(x, y, size, size, 8);
      ctx.clip();
      drawCover(image(person.portrait), x, y, size, size);
      ctx.restore();
      strokeRound(x, y, size, size, 8, "rgba(214,185,120,0.66)", 2);
    } else {
      ctx.save();
      fillRound(x, y, size, size, 8, "#d5b568");
      ctx.strokeStyle = CINNABAR;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x + size / 2, y + size / 2, size * 0.35, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = CINNABAR;
      ctx.font = font(size * 0.38, FONT_SERIF, 700);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(person.seal || "爷", x + size / 2, y + size / 2 + 1);
      ctx.restore();
      strokeRound(x, y, size, size, 8, GOLD_DARK, 2);
    }
  }

  function drawDialogue() {
    if (!state.dialogue) return;
    const node = currentDialogueNode();
    if (!node) return;
    const isChoice = node.type === "choice";
    const text = isChoice ? node.prompt : node.text;
    const visibleChars = isChoice ? Array.from(text).length : Math.floor(state.dialogue.typeChars);
    const visibleText = Array.from(text).slice(0, visibleChars).join("");
    const box = { x: 120, y: 480, w: 1040, h: 160 };
    const person = node.who ? speakerFor(node.who) : null;
    const narration = Boolean(node.narration || !node.who);
    const hasPortrait = !narration && (person?.portrait || node.who === "grandpa");

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.46)";
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 10;
    fillRound(box.x, box.y, box.w, box.h, 10, "rgba(14,27,31,0.95)");
    ctx.shadowColor = "transparent";
    strokeRound(box.x, box.y, box.w, box.h, 10, "rgba(214,185,120,0.7)", 1.5);
    ctx.fillStyle = CINNABAR;
    ctx.fillRect(box.x, box.y + 20, 4, box.h - 40);

    if (hasPortrait) drawDialoguePortrait(136, 500, 112, node.who, false);

    const textX = hasPortrait ? 272 : 160;
    const textWidth = hasPortrait ? 824 : 944;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    if (narration) {
      ctx.fillStyle = GOLD;
      ctx.font = font(13, FONT_SANS, 700);
      ctx.fillText("旁白", textX, box.y + 20);
    } else {
      ctx.fillStyle = GOLD;
      ctx.font = font(16, FONT_SANS, 700);
      ctx.fillText(person?.name || "旁白", textX, box.y + 17);
    }
    const bodySize = Array.from(text).length > 75 ? 20 : 22;
    ctx.font = font(bodySize, FONT_SANS, 400);
    drawWrapped(
      visibleText,
      textX,
      box.y + 51,
      textWidth,
      bodySize > 20 ? 33 : 36,
      PAPER,
      bodySize > 20 ? 3 : 3
    );

    if (!isChoice && dialogueTextComplete()) {
      const bounce = Math.sin(state.time * 4) * 3;
      ctx.fillStyle = GOLD;
      ctx.beginPath();
      ctx.moveTo(box.x + box.w - 38, box.y + box.h - 28 + bounce);
      ctx.lineTo(box.x + box.w - 24, box.y + box.h - 28 + bounce);
      ctx.lineTo(box.x + box.w - 31, box.y + box.h - 19 + bounce);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = "rgba(243,234,217,0.42)";
    ctx.font = font(12);
    ctx.textAlign = "right";
    ctx.fillText("点击 / E 继续", box.x + box.w - 24, box.y + box.h - 20);
    ctx.restore();

    if (isChoice) drawChoices(node);
  }

  function drawChoices(node) {
    const count = node.options.length;
    const cardWidth = 660;
    const cardHeight = 55;
    const gap = 10;
    const startY = 476 - count * (cardHeight + gap) - 8;
    const x = 360;
    node.options.forEach((option, index) => {
      const y = startY + index * (cardHeight + gap);
      const id = `choice:${index}`;
      const hover = isHovered(id);
      ctx.save();
      fillRound(x, y, cardWidth, cardHeight, 9, hover ? "rgba(244,234,215,0.97)" : "rgba(15,29,33,0.94)");
      strokeRound(x, y, cardWidth, cardHeight, 9, hover ? GOLD : "rgba(214,185,120,0.44)", 1);
      ctx.beginPath();
      ctx.arc(x + 29, y + cardHeight / 2, 16, 0, Math.PI * 2);
      ctx.fillStyle = hover ? CINNABAR : "rgba(214,185,120,0.14)";
      ctx.fill();
      ctx.strokeStyle = hover ? CINNABAR : GOLD;
      ctx.stroke();
      ctx.fillStyle = hover ? PAPER : GOLD;
      ctx.font = font(15, FONT_SERIF, 700);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(option.key || String(index + 1), x + 29, y + cardHeight / 2 + 1);
      ctx.fillStyle = hover ? INK : PAPER;
      ctx.font = font(16, FONT_SANS, 500);
      ctx.textAlign = "left";
      const max = cardWidth - 78;
      let label = option.text;
      while (ctx.measureText(label).width > max && label.length > 1) label = label.slice(0, -1);
      if (label !== option.text) label += "…";
      ctx.fillText(label, x + 57, y + cardHeight / 2 + 1);
      ctx.restore();
      addHit(id, x, y, cardWidth, cardHeight, () => selectDialogueChoice(index));
    });
  }

  function drawControlHint() {
    if (state.mode !== "play" || state.overlay || state.dialogue) return;
    ctx.save();
    ctx.fillStyle = "rgba(7,16,19,0.76)";
    ctx.fillRect(38, 672, 376, 28);
    ctx.fillStyle = "rgba(243,234,217,0.67)";
    ctx.font = font(13);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("鼠标靠近 / Tab 选择   E 互动   L 线索   F 全屏", 54, 686);
    ctx.restore();
  }

  function drawGame() {
    const scene = currentScene();
    drawCover(image(scene.bg), 0, 0, W, H);
    ctx.fillStyle = scene.tint || "rgba(0,0,0,0)";
    ctx.fillRect(0, 0, W, H);
    drawVignette(0.58);
    drawAmbientMotes();
    drawPaperTexture(0.022);
    drawScreenFrame();

    if (state.mode === "play" && !state.transition && !state.overlay) {
      getHotspots().forEach(drawHotspot);
    }

    drawSceneIntro();
    drawTopBar();
    drawControlHint();
    drawToasts();
    if (state.dialogue) drawDialogue();
    if (state.overlay) drawOverlay();

    if (state.transition) {
      const half = state.transition.duration / 2;
      const progress = state.transition.elapsed;
      const alpha =
        progress <= half
          ? progress / half
          : Math.max(0, 1 - (progress - half) / half);
      ctx.fillStyle = `rgba(7,13,16,${Math.min(1, alpha)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawModalBase(id, x, y, w, h, title, kicker = "旅程手记") {
    addHit(`${id}:backdrop`, 0, 0, W, H, closeOverlay, "default");
    addHit(`${id}:surface`, x, y, w, h, () => {}, "default");
    ctx.save();
    const dimAlpha = state.overlay?.type === "finale" ? 0.5 : 0.38;
    ctx.fillStyle = `rgba(4,10,12,${dimAlpha})`;
    ctx.fillRect(0, 0, W, H);
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 42;
    ctx.shadowOffsetY = 18;
    fillRound(x, y, w, h, 12, "rgba(18,31,35,0.985)");
    ctx.shadowColor = "transparent";
    strokeRound(x, y, w, h, 12, "rgba(214,185,120,0.72)", 1.5);
    ctx.fillStyle = CINNABAR;
    ctx.fillRect(x, y + 34, 5, 64);
    ctx.fillStyle = GOLD;
    ctx.font = font(13, FONT_SANS, 700);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(kicker, x + 40, y + 24);
    ctx.fillStyle = PAPER;
    ctx.font = font(30, FONT_SERIF, 700);
    ctx.fillText(title, x + 40, y + 48);
    ctx.strokeStyle = "rgba(214,185,120,0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 40, y + 104);
    ctx.lineTo(x + w - 40, y + 104);
    ctx.stroke();
    drawButton(
      `${id}:close`,
      x + w - 62,
      y + 24,
      36,
      36,
      "×",
      closeOverlay,
      { radius: 18, size: 23, weight: 400 }
    );
    ctx.restore();
  }

  function drawSmallClose(id, x, y, onClick = closeOverlay) {
    drawButton(id, x, y, 34, 34, "×", onClick, {
      radius: 17,
      size: 21,
      weight: 400,
    });
  }

  function drawLockedPortrait(x, y, size) {
    ctx.save();
    fillRound(x, y, size, size, 8, "rgba(243,234,217,0.055)");
    strokeRound(x, y, size, size, 8, "rgba(214,185,120,0.2)", 1);
    ctx.strokeStyle = "rgba(243,234,217,0.22)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size * 0.37, size * 0.16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size * 0.87, size * 0.3, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();
    ctx.fillStyle = "rgba(214,185,120,0.46)";
    ctx.font = font(12, FONT_SERIF, 700);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("未见", x + size / 2, y + size - 16);
    ctx.restore();
  }

  function drawCluePanel() {
    const order = DATA.clueOrder;
    const elapsed = state.time - (state.overlay.openedAt || 0);
    const eased = 1 - Math.pow(1 - Math.min(1, elapsed / 0.28), 3);
    const y = -206 + eased * 206;
    addHit("clues:surface", 0, Math.max(0, y), W, 199, () => {}, "default");
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = "rgba(18,31,35,0.98)";
    ctx.fillRect(0, y, W, 196);
    ctx.shadowColor = "transparent";
    ctx.fillStyle = CINNABAR;
    ctx.fillRect(0, y + 196, W, 3);
    ctx.fillStyle = GOLD;
    ctx.font = font(14, FONT_SANS, 700);
    ctx.textAlign = "left";
    ctx.fillText(`人物线索 · ${state.clues.length}/5`, 38, y + 27);
    drawSmallClose("clues:close", 1205, y + 17);

    const cardW = 224;
    const gap = 12;
    order.forEach((personId, index) => {
      const person = DATA.people[personId];
      const unlocked = state.clues.includes(personId);
      const x = 38 + index * (cardW + gap);
      const cardY = y + 51;
      const id = `clue-card:${personId}`;
      const hover = unlocked && isHovered(id);
      fillRound(
        x,
        cardY,
        cardW,
        126,
        7,
        hover ? "rgba(244,234,215,0.14)" : "rgba(244,234,215,0.065)"
      );
      strokeRound(x, cardY, cardW, 126, 7, hover ? GOLD : "rgba(214,185,120,0.24)", 1);
      if (unlocked) {
        drawDialoguePortrait(x + 14, cardY + 16, 82, personId);
      } else {
        drawLockedPortrait(x + 14, cardY + 16, 82);
      }
      ctx.fillStyle = unlocked ? PAPER : "rgba(243,234,217,0.3)";
      ctx.font = font(18, FONT_SERIF, 700);
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(unlocked ? person.name : "尚未结识", x + 111, cardY + 25);
      ctx.fillStyle = unlocked ? "rgba(214,185,120,0.9)" : "rgba(243,234,217,0.22)";
      ctx.font = font(12);
      ctx.fillText(unlocked ? person.role : "继续走访场景", x + 111, cardY + 53);
      ctx.fillStyle = unlocked ? "rgba(243,234,217,0.48)" : "rgba(243,234,217,0.18)";
      ctx.font = font(12, FONT_SERIF, 700);
      ctx.fillText(person.clueNo || "·", x + 111, cardY + 88);
      ctx.restore();
      ctx.save();
      if (unlocked) {
        addHit(id, x, cardY, cardW, 126, () => openOverlay("person", { id: personId }));
      }
    });
    ctx.restore();
  }

  function drawPersonOverlay(id) {
    const person = DATA.people[id];
    if (!person) return;
    const unlocked = state.clues.includes(id);
    const x = 156;
    const y = 112;
    const w = 968;
    const h = 496;
    drawModalBase("person", x, y, w, h, unlocked ? person.name : "尚未结识", `线索 · ${person.clueNo || "?"}`);
    ctx.save();
    const portraitX = x + 42;
    const portraitY = y + 136;
    if (unlocked) {
      drawDialoguePortrait(portraitX, portraitY, 232, id);
    } else {
      drawLockedPortrait(portraitX, portraitY, 232);
    }
    ctx.fillStyle = GOLD;
    ctx.font = font(13, FONT_SANS, 700);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(unlocked ? "人物小传" : "线索未解锁", x + 314, y + 145);
    ctx.fillStyle = PAPER;
    ctx.font = font(25, FONT_SERIF, 700);
    ctx.fillText(unlocked ? person.role : "去场景里找到这个人", x + 314, y + 176);
    ctx.fillStyle = "rgba(243,234,217,0.76)";
    ctx.font = font(17);
    drawWrapped(
      unlocked ? person.bio : "这段线索还藏在场景里。移动视线找到正在发光的人物，按 E 或点击与对方交谈。",
      x + 314,
      y + 226,
      590,
      31,
      "rgba(243,234,217,0.76)",
      6
    );
    ctx.fillStyle = "rgba(214,185,120,0.7)";
    ctx.font = font(13, FONT_SERIF, 700);
    ctx.fillText(`已收线索 ${state.clues.indexOf(id) + 1} / 5`, x + 314, y + 430);
    ctx.restore();
    drawButton(
      "person:back",
      x + 40,
      y + h - 54,
      108,
      34,
      "← 回线索",
      () => openOverlay("clues"),
      { radius: 17, size: 14 }
    );
  }

  function drawAchievementsOverlay() {
    const x = 176;
    const y = 102;
    const w = 928;
    const h = 516;
    drawModalBase("achievements", x, y, w, h, "成就记事本", `已达成 ${state.achievements.length} / 4`);
    ctx.save();
    ctx.fillStyle = "rgba(244,234,215,0.035)";
    ctx.fillRect(x + 32, y + 124, w - 64, h - 164);
    ctx.strokeStyle = "rgba(171,70,55,0.22)";
    ctx.lineWidth = 1;
    [0, 1, 2, 3].forEach((index) => {
      const rowY = y + 156 + index * 78;
      ctx.beginPath();
      ctx.moveTo(x + 48, rowY);
      ctx.lineTo(x + w - 48, rowY);
      ctx.stroke();
    });
    Object.keys(DATA.achievements).forEach((achievementId, index) => {
      const item = DATA.achievements[achievementId];
      const unlocked = state.achievements.includes(achievementId);
      const rowY = y + 128 + index * 78;
      ctx.beginPath();
      ctx.arc(x + 78, rowY + 34, 22, 0, Math.PI * 2);
      ctx.fillStyle = unlocked ? CINNABAR : "rgba(243,234,217,0.06)";
      ctx.fill();
      ctx.strokeStyle = unlocked ? GOLD : "rgba(243,234,217,0.18)";
      ctx.stroke();
      ctx.fillStyle = unlocked ? PAPER : "rgba(243,234,217,0.22)";
      ctx.font = font(15, FONT_SERIF, 700);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(unlocked ? "印" : "?", x + 78, rowY + 35);
      ctx.textAlign = "left";
      ctx.fillStyle = unlocked ? PAPER : "rgba(243,234,217,0.25)";
      ctx.font = font(21, FONT_SERIF, 700);
      ctx.fillText(unlocked ? `【${item.title}】` : "未达成", x + 120, rowY + 22);
      ctx.fillStyle = unlocked ? "rgba(243,234,217,0.72)" : "rgba(243,234,217,0.18)";
      ctx.font = font(14);
      let quote = unlocked ? item.quote : "这段记忆还在前面的场景里。";
      while (ctx.measureText(quote).width > 620 && quote.length > 1) quote = quote.slice(0, -1);
      if (unlocked && quote !== item.quote) quote += "…";
      ctx.fillText(quote, x + 120, rowY + 49);
      ctx.fillStyle = "rgba(214,185,120,0.52)";
      ctx.font = font(12, FONT_SANS, 700);
      ctx.textAlign = "right";
      ctx.fillText(item.chapter, x + w - 52, rowY + 29);
    });
    ctx.restore();
  }

  function formatSaveTime(iso) {
    if (!iso) return "尚未留下存档";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "时间未知";
    return date.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function drawSaveOverlay() {
    const x = 248;
    const y = 124;
    const w = 784;
    const h = 472;
    const save = readSave();
    drawModalBase("save", x, y, w, h, "旅程存档", "自动存档已开启");
    ctx.save();
    ctx.fillStyle = "rgba(244,234,215,0.055)";
    roundRect(x + 38, y + 132, w - 76, 224, 10);
    ctx.fill();
    strokeRound(x + 38, y + 132, w - 76, 224, 10, "rgba(214,185,120,0.22)", 1);

    const scene = currentScene();
    ctx.fillStyle = GOLD;
    ctx.font = font(13, FONT_SANS, 700);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("当前停留", x + 62, y + 158);
    ctx.fillStyle = PAPER;
    ctx.font = font(24, FONT_SERIF, 700);
    ctx.fillText(scene.title, x + 62, y + 183);
    ctx.fillStyle = "rgba(243,234,217,0.62)";
    ctx.font = font(14);
    ctx.fillText(`${scene.chapter} · ${scene.micro}`, x + 62, y + 222);

    const stats = [
      ["人物", `${state.clues.length}/5`],
      ["成就", `${state.achievements.length}/4`],
      ["图谱", `${state.codex.length}/${CODEX_TOTAL}`],
    ];
    stats.forEach(([label, value], index) => {
      const sx = x + 460 + index * 100;
      ctx.fillStyle = "rgba(243,234,217,0.42)";
      ctx.font = font(12);
      ctx.fillText(label, sx, y + 170);
      ctx.fillStyle = PAPER;
      ctx.font = font(26, FONT_SERIF, 700);
      ctx.fillText(value, sx, y + 194);
    });
    ctx.strokeStyle = "rgba(214,185,120,0.18)";
    ctx.beginPath();
    ctx.moveTo(x + 62, y + 270);
    ctx.lineTo(x + w - 62, y + 270);
    ctx.stroke();
    ctx.fillStyle = "rgba(243,234,217,0.6)";
    ctx.font = font(14);
    ctx.fillText(`最近手动 / 自动记录：${formatSaveTime(save?.savedAt)}`, x + 62, y + 292);
    const unlockedNames = state.clues.map((id) => DATA.people[id]?.name).filter(Boolean).join("、");
    ctx.fillStyle = "rgba(214,185,120,0.78)";
    ctx.font = font(14, FONT_SANS, 600);
    ctx.fillText(`已解锁人物：${unlockedNames || "尚未结识"}`, x + 62, y + 319);
    ctx.fillStyle = "rgba(243,234,217,0.4)";
    ctx.font = font(12);
    ctx.fillText("记录当前场景、人物线索、成就、图谱与选择分数。", x + 62, y + 341);
    ctx.restore();

    drawButton("save:now", x + 62, y + 378, 168, 50, "现在就存档", () => {
      saveGame(true);
      autosave();
    }, { radius: 7, size: 16, serif: true, weight: 700 });
    drawButton("save:continue", x + 246, y + 378, 168, 50, "继续旅程", closeOverlay, {
      radius: 7,
      size: 16,
      serif: true,
      weight: 700,
    });
    ctx.save();
    ctx.fillStyle = "rgba(243,234,217,0.36)";
    ctx.font = font(12);
    ctx.textAlign = "right";
    ctx.fillText("本地浏览器存档 · 不上传", x + w - 62, y + 401);
    ctx.restore();
  }

  function drawAiDisclosureOverlay() {
    const x = 272;
    const y = 104;
    const w = 736;
    const h = 512;
    addHit("ai-disclosure:backdrop", 0, 0, W, H, closeOverlay, "default");
    addHit("ai-disclosure:surface", x, y, w, h, () => {}, "default");

    ctx.save();
    ctx.fillStyle = "rgba(4,10,12,0.54)";
    ctx.fillRect(0, 0, W, H);
    ctx.shadowColor = "rgba(0,0,0,0.52)";
    ctx.shadowBlur = 42;
    ctx.shadowOffsetY = 18;
    roundRect(x, y, w, h, 12);
    const paper = ctx.createLinearGradient(x, y, x + w, y + h);
    paper.addColorStop(0, "#f8f0e3");
    paper.addColorStop(0.55, "#f2e8d8");
    paper.addColorStop(1, "#e9ddca");
    ctx.fillStyle = paper;
    ctx.fill();
    ctx.shadowColor = "transparent";
    strokeRound(x, y, w, h, 12, "rgba(149,97,57,0.5)", 1.5);
    strokeRound(x + 10, y + 10, w - 20, h - 20, 8, "rgba(159,73,56,0.18)", 1);

    ctx.fillStyle = CINNABAR;
    ctx.fillRect(x + 46, y + 42, 4, 76);
    ctx.font = font(13, FONT_SANS, 700);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("AI 生成内容标识", x + 68, y + 38);
    ctx.fillStyle = "#763d32";
    ctx.font = font(30, FONT_SERIF, 700);
    ctx.fillText("本作含人工智能生成内容", x + 68, y + 66);

    ctx.strokeStyle = "rgba(143,82,54,0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 46, y + 132);
    ctx.lineTo(x + w - 46, y + 132);
    ctx.stroke();

    const bodyColor = "#493f35";
    ctx.font = font(17, FONT_SANS, 500);
    drawWrapped(
      "本作的场景插画与人物头像由生成式人工智能绘制，部分叙事文本亦经人工智能辅助生成，再经人工筛选、改写与校对。",
      x + 46,
      y + 160,
      w - 92,
      31,
      bodyColor,
      3,
      "left"
    );
    drawWrapped(
      "麒麟舞的民俗背景、扎作工序与进校园流程，依据公开资料整理，供了解与体验之用；如作研究或引用，请以原始文献为准。",
      x + 46,
      y + 258,
      w - 92,
      31,
      bodyColor,
      4,
      "left"
    );

    ctx.strokeStyle = "rgba(143,82,54,0.2)";
    ctx.beginPath();
    ctx.moveTo(x + 46, y + h - 64);
    ctx.lineTo(x + w - 46, y + h - 64);
    ctx.stroke();
    ctx.fillStyle = "rgba(73,63,53,0.48)";
    ctx.font = font(11, FONT_SANS, 500);
    ctx.fillText("生成方式与资料依据 · 点击空白处或按 Esc 关闭", x + 46, y + h - 45);
    ctx.restore();

    drawButton(
      "ai-disclosure:close",
      x + w - 58,
      y + 22,
      36,
      36,
      "×",
      closeOverlay,
      { radius: 18, size: 23, weight: 400 }
    );
  }

  function drawHelpOverlay() {
    const x = 208;
    const y = 102;
    const w = 864;
    const h = 516;
    drawModalBase("help", x, y, w, h, "怎样走完这趟路", "操作说明");
    const items = [
      ["01", "靠近", "移动鼠标到场景要素上，或按 Tab 切换。出现“E · 对象名”即算靠近。"],
      ["02", "互动", "按 E 或直接点击人物、物件与出口。人物可以重复交谈，但只有第一次会计分。"],
      ["03", "阅读", "点击或按 E 逐段推进。出现选项时，点击，或按 1 / 2 / 3 选择。"],
      ["04", "收集", "顶部“线索”记录五个人物；右侧“成就”与地图里的小图标会留下你的选择。"],
    ];
    ctx.save();
    items.forEach(([no, title, body], index) => {
      const rowY = y + 134 + index * 78;
      ctx.fillStyle = CINNABAR;
      ctx.font = font(13, FONT_SERIF, 700);
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(no, x + 44, rowY);
      ctx.fillStyle = PAPER;
      ctx.font = font(19, FONT_SERIF, 700);
      ctx.fillText(title, x + 88, rowY - 3);
      ctx.fillStyle = "rgba(243,234,217,0.68)";
      ctx.font = font(15);
      drawWrapped(body, x + 158, rowY - 2, 620, 24, "rgba(243,234,217,0.68)", 2);
    });
    ctx.fillStyle = "rgba(214,185,120,0.58)";
    ctx.font = font(12);
    ctx.fillText("L 线索 · A 成就 · S 存档 · M 声音 · F 全屏", x + 44, y + h - 38);
    ctx.restore();
  }

  function drawCodexOverlay(cardId) {
    const card = DATA.codex[cardId];
    if (!card) return;
    const x = 154;
    const y = 94;
    const w = 972;
    const h = 532;
    drawModalBase("codex", x, y, w, h, card.title, `麒麟图谱 · 残页 ${card.no}`);
    ctx.save();
    const imgX = x + 38;
    const imgY = y + 130;
    const imgW = 386;
    const imgH = 350;
    roundRect(imgX, imgY, imgW, imgH, 8);
    ctx.clip();
    drawCover(image(card.image), imgX, imgY, imgW, imgH);
    ctx.restore();
    strokeRound(imgX, imgY, imgW, imgH, 8, "rgba(214,185,120,0.48)", 1);
    ctx.save();
    ctx.fillStyle = "rgba(14,25,28,0.82)";
    ctx.fillRect(imgX, imgY + imgH - 52, imgW, 52);
    ctx.fillStyle = GOLD;
    ctx.font = font(13, FONT_SANS, 700);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(card.tag, imgX + 18, imgY + imgH - 40);
    ctx.fillStyle = "rgba(243,234,217,0.64)";
    ctx.font = font(12, FONT_SERIF, 700);
    ctx.fillText(
      `已收集 ${state.codex.length} / ${CODEX_TOTAL}`,
      imgX + imgW - 126,
      imgY + imgH - 40
    );

    ctx.fillStyle = PAPER;
    ctx.font = font(21);
    drawWrapped(card.body, x + 462, y + 155, 444, 31, PAPER, 8);
    ctx.strokeStyle = "rgba(214,185,120,0.22)";
    ctx.beginPath();
    ctx.moveTo(x + 462, y + 432);
    ctx.lineTo(x + w - 42, y + 432);
    ctx.stroke();
    ctx.fillStyle = "rgba(214,185,120,0.68)";
    ctx.font = font(13, FONT_SANS, 700);
    ctx.fillText("资料来源", x + 462, y + 450);
    ctx.fillStyle = "rgba(243,234,217,0.52)";
    ctx.font = font(12);
    drawWrapped(card.source, x + 462, y + 474, 440, 20, "rgba(243,234,217,0.52)", 2);
    ctx.restore();
    if (state.codexQueue.length) {
      drawButton(
        "codex:next",
        x + w - 204,
        y + h - 54,
        154,
        36,
        `下一张 · 余 ${state.codexQueue.length}`,
        showNextCodexPopup,
        { radius: 18, size: 13, serif: true, weight: 700 }
      );
    }
  }

  function drawFinaleOverlay() {
    const x = 176;
    const y = 82;
    const w = 928;
    const h = 556;
    const total = state.scores.memory + state.scores.liu + state.scores.huang + state.scores.qiu;
    const title =
      state.achievements.length >= 4
        ? "《传承 · 携手 · 发扬》"
        : state.achievements.length >= 2
          ? "《把故事带回去》"
          : "《初心 · 再听》";
    drawModalBase("finale", x, y, w, h, title, "旅程完成");
    ctx.save();
    ctx.fillStyle = GOLD;
    ctx.font = font(15, FONT_SANS, 700);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("带回去的", x + 52, y + 134);
    const stats = [
      ["人物线索", `${state.clues.length}/5`],
      ["章末成就", `${state.achievements.length}/4`],
      ["科普图谱", `${state.codex.length}/${CODEX_TOTAL}`],
      ["选择分值", `${total}`],
    ];
    stats.forEach(([label, value], index) => {
      const cardX = x + 52 + index * 205;
      fillRound(cardX, y + 166, 184, 102, 8, "rgba(244,234,215,0.06)");
      strokeRound(cardX, y + 166, 184, 102, 8, "rgba(214,185,120,0.22)", 1);
      ctx.fillStyle = PAPER;
      ctx.font = font(32, FONT_SERIF, 700);
      ctx.fillText(value, cardX + 18, y + 184);
      ctx.fillStyle = "rgba(243,234,217,0.5)";
      ctx.font = font(13);
      ctx.fillText(label, cardX + 20, y + 232);
    });

    ctx.fillStyle = "rgba(243,234,217,0.08)";
    roundRect(x + 52, y + 294, w - 104, 136, 8);
    ctx.fill();
    ctx.fillStyle = GOLD;
    ctx.font = font(13, FONT_SANS, 700);
    ctx.fillText(
      state.achievements.length
        ? "你把这些名字留在了记事本里："
        : "有些故事还在下一次回望里：",
      x + 74,
      y + 316
    );
    const achievementNames = Object.keys(DATA.achievements)
      .filter((id) => state.achievements.includes(id))
      .map((id) => `【${DATA.achievements[id].title}】`)
      .join("  ");
    ctx.fillStyle = PAPER;
    ctx.font = font(20, FONT_SERIF, 700);
    ctx.fillText(achievementNames || "【初心 · 再听】", x + 74, y + 343);
    ctx.fillStyle = "rgba(243,234,217,0.63)";
    ctx.font = font(15);
    drawWrapped(
      "故事到这里落下帷幕，但祠堂外的锣鼓仍在继续。你带走的不是一枚结束印章，而是一条可以再走一次的路。",
      x + 74,
      y + 380,
      w - 148,
      26,
      "rgba(243,234,217,0.63)",
      2
    );
    ctx.restore();
    drawButton("finale:browse", x + 52, y + h - 72, 146, 46, "继续旅途", closeOverlay, {
      radius: 7,
      size: 15,
      serif: true,
    });
    drawButton("finale:ending", x + 214, y + h - 72, 146, 46, "重读结局", openEndingReader, {
      radius: 7,
      size: 15,
      serif: true,
    });
    drawButton(
      "finale:intro",
      x + 376,
      y + h - 72,
      146,
      46,
      "重读终章",
      openFinalIntroReader,
      { radius: 7, size: 15, serif: true }
    );
    drawButton(
      "finale:title",
      x + w - 190,
      y + h - 72,
      158,
      46,
      "回到标题",
      () => {
        state.mode = "title";
        state.overlay = null;
        state.dialogue = null;
        refreshTitleCache();
      },
      { radius: 7, size: 15, serif: true }
    );
  }

  function drawReaderOverlay() {
    const reader = state.overlay;
    if (!reader) return;
    const page = reader.pages[reader.page];
    if (!page) return;
    const isEnding = reader.type === "endingReader";
    const x = 100;
    const y = 54;
    const w = 1080;
    const h = 612;

    addHit("reader:backdrop", 0, 0, W, H, () => {}, "default");
    addHit("reader:surface", x, y, w, h, () => {}, "default");
    ctx.save();
    ctx.fillStyle = "rgba(4,10,12,0.6)";
    ctx.fillRect(0, 0, W, H);
    const paper = ctx.createLinearGradient(x, y, x + w, y + h);
    paper.addColorStop(0, "rgba(25,40,43,0.995)");
    paper.addColorStop(1, "rgba(13,24,27,0.995)");
    ctx.shadowColor = "rgba(0,0,0,0.65)";
    ctx.shadowBlur = 46;
    ctx.shadowOffsetY = 18;
    fillRound(x, y, w, h, 12, paper);
    ctx.shadowColor = "transparent";
    strokeRound(x, y, w, h, 12, "rgba(214,185,120,0.66)", 1.5);
    ctx.fillStyle = CINNABAR;
    ctx.fillRect(x, y + 40, 6, 110);

    ctx.fillStyle = GOLD;
    ctx.font = font(13, FONT_SANS, 700);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(
      isEnding
        ? `结局正文 · ${state.achievements.filter((id) => ["chuancheng", "xieshou", "fayang"].includes(id)).length} / 3 项传承成就`
        : `${DATA.finalChapter.label} · 故事背后的麒麟文化`,
      x + 42,
      y + 28
    );
    ctx.fillStyle = PAPER;
    ctx.font = font(isEnding ? 36 : 31, FONT_SERIF, 700);
    ctx.fillText(page.title, x + 42, y + 56);

    const progress = `${reader.page + 1} / ${reader.pages.length}`;
    ctx.fillStyle = "rgba(243,234,217,0.52)";
    ctx.font = font(13, FONT_SANS, 600);
    ctx.textAlign = "right";
    ctx.fillText(progress, x + w - 130, y + 31);
    drawButton(
      "reader:skip",
      x + w - 104,
      y + 22,
      66,
      34,
      isEnding ? "看终章" : "看总结",
      skipReaderStage,
      { radius: 17, size: 13, serif: true }
    );

    ctx.fillStyle = "rgba(214,185,120,0.2)";
    ctx.fillRect(x + 42, y + 116, w - 84, 1);
    const barWidth = w - 84;
    fillRound(x + 42, y + 113, barWidth, 3, 2, "rgba(243,234,217,0.08)");
    fillRound(
      x + 42,
      y + 113,
      barWidth * ((reader.page + 1) / reader.pages.length),
      3,
      2,
      GOLD
    );

    ctx.fillStyle = "rgba(244,234,215,0.035)";
    ctx.beginPath();
    ctx.arc(x + w - 145, y + 246, 120, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(214,185,120,0.07)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x + w - 145, y + 246, 86, 0, Math.PI * 2);
    ctx.stroke();

    let cursorY = y + 146;
    const bodyX = x + 56;
    const bodyWidth = w - 112;
    ctx.font = font(18);
    page.paragraphs.forEach((paragraph) => {
      const lineCount = drawWrapped(
        paragraph,
        bodyX,
        cursorY,
        bodyWidth,
        30,
        "rgba(243,234,217,0.84)",
        12
      );
      cursorY += lineCount * 30 + 14;
    });

    ctx.fillStyle = "rgba(243,234,217,0.35)";
    ctx.font = font(12);
    ctx.textAlign = "left";
    ctx.fillText("← / → 翻页 · Enter 继续 · Esc 跳过本段", x + 44, y + h - 28);
    ctx.restore();

    if (reader.page > 0) {
      drawButton(
        "reader:previous",
        x + 42,
        y + h - 68,
        116,
        40,
        "← 上一页",
        previousReader,
        { radius: 7, size: 14, serif: true }
      );
    }
    const lastPage = reader.page === reader.pages.length - 1;
    const nextLabel = lastPage
      ? isEnding
        ? "进入终章介绍"
        : "查看旅程总结"
      : "下一页 →";
    drawButton(
      "reader:next",
      x + w - 224,
      y + h - 68,
      180,
      40,
      nextLabel,
      advanceReader,
      { radius: 7, size: 14, serif: true, weight: 700 }
    );
  }

  function drawOverlay() {
    if (!state.overlay) return;
    switch (state.overlay.type) {
      case "clues":
        drawCluePanel();
        break;
      case "person":
        drawPersonOverlay(state.overlay.id);
        break;
      case "achievements":
        drawAchievementsOverlay();
        break;
      case "save":
        drawSaveOverlay();
        break;
      case "aiDisclosure":
        drawAiDisclosureOverlay();
        break;
      case "help":
        drawHelpOverlay();
        break;
      case "codex":
        drawCodexOverlay(state.overlay.id);
        break;
      case "finale":
        drawFinaleOverlay();
        break;
      case "endingReader":
      case "finalIntro":
        drawReaderOverlay();
        break;
      default:
        break;
    }
  }

  function drawLoading() {
    const gradient = ctx.createLinearGradient(0, 0, W, H);
    gradient.addColorStop(0, "#0d1719");
    gradient.addColorStop(0.55, "#223a3a");
    gradient.addColorStop(1, "#101d20");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);
    const pulse = 0.88 + Math.sin(state.time * 2.4) * 0.05;
    ctx.save();
    ctx.translate(W / 2, H / 2 - 32);
    ctx.scale(pulse, pulse);
    ctx.strokeStyle = CINNABAR;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 53, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = CINNABAR;
    ctx.font = font(46, FONT_SERIF, 700);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("麟", 0, 3);
    ctx.restore();
    ctx.fillStyle = PAPER;
    ctx.font = font(20, FONT_SERIF, 700);
    ctx.textAlign = "center";
    ctx.fillText("正在展开麒麟踏雪", W / 2, H / 2 + 72);
    const barW = 280;
    fillRound(W / 2 - barW / 2, H / 2 + 104, barW, 5, 3, "rgba(244,234,215,0.1)");
    fillRound(
      W / 2 - barW / 2,
      H / 2 + 104,
      Math.max(6, barW * state.loadingProgress),
      5,
      3,
      GOLD
    );
    ctx.fillStyle = "rgba(243,234,217,0.45)";
    ctx.font = font(12);
    ctx.fillText(`${Math.round(state.loadingProgress * 100)}%`, W / 2, H / 2 + 134);
  }

  function drawTitle() {
    drawCover(image("assets/cg_qilin.jpg"), 0, 0, W, H);
    const shade = ctx.createLinearGradient(0, 0, W, 0);
    shade.addColorStop(0, "rgba(6,14,16,0.95)");
    shade.addColorStop(0.46, "rgba(7,16,18,0.72)");
    shade.addColorStop(0.72, "rgba(7,16,18,0.12)");
    shade.addColorStop(1, "rgba(7,16,18,0.38)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, W, H);
    const bottom = ctx.createLinearGradient(0, H * 0.63, 0, H);
    bottom.addColorStop(0, "rgba(6,13,15,0)");
    bottom.addColorStop(1, "rgba(6,13,15,0.86)");
    ctx.fillStyle = bottom;
    ctx.fillRect(0, 0, W, H);
    drawVignette(0.72);
    drawAmbientMotes();
    drawPaperTexture(0.028);
    drawScreenFrame();

    ctx.save();
    ctx.fillStyle = CINNABAR;
    ctx.fillRect(82, 66, 5, 92);
    ctx.fillStyle = GOLD;
    ctx.font = font(14, FONT_SANS, 700);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("横板叙事收集游戏", 106, 75);
    ctx.fillStyle = "rgba(243,234,217,0.62)";
    ctx.font = font(13, FONT_SERIF, 700);
    ctx.fillText("国家非遗 · 樟木头舞麒麟", 106, 106);
    ctx.fillText("一次关于看见与接手的归乡", 106, 128);

    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 18;
    ctx.fillStyle = PAPER;
    ctx.font = font(94, FONT_SERIF, 700);
    ctx.fillText("麒麟", 84, 172);
    ctx.fillStyle = GOLD;
    ctx.fillText("踏雪", 84, 264);
    ctx.shadowColor = "transparent";

    ctx.fillStyle = "rgba(243,234,217,0.67)";
    ctx.font = font(16);
    ctx.fillText("白麒麟踏着锣鼓出来，便叫作“踏雪”。", 91, 386);
    ctx.fillText("你循着一只旧纸箱回到故乡，寻找一个没说出口的名字。", 91, 412);
    ctx.restore();

    const save = readSave();
    drawButton("title:new", 88, 466, 236, 54, "启程", startNewGame, {
      radius: 7,
      size: 20,
      serif: true,
      weight: 700,
    });
    if (save) {
      drawButton("title:continue", 88, 532, 236, 50, "继续上次旅程", continueGame, {
        radius: 7,
        size: 17,
        serif: true,
        weight: 700,
      });
      ctx.save();
      ctx.fillStyle = "rgba(243,234,217,0.44)";
      ctx.font = font(12);
      ctx.textAlign = "left";
      ctx.fillText(
        `${DATA.scenes[save.sceneId]?.title || "序章"} · 线索 ${save.summary?.clues || 0}/5`,
        91,
        596
      );
      ctx.restore();
    }
    const utilityY = save ? 614 : 602;
    drawAiDisclosureButton(88, utilityY, 282, 48);
    drawButton(
      "title:help",
      382,
      utilityY,
      118,
      48,
      "玩法说明",
      () => openOverlay("help"),
      { radius: 7, size: 14, serif: true }
    );
    drawButton(
      "title:audio",
      1202,
      58,
      42,
      42,
      state.muted ? "静" : "乐",
      toggleMute,
      { radius: 21, size: 16, serif: true }
    );

    if (state.overlay) drawOverlay();
  }

  function render() {
    hitTargets = [];
    ctx.clearRect(0, 0, W, H);
    if (state.mode === "loading") {
      drawLoading();
    } else if (
      state.mode === "title" ||
      (state.mode === "overlay" && state.overlayReturnMode === "title")
    ) {
      drawTitle();
    } else {
      drawGame();
    }
    drawAiGeneratedWatermark();
  }

  function frame(now) {
    const delta = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    update(delta);
    render();
    window.requestAnimationFrame(frame);
  }

  window.advanceTime = (milliseconds) => {
    const delta = Math.max(0, Number(milliseconds) || 0) / 1000;
    update(delta);
    render();
  };

  window.render_game_to_text = () => {
    const scene = currentScene();
    const node = state.dialogue ? currentDialogueNode() : null;
    return JSON.stringify({
      coordinateSystem: "1280x720 canvas; origin top-left; +x right; +y down",
      mode: state.mode,
      scene: {
        id: state.sceneId,
        chapter: scene.chapter,
        title: scene.title,
        objective: getObjective(),
      },
      hovered: state.hovered,
      hotspots: getHotspots().map((hotspot) => ({
        id: hotspot.id,
        action: hotspot.action,
        label: hotspot.label,
        x: hotspot.x,
        y: hotspot.y,
        enabled: hotspotEnabled(hotspot),
        main: Boolean(hotspot.main),
      })),
      dialogue: node
        ? {
            action: state.dialogue.actionId,
            kind: node.type,
            speaker: node.who || "narration",
            text: node.type === "choice" ? node.prompt : node.text,
            choiceOptions:
              node.type === "choice"
                ? node.options.map((option) => ({ key: option.key, text: option.text }))
                : [],
            typing: !dialogueTextComplete(),
          }
        : null,
      overlay: state.overlay
        ? {
            type: state.overlay.type,
            id: state.overlay.id || null,
            page: Number.isFinite(state.overlay.page) ? state.overlay.page + 1 : null,
            totalPages: state.overlay.pages?.length || null,
            pageTitle: state.overlay.pages?.[state.overlay.page]?.title || null,
          }
        : null,
      collection: {
        clues: [...state.clues],
        achievements: [...state.achievements],
        codex: [...state.codex],
        codexQueue: [...state.codexQueue],
      },
      scores: { ...state.scores },
      flags: { ...state.flags },
      finalComplete: state.finalComplete,
      muted: state.muted,
      aiDisclosure: {
        label: AI_DISCLOSURE,
        titleButtonVisible: state.mode === "title",
        gameplayWatermarkVisible: state.mode === "play" || state.mode === "dialogue",
        overlayOpen: state.overlay?.type === "aiDisclosure",
      },
      render: {
        logicalWidth: W,
        logicalHeight: H,
        devicePixelRatio: window.devicePixelRatio || 1,
        renderScale: renderDpr,
        backingWidth: canvas.width,
        backingHeight: canvas.height,
      },
      assets: {
        loaded: Object.keys(assets).length,
        total: totalAssets,
        failed: failedAssets,
      },
      transition: Boolean(state.transition),
      toasts: state.toasts.map((item) => item.text),
    });
  };

  window.addEventListener("resize", () => {
    configureCanvasResolution();
    render();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) autosave();
  });

  preloadAssets();
  window.requestAnimationFrame(frame);
})();
