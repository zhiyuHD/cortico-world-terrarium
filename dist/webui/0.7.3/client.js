// node_modules/.pnpm/cortico@0.2.1/node_modules/cortico/src/core/language.ts
function baseLanguage(language) {
  return language === "zh" || language === "zh-Hant" ? "zh" : "en";
}
function isPlainObject(value) {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function pick(language, table) {
  const base = table[baseLanguage(language)];
  if (language === "zh" || language === "en") return base;
  const own = table[language];
  if (own === void 0) return base;
  if (!isPlainObject(own) || !isPlainObject(base)) return own;
  const merged = { ...base };
  for (const [key, value] of Object.entries(own)) {
    if (value !== void 0) merged[key] = value;
  }
  return merged;
}

// webui/playback.ts
function createPlaybackControls(container, createRenderer, language = "zh") {
  const copy = language === "zh" ? { title: "\u6355\u98DF\u56DE\u653E", empty: "\u6682\u65E0\u6355\u98DF\u8BB0\u5F55", play: "\u64AD\u653E", pause: "\u6682\u505C", frames: ["\u79FB\u52A8\u524D", "\u63A5\u89E6\u730E\u7269", "\u6355\u98DF\u540E"], select: "\u9009\u62E9\u6355\u98DF\u8BB0\u5F55", frame: "\u56DE\u653E\u5E27" } : { title: "Hunt replays", empty: "No recorded hunts", play: "Play", pause: "Pause", frames: ["Before movement", "Contact", "After capture"], select: "Choose a hunt", frame: "Replay frame" };
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = copy.title;
  const select = document.createElement("select");
  select.setAttribute("aria-label", copy.select);
  const play = document.createElement("button");
  play.type = "button";
  play.textContent = copy.play;
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "2";
  slider.step = "1";
  slider.value = "0";
  slider.setAttribute("aria-label", copy.frame);
  const label = document.createElement("p");
  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 500;
  canvas.style.width = "100%";
  canvas.style.maxWidth = "800px";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", copy.title);
  const scene = createRenderer(canvas);
  details.append(summary, select, play, slider, label, canvas);
  container.append(details);
  let replays = [];
  let timer;
  let disposed = false;
  const stop = () => {
    clearTimeout(timer);
    timer = void 0;
    play.textContent = copy.play;
  };
  const render = () => {
    const replay = replays.find((replay2) => replay2.id === select.value);
    canvas.hidden = !replay;
    select.disabled = play.disabled = slider.disabled = !replay;
    if (!replay) {
      label.textContent = copy.empty;
      return;
    }
    const index = Number(slider.value);
    label.textContent = `${new Date(replay.recordedAtMs).toLocaleString(language)} \xB7 ${replay.hunterId} \u2192 ${replay.preyId} \xB7 ${copy.frames[index]}`;
    slider.setAttribute("aria-valuetext", copy.frames[index]);
    scene.setState(replay.frames[index], replay.recordedAtMs);
  };
  const advance = () => {
    if (disposed) return;
    slider.value = String(Number(slider.value) + 1);
    render();
    if (Number(slider.value) < 2) timer = setTimeout(advance, 1500);
    else stop();
  };
  play.addEventListener("click", () => {
    if (timer !== void 0) {
      stop();
      return;
    }
    slider.value = "0";
    render();
    play.textContent = copy.pause;
    timer = setTimeout(advance, 1500);
  });
  slider.addEventListener("input", () => {
    stop();
    render();
  });
  select.addEventListener("change", () => {
    stop();
    slider.value = "0";
    render();
  });
  render();
  return {
    setReplays(next) {
      if (disposed) return;
      const selected = select.value;
      const retained = next.some((replay) => replay.id === selected);
      replays = next;
      select.replaceChildren(...[...next].reverse().map((replay) => {
        const option = document.createElement("option");
        option.value = replay.id;
        option.textContent = `${new Date(replay.recordedAtMs).toLocaleString(language)} \xB7 ${replay.hunterId} \u2192 ${replay.preyId}`;
        return option;
      }));
      if (retained) select.value = selected;
      else {
        stop();
        slider.value = "0";
        render();
      }
    },
    dispose() {
      disposed = true;
      stop();
      scene.dispose();
      details.remove();
    }
  };
}

// webui/water-scene.ts
function createWaterScene(canvas) {
  let state;
  let old = /* @__PURE__ */ new Map();
  let movedAt = 0;
  let request = 0;
  let disposed = false;
  const position = (x, y) => ({ x: 130 + x * 130, y: 130 + y * 65 });
  const locations = (now) => new Map((state?.fish ?? []).map((fish) => {
    const previous = old.get(fish.id) ?? fish;
    const t = Math.min(1, (now - movedAt) / 900);
    return [fish.id, { x: previous.x + (fish.x - previous.x) * t, y: previous.y + (fish.y - previous.y) * t }];
  }));
  const render = (now) => {
    if (disposed || !state) return;
    const g = canvas.getContext("2d");
    if (g) {
      const night = state.phase === "night";
      g.fillStyle = night ? "#102e4b" : "#cbe9f1";
      g.fillRect(0, 0, 800, 500);
      const water = g.createLinearGradient(0, 70, 0, 470);
      water.addColorStop(0, night ? "#174762" : "#71c6db");
      water.addColorStop(1, night ? "#153540" : "#4193ac");
      g.fillStyle = water;
      g.beginPath();
      g.roundRect(60, 70, 680, 400, 20);
      g.fill();
      g.strokeStyle = "#d6f3ed";
      g.lineWidth = 7;
      g.stroke();
      g.fillStyle = "#b8a789";
      g.fillRect(66, 435, 668, 27);
      g.font = "16px system-ui";
      g.fillStyle = night ? "#def5fa" : "#164257";
      g.fillText(`O\u2082 ${state.oxygen.toFixed(1)} \xB7 ${state.cleanliness.toFixed(1)} / 100`, 72, 42);
      g.lineWidth = 1;
      g.strokeStyle = "#ffffff25";
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
        const p = position(x, y);
        g.strokeRect(p.x - 50, p.y - 25, 100, 50);
      }
      for (const plant of state.plants) {
        const p = position(plant.x, plant.y), h = 22 + plant.stage * 9;
        g.strokeStyle = plant.species === "algae" ? "#506f37" : "#236e46";
        g.lineWidth = 5;
        for (let strand = -1; strand <= 1; strand++) {
          g.beginPath();
          g.moveTo(p.x + strand * 10, p.y + 22);
          g.quadraticCurveTo(p.x + strand * 18 + Math.sin(now / 1e3) * 2, p.y, p.x + strand * 12, p.y + 22 - h);
          g.stroke();
        }
        if (plant.species === "waterlily") {
          g.fillStyle = "#e7b8cf";
          g.beginPath();
          g.ellipse(p.x, p.y - h + 22, 13, 6, 0, 0, Math.PI * 2);
          g.fill();
        }
      }
      for (const food of state.food) {
        const p = position(food.x, food.y);
        g.fillStyle = "#f4ca77";
        for (let i = 0; i < food.portions; i++) {
          g.beginPath();
          g.arc(p.x + i % 4 * 5 - 8, p.y + Math.floor(i / 4) * 5, 2, 0, Math.PI * 2);
          g.fill();
        }
      }
      const points = locations(now);
      for (const fish of state.fish) {
        const p = position(points.get(fish.id).x, points.get(fish.id).y);
        const companions = state.fish.filter((other) => other.x === fish.x && other.y === fish.y).map((other) => other.id).sort();
        p.y += (companions.indexOf(fish.id) - (companions.length - 1) / 2) * 15;
        g.fillStyle = fish.species === "goldfish" ? "#f3a545" : fish.species === "perch" ? "#718f78" : "#b9b3e5";
        g.beginPath();
        g.moveTo(p.x - 15, p.y);
        g.lineTo(p.x - 30, p.y - 12);
        g.lineTo(p.x - 30, p.y + 12);
        g.closePath();
        g.fill();
        g.beginPath();
        g.ellipse(p.x, p.y, fish.species === "perch" ? 24 : 18, 11, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#172e38";
        g.beginPath();
        g.arc(p.x + 10, p.y - 3, 2, 0, Math.PI * 2);
        g.fill();
      }
    }
    request = requestAnimationFrame(render);
  };
  return {
    setState(next) {
      if (disposed) return;
      const now = performance.now();
      const current = locations(now);
      if (next.fish.some((fish) => {
        const previous = state?.fish.find((other) => other.id === fish.id);
        return previous && (previous.x !== fish.x || previous.y !== fish.y);
      })) {
        old = current;
        movedAt = now;
      }
      state = next;
      if (!request) request = requestAnimationFrame(render);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(request);
    }
  };
}
function createWaterReplayControls(container, language = "zh") {
  return createPlaybackControls(container, createWaterScene, language);
}

// webui/water-client.ts
function mountWater(ctx) {
  const zh = ctx.language === "zh";
  const card = ctx.ui.sheet({ title: "\u751F\u6001\u7BB1\xB7\u6C34", en: "Terrarium \xB7 Water" });
  const title = ctx.ui.h("h2", "");
  const status = ctx.ui.msgline(zh ? "\u8BFB\u53D6\u4E2D" : "Loading");
  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 500;
  canvas.className = "terrarium-scene";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", zh ? "\u751F\u6001\u7BB1\xB7\u6C34" : "Water aquarium");
  const details = ctx.ui.h("div", "terrarium-details");
  const replayContainer = ctx.ui.h("div", "terrarium-replays");
  const history = ctx.ui.h("div", "");
  const scene = createWaterScene(canvas), replay = createWaterReplayControls(replayContainer, zh ? "zh" : "en");
  ctx.signal.addEventListener("abort", () => {
    scene.dispose();
    replay.dispose();
  }, { once: true });
  const refresh = ctx.ui.button(zh ? "\u5237\u65B0" : "Refresh", { size: "sm", onClick: () => {
    void load();
  } });
  card.body.append(title, status, canvas, details, replayContainer, history, refresh);
  ctx.root.append(card.el);
  const load = async () => {
    try {
      const response = await ctx.invoke("state");
      if (ctx.signal.aborted) return;
      for (const el of [canvas, details, replayContainer, history]) el.hidden = !response.claimed;
      if (!response.claimed || !response.state) {
        status.textContent = zh ? "\u672A\u8BA4\u9886" : "Unclaimed";
        return;
      }
      const state = response.state;
      title.textContent = state.name ?? (zh ? "\u751F\u6001\u7BB1\xB7\u6C34" : "Terrarium \xB7 Water");
      status.textContent = `${state.phase === "day" ? zh ? "\u767D\u5929" : "Day" : zh ? "\u591C\u665A" : "Night"}${response.id ? ` \xB7 ID ${response.id}` : ""} \xB7 ${zh ? "\u542B\u6C27\u91CF" : "Oxygen"} ${state.oxygen.toFixed(1)} \xB7 ${zh ? "\u6C34\u8D28" : "Cleanliness"} ${state.cleanliness.toFixed(1)}`;
      scene.setState(state);
      replay.setReplays(state.replays);
      const names = zh ? { guppy: "\u5B54\u96C0\u9C7C", goldfish: "\u91D1\u9C7C", perch: "\u9C88\u9C7C", waterweed: "\u6C34\u8349", waterlily: "\u7761\u83B2", algae: "\u6D77\u85FB" } : {};
      details.replaceChildren(...state.fish.map((fish) => ctx.ui.h("div", "terrarium-plant", `${fish.id} \xB7 ${names[fish.species] ?? fish.species} \xB7 (${fish.x},${fish.y}) \xB7 ${zh ? "\u4F53\u529B" : "Energy"} ${fish.energy.toFixed(1)} \xB7 HP ${fish.health.toFixed(1)}`)), ...state.plants.map((plant) => ctx.ui.h("div", "terrarium-plant", `${plant.id} \xB7 ${names[plant.species] ?? plant.species} \xB7 ${zh ? "\u9636\u6BB5" : "Stage"} ${plant.stage} \xB7 HP ${plant.health.toFixed(1)}`)), ctx.ui.h("div", "", `${zh ? "\u9972\u6599" : "Food"} ${state.food.reduce((n, food) => n + food.portions, 0)}`));
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 800 160");
      svg.classList.add("terrarium-history");
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", zh ? "\u5C0F\u65F6\u5386\u53F2\uFF1A\u84DD\u8272\u4E3A\u542B\u6C27\u91CF\uFF0C\u7EFF\u8272\u4E3A\u6C34\u8D28" : "Hourly history: blue oxygen, green cleanliness");
      for (const [key, color] of [["oxygen", "#287cb3"], ["cleanliness", "#258568"]]) {
        const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
        line.setAttribute("fill", "none");
        line.setAttribute("stroke", color);
        line.setAttribute("stroke-width", "2");
        line.setAttribute("points", state.history.map((sample, i) => `${20 + i * 760 / Math.max(1, state.history.length - 1)},${140 - sample[key] * 1.2}`).join(" "));
        svg.append(line);
      }
      history.replaceChildren(ctx.ui.h("h3", "", pick(ctx.language, { zh: "\u5C0F\u65F6\u5386\u53F2 \xB7 \u84DD\u8272\uFF1A\u542B\u6C27\u91CF / \u7EFF\u8272\uFF1A\u6C34\u8D28", en: "Hourly history \xB7 Blue: oxygen / Green: cleanliness" })), svg);
    } catch (error) {
      if (!ctx.signal.aborted) status.textContent = error instanceof Error ? error.message : String(error);
    }
  };
  void load();
  ctx.interval(() => {
    void load();
  }, 5e3);
}

// src/colony.ts
var TERRARIUM_NEST_SIZE = 4;
function nestContents(state, nest) {
  const ants = state.bugs.filter((bug) => bug.species === "ant" && bug.inside?.nestId === nest.id);
  const eggs = (state.eggs ?? []).filter((egg) => egg.species === "ant" && egg.inside?.nestId === nest.id);
  return { ants, eggs, queens: ants.filter((ant) => ant.role === "queen").length, food: nest.food };
}

// webui/nest-viewer.ts
var STYLE = `
.tn-dialog{box-sizing:border-box;width:min(720px,calc(100vw - 24px));max-height:calc(100dvh - 32px);padding:0;border:1px solid #c0ac85;border-radius:24px;background:#f7f1e4;color:#473c2e;box-shadow:0 30px 120px #17170e55;font:14px/1.5 system-ui,sans-serif;overflow:auto}
.tn-dialog::backdrop{background:#18251dd0;backdrop-filter:blur(7px)}.tn-head{padding:22px 24px 12px;display:flex;justify-content:space-between;gap:16px;align-items:center}.tn-head h2{font-size:22px;margin:0;font-weight:600}.tn-kicker{font:10px monospace;letter-spacing:2px;color:#8c7b5f;margin-bottom:5px}
.tn-dialog{overscroll-behavior:contain}.tn-head{position:sticky;top:0;z-index:2;background:#f7f1e4}
.tn-close,.tn-open{font:inherit;cursor:pointer;border:1px solid #b6aa88;border-radius:24px;background:#fffaf0;color:#4c573a;padding:8px 15px;transition:background .2s,transform .2s}.tn-close:hover,.tn-open:hover{background:#e8e4d1;transform:translateY(-1px)}.tn-toolbar{position:relative;display:flex;gap:6px;flex-wrap:wrap;z-index:1}.scene-wrap>.tn-toolbar{position:absolute;left:12px;bottom:10px}.tn-toolbar[hidden]{display:none}.tn-open{font-size:11px;padding:5px 11px;background:#fff9e8e8;backdrop-filter:blur(8px)}
.tn-summary{display:flex;flex-wrap:wrap;gap:8px;padding:0 24px 16px}.tn-summary span{background:#e9e2cd;border-radius:8px;padding:6px 10px;font-size:12px;font-variant-numeric:tabular-nums}
.tn-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;padding:18px;margin:0 24px;background:#796448;border:1px solid #6b593f;border-radius:18px;box-shadow:inset 0 3px 15px #3d2d2030}
.tn-cell{position:relative;box-sizing:border-box;width:100%;min-width:0;min-height:94px;aspect-ratio:1;overflow:hidden;border:1px solid #c6ac78;border-radius:19% 28% 23% 26%;background:radial-gradient(ellipse at 40% 35%,#a68a5e,#967347);color:#fff2d2;cursor:pointer;box-shadow:inset 0 3px 10px #3f2b2030,0 2px 2px #30251d28;font:inherit;padding:8px;transition:background .2s,box-shadow .2s}
.tn-cell:hover,.tn-cell[aria-pressed=true]{background:radial-gradient(ellipse at 40% 35%,#b79b6a,#a7804c);box-shadow:inset 0 0 0 2px #f3dba5,0 2px 8px #30251d30}.tn-cell:focus-visible,.tn-close:focus-visible,.tn-open:focus-visible{outline:3px solid #9cbd9a;outline-offset:3px}
.tn-cell-label{position:absolute;left:9px;top:6px;font-size:10px;color:#f6e7c3c9}.tn-occupants{position:absolute;inset:38px 5px 20px;display:flex;justify-content:center;align-items:center;gap:6px;overflow:hidden}.tn-ant{display:inline-flex;flex:0 1 auto;min-width:0;width:40px;height:30px;--ant-abdomen:#b77a50;--ant-head:#d7a171;--ant-chest:#c48a5c}.tn-ant svg{display:block;width:100%;height:100%;overflow:visible}.tn-ant.queen{width:46px;height:34px;--ant-abdomen:#c6984f;--ant-head:#e3b97e;--ant-chest:#d2a164}.tn-eggs{display:flex;flex:0 0 16px;flex-wrap:wrap;align-content:center;justify-content:center;gap:2px}.tn-egg{display:inline-block;width:6px;height:8px;border-radius:60% 50% 55% 45%;background:#fff1ce;box-shadow:inset -2px -1px 1px #d4bd91;transform:rotate(25deg)}.tn-food{flex:0 0 auto;white-space:nowrap;font-size:13px;color:#ffe2a1;font-variant-numeric:tabular-nums}.tn-cell-count{position:absolute;bottom:5px;right:8px;font-size:10px;color:#fff0ce}.tn-detail{padding:16px 24px 22px;min-height:65px}.tn-detail h3{font-size:13px;margin:0 0 5px}.tn-detail p{font-size:12px;margin:3px 0;color:#7b6a50;overflow-wrap:anywhere}.tn-note{padding:0 24px 18px;font-size:12px;color:#85755b}
@media(max-width:480px){.tn-head{padding:16px 16px 12px}.tn-head h2{font-size:19px}.tn-grid{padding:10px;margin:0 12px;gap:6px}.tn-cell{padding:5px}.tn-cell-label{font-size:8px;left:5px}.tn-occupants{gap:3px;inset:38px 3px 18px}.tn-summary{padding:0 16px 12px;gap:5px}.tn-summary span{font-size:11px;padding:4px 7px}.tn-detail{padding:14px 16px}.tn-cell-count{font-size:8px;right:5px}.tn-ant{width:34px;height:26px}.tn-ant.queen{width:40px;height:30px}.tn-ant~.tn-ant{display:none}.tn-eggs{flex-basis:12px}.tn-egg{width:5px;height:7px}.tn-food{font-size:10px}}
@media(prefers-reduced-motion:reduce){.tn-cell,.tn-open,.tn-close{transition:none}}
.tn-cell.has-queen{border-color:#ffdd8a;box-shadow:inset 0 0 0 1px #edce8d,0 0 9px #f8d87b35}.tn-queen-badge{position:absolute;right:6px;top:20px;border:1px solid #ffe8ab;border-radius:5px;padding:1px 4px;background:#f3d58b;color:#563d1c;font-size:10px;font-weight:600;line-height:1.3}.tn-cell-count{left:3px;right:3px;text-align:center;white-space:nowrap}.tn-time{font-variant-numeric:tabular-nums}
@media(max-width:480px){.tn-cell-label{font-size:9px}.tn-cell-count,.tn-queen-badge{font-size:9px}}
@media(max-width:360px){.tn-ant{width:24px;height:18px}.tn-ant.queen{width:28px;height:21px}.tn-eggs{flex-basis:10px;gap:1px}.tn-egg{width:4px;height:6px}}
@media(pointer:coarse){.tn-open,.tn-close{min-height:44px;padding:9px 14px}}
`;
var ANT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 36" fill="none" focusable="false">
  <ellipse cx="23" cy="32" rx="17" ry="1.8" fill="#60432b" opacity=".15"/>
  <g stroke="#9c7152" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M15 19Q10 21 10 26M22 19Q21 22 22 26M28 19Q32 21 33 25"/>
  </g>
  <g stroke="#80543d" stroke-width="1.8" stroke-linecap="round">
    <path d="M31 9Q29 3 26 5M36 9Q38 3 41 5"/>
  </g>
  <g stroke="#81553b" stroke-width="1.1">
    <ellipse cx="13" cy="20" rx="9" ry="7" fill="var(--ant-abdomen)"/>
    <ellipse cx="23" cy="21" rx="5" ry="4.8" fill="var(--ant-chest)"/>
    <ellipse cx="33" cy="15" rx="8" ry="7.8" fill="var(--ant-head)"/>
  </g>
  <ellipse cx="10" cy="17" rx="3.8" ry="1.7" transform="rotate(-24 10 17)" fill="#ffe4b2" opacity=".45"/>
  <path d="M17 24Q16 29 12 29M23 25Q23 30 20 30M28 23Q31 28 34 28" stroke="#80543d" stroke-width="2.3" stroke-linecap="round"/>
  <g fill="#fff6df"><ellipse cx="30" cy="13.5" rx="2.1" ry="2.4"/><ellipse cx="36" cy="13.5" rx="2.1" ry="2.4"/></g>
  <g fill="#594132"><circle cx="30.6" cy="13.8" r="1.15"/><circle cx="36.6" cy="13.8" r="1.15"/></g>
  <g fill="#fffaf0"><circle cx="30.9" cy="13.2" r=".45"/><circle cx="36.9" cy="13.2" r=".45"/></g>
  <ellipse cx="28" cy="18" rx="1.7" ry="1" fill="#d98c70" opacity=".55"/>
  <path d="M32 18Q34 20.5 36 18" stroke="#81553b" stroke-width="1.1" stroke-linecap="round"/>
</svg>`;
function createNestViewer(canvas, language = "zh") {
  const doc = canvas.ownerDocument;
  if (!doc.getElementById("terrarium-nest-style")) {
    const style = doc.createElement("style");
    style.id = "terrarium-nest-style";
    style.textContent = STYLE;
    doc.head.append(style);
  }
  const zh = language === "zh";
  const text = zh ? { title: "\u8681\u5DE2\u5185\u90E8", enter: "\u8FDB\u5165\u8681\u5DE2", close: "\u8FD4\u56DE\u751F\u6001\u7BB1", ant: "\u8682\u8681", egg: "\u5375", queen: "\u8681\u540E", worker: "\u5DE5\u8681", food: "\u50A8\u7CAE", entrance: "\u5165\u53E3", storage: "\u7CAE\u4ED3", nursery: "\u80B2\u5E7C\u5BA4", room: "\u5DE2\u5BA4", empty: "\u6B64\u683C\u6CA1\u6709\u8682\u8681\u6216\u5375\u3002", legacy: "\u8BE5\u5BA2\u6237\u7AEF\u5C1A\u672A\u4E0A\u62A5\u8681\u5DE2\u5185\u90E8\u72B6\u6001\uFF1B\u5347\u7EA7 World \u540E\u53EF\u67E5\u770B\u8681\u540E\u4E0E\u5DE2\u5185\u751F\u7269\u3002" } : { title: "Inside the nest", enter: "Enter nest", close: "Back to terrarium", ant: "Ants", egg: "Eggs", queen: "Queen", worker: "Worker", food: "Food", entrance: "Entrance", storage: "Pantry", nursery: "Nursery", room: "Chamber", empty: "No ants or eggs in this cell.", legacy: "This client has not reported colony locations. Upgrade the World to see the queen and nest residents." };
  const el = (tag, cls, label) => {
    const node = doc.createElement(tag);
    node.className = cls;
    if (label !== void 0) node.textContent = label;
    return node;
  };
  const toolbar = el("div", "tn-toolbar"), dialog = el("dialog", "tn-dialog");
  const head = el("div", "tn-head"), title = el("h2", "", text.title), close = el("button", "tn-close", text.close);
  close.type = "button";
  const heading = el("div", "");
  heading.append(el("div", "tn-kicker", "COLONY / 4 \xD7 4"), title);
  head.append(heading, close);
  const summary = el("div", "tn-summary");
  summary.setAttribute("aria-live", "polite");
  const grid = el("div", "tn-grid");
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", zh ? "4\xD74 \u8681\u5DE2\u683C\u5B50" : "4 by 4 nest cells");
  const detail = el("div", "tn-detail");
  detail.setAttribute("aria-live", "polite");
  const note = el("p", "tn-note", text.legacy);
  dialog.append(head, summary, grid, detail, note);
  doc.body.append(dialog);
  dialog.setAttribute("aria-label", text.title);
  let state = null, selectedId = null, cellIndex = 10, recordedAtMs;
  const triggers = /* @__PURE__ */ new Map();
  let returnView = null;
  const cells = Array.from({ length: TERRARIUM_NEST_SIZE ** 2 }, (_, index) => {
    const cell = el("button", "tn-cell");
    cell.type = "button";
    cell.addEventListener("click", () => {
      cellIndex = index;
      render();
    });
    grid.append(cell);
    return cell;
  });
  const roomName = (x, y) => x === 0 && y === 0 ? text.entrance : x === 3 && y === 0 ? text.storage : x === 2 && y === 2 ? text.nursery : text.room;
  const remainingTime = (hatchesAtMs) => {
    const minutes = Math.ceil((hatchesAtMs - (recordedAtMs ?? Date.now())) / 6e4);
    if (minutes <= 0) return zh ? "\u7B49\u5F85\u5B75\u5316" : "Awaiting hatching";
    const hours = Math.floor(minutes / 60), rest = minutes % 60;
    const duration = zh ? `${hours ? `${hours} \u5C0F\u65F6` : ""}${rest ? `${hours ? " " : ""}${rest} \u5206\u949F` : ""}` : `${hours ? `${hours}h` : ""}${rest ? `${hours ? " " : ""}${rest}m` : ""}`;
    return zh ? `\u9884\u8BA1 ${duration}\u540E\u5B75\u5316` : `Hatches in about ${duration}`;
  };
  const render = () => {
    const nest = state?.nests?.find((nest2) => nest2.id === selectedId);
    if (!state || !nest) {
      if (dialog.open) dialog.close();
      return;
    }
    const contents = nestContents(state, nest);
    title.textContent = `${text.title} \xB7 ${nest.id}`;
    summary.replaceChildren(...[`${text.ant} ${contents.ants.length}`, `${text.queen} ${contents.queens}`, `${text.egg} ${contents.eggs.length}`, `${text.food} ${contents.food}/${nest.depth * 20}`].map((label) => el("span", "", label)));
    note.hidden = state.bugs.some((bug) => bug.species === "ant" && bug.role !== void 0);
    for (const [index, cell] of cells.entries()) {
      const x = index % TERRARIUM_NEST_SIZE, y = Math.floor(index / TERRARIUM_NEST_SIZE);
      const ants = contents.ants.filter((ant) => ant.inside.x === x && ant.inside.y === y), eggs = contents.eggs.filter((egg) => egg.inside.x === x && egg.inside.y === y);
      const hasQueen = ants.some((ant) => ant.role === "queen");
      cell.classList.toggle("has-queen", hasQueen);
      cell.setAttribute("aria-pressed", String(index === cellIndex));
      cell.setAttribute("aria-label", `${roomName(x, y)} (${x},${y}), ${text.ant} ${ants.length}, ${text.egg} ${eggs.length}${hasQueen ? `, ${text.queen}` : ""}`);
      const occupants = el("span", "tn-occupants");
      const visibleAnts = [...ants].sort((a, b) => Number(b.role === "queen") - Number(a.role === "queen")).slice(0, 2);
      for (const ant of visibleAnts) {
        const icon = el("span", "tn-ant" + (ant.role === "queen" ? " queen" : ""));
        icon.innerHTML = ANT_SVG;
        icon.title = `${ant.id} \xB7 ${ant.role === "queen" ? text.queen : text.worker}`;
        icon.setAttribute("aria-hidden", "true");
        occupants.append(icon);
      }
      if (eggs.length) {
        const cluster = el("span", "tn-eggs");
        cluster.setAttribute("aria-hidden", "true");
        for (let i = 0; i < Math.min(3, eggs.length); i++) cluster.append(el("span", "tn-egg"));
        occupants.append(cluster);
      }
      if (x === 3 && y === 0 && nest.food) occupants.append(el("span", "tn-food", `\u25CF ${nest.food}`));
      cell.replaceChildren(el("span", "tn-cell-label", `${roomName(x, y)} ${x},${y}`), occupants, el("span", "tn-cell-count", `${zh ? "\u8681" : "Ant"} ${ants.length} \xB7 ${zh ? "\u5375" : "Egg"} ${eggs.length}`));
      if (hasQueen) cell.append(el("span", "tn-queen-badge", text.queen));
      if (index === cellIndex) {
        detail.replaceChildren(el("h3", "", `${roomName(x, y)} (${x},${y})`));
        if (!ants.length && !eggs.length) detail.append(el("p", "", text.empty));
        if (x === 3 && y === 0) detail.append(el("p", "", `${text.food}: ${nest.food}`));
        for (const ant of ants) detail.append(el("p", "", `${ant.id} \xB7 ${ant.role === "queen" ? text.queen : text.worker}${ant.energy === void 0 ? "" : ` \xB7 ${zh ? "\u4F53\u529B" : "Energy"} ${ant.energy.toFixed(0)}`}`));
        for (const egg of eggs) {
          const row = el("p", "", `${egg.id} \xB7 ${remainingTime(egg.hatchesAtMs)} \xB7 `);
          const time = el("time", "tn-time", new Date(egg.hatchesAtMs).toLocaleString(zh ? "zh-CN" : "en"));
          time.dateTime = new Date(egg.hatchesAtMs).toISOString();
          row.append(time);
          detail.append(row);
        }
      }
    }
  };
  const restoreView = () => {
    if (dialog.open || !returnView) return;
    const saved = returnView;
    returnView = null;
    if (saved.opener.isConnected) saved.opener.focus({ preventScroll: true });
    for (const { node, x, y } of saved.ancestors) if (node.isConnected) node.scrollTo({ left: x, top: y, behavior: "instant" });
    doc.defaultView.scrollTo({ left: saved.x, top: saved.y, behavior: "instant" });
  };
  const open = (nest, opener) => {
    selectedId = nest.id;
    render();
    if (dialog.open) return;
    const ancestors = [];
    for (let node = canvas.parentElement; node; node = node.parentElement) ancestors.push({ node, x: node.scrollLeft, y: node.scrollTop });
    returnView = { opener, x: doc.defaultView.scrollX, y: doc.defaultView.scrollY, ancestors };
    opener.focus({ preventScroll: true });
    dialog.showModal();
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) dialog.animate([{ opacity: 0, transform: "translateY(16px) scale(.98)" }, { opacity: 1, transform: "none" }], { duration: 240, easing: "ease-out" });
  };
  const hit = (event) => {
    const bounds = canvas.getBoundingClientRect();
    const rx = Math.max(24, 30 * bounds.width / canvas.width), ry = Math.max(24, 20 * bounds.height / canvas.height);
    const targets = (state?.nests ?? []).map((nest2) => ({
      nest: nest2,
      dx: event.clientX - bounds.left - (260 + nest2.x * 70) * bounds.width / canvas.width,
      dy: event.clientY - bounds.top - (290 + nest2.y * 9) * bounds.height / canvas.height
    })).filter(({ dx, dy }) => Math.abs(dx) <= rx && Math.abs(dy) <= ry);
    targets.sort((a, b) => a.dx ** 2 + a.dy ** 2 - b.dx ** 2 - b.dy ** 2);
    const nest = targets[0]?.nest;
    if (nest) open(nest, triggers.get(nest.id) ?? canvas);
  };
  dialog.addEventListener("close", restoreView);
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
    }
  });
  canvas.addEventListener("click", hit);
  let nestIds = "";
  return {
    setState(next, atMs) {
      state = next;
      recordedAtMs = atMs;
      const nests = next.nests ?? [];
      if (canvas.parentElement && toolbar.parentElement !== canvas.parentElement) canvas.after(toolbar);
      const ids = nests.map((nest) => nest.id).join(",");
      if (ids !== nestIds) {
        nestIds = ids;
        triggers.clear();
        toolbar.replaceChildren(...nests.map((nest) => {
          const button = el("button", "tn-open", `${text.enter} \xB7 ${nest.id}`);
          button.type = "button";
          triggers.set(nest.id, button);
          button.addEventListener("click", () => {
            const current = state?.nests?.find((current2) => current2.id === nest.id);
            if (current) open(current, button);
          });
          return button;
        }));
      }
      toolbar.hidden = !nests.length;
      canvas.style.cursor = nests.length ? "pointer" : "";
      if (dialog.open) render();
    },
    dispose() {
      canvas.removeEventListener("click", hit);
      canvas.style.cursor = "";
      if (dialog.open) dialog.close();
      restoreView();
      dialog.removeEventListener("close", restoreView);
      toolbar.remove();
      dialog.remove();
    }
  };
}

// webui/nest-scene.ts
function drawAntNest(g, x, y, night) {
  g.save();
  g.fillStyle = "rgba(35,25,18,.2)";
  g.beginPath();
  g.ellipse(x + 2, y + 5, 24, 6, 0, 0, Math.PI * 2);
  g.fill();
  const mound = g.createLinearGradient(0, y - 9, 0, y + 6);
  mound.addColorStop(0, night ? "#a08b67" : "#dfbf87");
  mound.addColorStop(1, night ? "#67543b" : "#aa7e4e");
  g.fillStyle = mound;
  g.beginPath();
  g.moveTo(x - 23, y + 2);
  g.bezierCurveTo(x - 16, y, x - 14, y - 9, x - 3, y - 8);
  g.bezierCurveTo(x + 10, y - 10, x + 16, y - 1, x + 23, y + 3);
  g.bezierCurveTo(x + 12, y + 9, x - 16, y + 8, x - 23, y + 2);
  g.fill();
  g.strokeStyle = night ? "#b09a72" : "#f0d49b";
  g.lineWidth = 1.5;
  g.beginPath();
  g.ellipse(x - 1, y - 1, 10, 4.5, -0.1, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = night ? "#1c1b18" : "#30251e";
  g.beginPath();
  g.ellipse(x - 1, y, 8.5, 3.5, -0.1, 0, Math.PI * 2);
  g.fill();
  for (let pebble = 0; pebble < 9; pebble++) {
    const angle = pebble * 2.4;
    g.fillStyle = pebble % 2 ? night ? "#7f6b4e" : "#b48955" : night ? "#af966d" : "#edce91";
    g.beginPath();
    g.ellipse(x + Math.cos(angle) * (13 + pebble % 3 * 2), y + 2 + Math.sin(angle) * 3.5, 1.5, 0.9, angle, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

// src/habitat.ts
var TERRARIUM_PLANT_REQUIREMENTS = {
  fern: { minMoisture: 30, maxMoisture: 85, minLight: 0.15, maxLight: 0.7 },
  clover: { minMoisture: 20, maxMoisture: 80, minLight: 0.45, maxLight: 1 },
  moss: { minMoisture: 45, maxMoisture: 90, minLight: 0.15, maxLight: 0.4 },
  basil: { minMoisture: 30, maxMoisture: 75, minLight: 0.65, maxLight: 1 },
  bean: { minMoisture: 25, maxMoisture: 70, minLight: 0.7, maxLight: 1 }
};
function daylight(habitat, x, y) {
  const shaded = habitat.items.some((item) => item.id === "pebble" && Math.abs(item.x - x) + Math.abs(item.y - y) <= 1);
  return (0.6 + x * 0.1) * (shaded ? 0.35 : 1);
}

// webui/scene.ts
function plotPosition(x, y) {
  return { x: 260 + x * 70, y: 290 + y * 9 };
}
function bugPositions(bugs, positions = /* @__PURE__ */ new Map()) {
  const groups = /* @__PURE__ */ new Map();
  for (const bug of bugs) {
    const tile = `${bug.x},${bug.y}`;
    const group = groups.get(tile) ?? [];
    group.push(bug.id);
    groups.set(tile, group);
  }
  for (const group of groups.values()) group.sort();
  const result = /* @__PURE__ */ new Map();
  for (const bug of bugs) {
    const position = positions.get(bug.id) ?? bug;
    const group = groups.get(`${bug.x},${bug.y}`);
    const ordinal = group.indexOf(bug.id);
    const row = Math.floor(ordinal / 3);
    const rowSize = Math.min(3, group.length - row * 3);
    const plot = plotPosition(position.x, position.y);
    result.set(bug.id, { x: plot.x + (ordinal % 3 - (rowSize - 1) / 2) * 28, y: plot.y - 6 + row * 19 });
  }
  return result;
}
function drawScene(canvas, state, positions = /* @__PURE__ */ new Map(), hits = []) {
  const g = canvas.getContext("2d");
  if (!g) return;
  const night = state.phase === "night";
  const sky = g.createLinearGradient(0, 0, 0, 500);
  sky.addColorStop(0, night ? "#162c47" : "#9ccbcf");
  sky.addColorStop(1, night ? "#657b80" : "#e1e9bd");
  g.fillStyle = sky;
  g.fillRect(0, 0, 800, 500);
  g.fillStyle = night ? "#e8e7ce" : "#fff1a7";
  g.beginPath();
  g.arc(680, 83, night ? 23 : 32, 0, Math.PI * 2);
  g.fill();
  if (night) {
    g.fillStyle = "#d4e0e5";
    for (const [x, y] of [[65, 67], [151, 111], [307, 68], [460, 89], [570, 49], [741, 151]]) {
      g.beginPath();
      g.arc(x, y, 2, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.fillStyle = night ? "#415866" : "#91af91";
  g.beginPath();
  g.ellipse(400, 453, 350, 32, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = night ? "rgba(99,136,147,.2)" : "rgba(236,255,241,.25)";
  g.beginPath();
  g.roundRect(105, 125, 590, 285, 32);
  g.fill();
  g.fillStyle = night ? "#50493e" : "#715438";
  g.beginPath();
  g.roundRect(122, 306, 556, 93, [8, 8, 25, 25]);
  g.fill();
  g.fillStyle = night ? "#756b53" : "#a7875b";
  g.beginPath();
  g.ellipse(400, 310, 278, 29, 0, 0, Math.PI * 2);
  g.fill();
  for (const cell of state.soil ?? []) {
    const { x, y } = plotPosition(cell.x, cell.y);
    g.fillStyle = `rgba(36,91,107,${cell.moisture / 160})`;
    g.beginPath();
    g.ellipse(x, y + 1, 30, 5, 0, 0, Math.PI * 2);
    g.fill();
    if (daylight(state, cell.x, cell.y) < 0.4) {
      g.fillStyle = "rgba(20,30,40,.25)";
      g.beginPath();
      g.ellipse(x, y, 31, 6, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  for (const nest of state.nests ?? []) {
    const { x, y } = plotPosition(nest.x, nest.y);
    drawAntNest(g, x, y, night);
  }
  for (const food of state.food ?? []) {
    const { x, y } = plotPosition(food.x, food.y);
    g.fillStyle = "#e4b66c";
    for (let i = 0; i < Math.min(6, food.portions); i++) {
      g.beginPath();
      g.arc(x - 8 + i % 3 * 6, y + Math.floor(i / 3) * 5, 2.5, 0, Math.PI * 2);
      g.fill();
    }
  }
  for (const [index, egg] of (state.eggs ?? []).filter((egg2) => !egg2.inside).entries()) {
    const { x, y } = plotPosition(egg.x, egg.y);
    g.fillStyle = egg.species === "ant" ? "#eee2bd" : "#dbd9b0";
    g.beginPath();
    g.ellipse(x - 12 + index % 4 * 7, y - 4, 3, 4, -0.3, 0, Math.PI * 2);
    g.fill();
  }
  for (const plant of state.plants) {
    const { x, y: base } = plotPosition(plant.x, plant.y);
    const height = 13 + plant.stage * 20;
    const leaves = 1 + plant.stage * 2;
    g.strokeStyle = plant.dry ? "#87926a" : "#417e4c";
    g.lineWidth = 4 + plant.stage;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(x, base);
    g.quadraticCurveTo(x - 8, base - height * 0.6, x, base - height);
    g.stroke();
    for (let i = 0; i < leaves; i++) {
      const side = i % 2 ? -1 : 1;
      const y = base - height * (0.35 + 0.6 * i / Math.max(1, leaves - 1));
      g.fillStyle = plant.dry ? "#a4ad77" : i % 2 ? "#64aa6d" : "#7abb77";
      g.beginPath();
      g.ellipse(x + side * (9 + plant.stage * 3), y - 7, 11 + plant.stage * 3, plant.id === "fern" ? 7 : 11, -side * 0.45, 0, Math.PI * 2);
      g.fill();
    }
    if (plant.id === "clover" && plant.stage > 1) {
      g.fillStyle = plant.dry ? "#a4ad77" : "#74b878";
      for (const dx of [-8, 0, 8]) {
        g.beginPath();
        g.arc(x + dx, base - height, 9, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  for (const item of state.items) {
    const { x, y } = plotPosition(item.x, item.y);
    g.fillStyle = "rgba(30,28,23,.25)";
    g.beginPath();
    g.ellipse(x, y + 7, 21, 6, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = item.id === "coin" ? "#d0a34d" : "#919a94";
    g.beginPath();
    g.ellipse(x, y, item.id === "coin" ? 16 : 19, 10, -0.1, 0, Math.PI * 2);
    g.fill();
    if (item.id === "coin") {
      g.strokeStyle = "#f4d682";
      g.lineWidth = 2;
      g.stroke();
    }
  }
  for (const seed of state.seeds ?? []) {
    const { x, y } = plotPosition(seed.x, seed.y);
    g.fillStyle = "#d9bd75";
    g.beginPath();
    g.ellipse(x, y, 7, 4, -0.3, 0, Math.PI * 2);
    g.fill();
  }
  const surfaceBugs = state.bugs.filter((bug) => !bug.inside);
  const locations = bugPositions(surfaceBugs, positions);
  for (const bug of surfaceBugs) {
    const { x, y } = locations.get(bug.id);
    g.fillStyle = "rgba(33,28,20,.26)";
    g.beginPath();
    g.ellipse(x, y + 9, 14, 4, 0, 0, Math.PI * 2);
    g.fill();
    if (bug.species === "spider") {
      g.strokeStyle = "#282a36";
      g.lineWidth = 2.4;
      for (const side of [-1, 1]) for (let i = -1; i <= 1; i++) {
        g.beginPath();
        g.moveTo(x + side * 5, y + i * 3);
        g.lineTo(x + side * 16, y + i * 8);
        g.stroke();
      }
      g.fillStyle = "#393848";
      g.beginPath();
      g.arc(x, y, 9, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#e3ca9d";
      for (const dx of [-3, 3]) {
        g.beginPath();
        g.arc(x + dx, y - 3, 1.5, 0, Math.PI * 2);
        g.fill();
      }
    } else if (bug.species === "ant") {
      g.strokeStyle = "#3b2b24";
      g.lineWidth = 1.8;
      for (const side of [-1, 1]) for (const dx of [-5, 0, 5]) {
        g.beginPath();
        g.moveTo(x + dx, y);
        g.lineTo(x + dx - 2, y + side * 8);
        g.stroke();
      }
      g.fillStyle = "#493025";
      for (const [dx, radius] of [[-7, 5], [0, 3], [6, 4]]) {
        g.beginPath();
        g.ellipse(x + dx, y, radius, radius * 0.75, 0, 0, Math.PI * 2);
        g.fill();
      }
      for (const side of [-1, 1]) {
        g.beginPath();
        g.moveTo(x + 8, y + side * 2);
        g.lineTo(x + 14, y + side * 6);
        g.stroke();
      }
      if (bug.carrying) {
        g.fillStyle = "#edc06f";
        g.beginPath();
        g.arc(x + 13, y, 3, 0, Math.PI * 2);
        g.fill();
      }
    } else if (bug.species === "beetle") {
      g.fillStyle = "#684337";
      g.beginPath();
      g.ellipse(x, y, 13, 9, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#b57242";
      g.beginPath();
      g.ellipse(x, y - 2, 11, 7, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#58372f";
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(x, y - 9);
      g.lineTo(x, y + 5);
      g.stroke();
      g.fillStyle = "#2c2a26";
      g.beginPath();
      g.arc(x + 10, y + 1, 2, 0, Math.PI * 2);
      g.fill();
    } else {
      g.fillStyle = "#9bc96c";
      g.beginPath();
      g.ellipse(x, y, 10, 7, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#608943";
      g.lineWidth = 1.4;
      for (const side of [-1, 1]) for (const dx of [-4, 1, 5]) {
        g.beginPath();
        g.moveTo(x + dx, y + side * 4);
        g.lineTo(x + dx + 3, y + side * 10);
        g.stroke();
      }
      g.fillStyle = "#24352b";
      g.beginPath();
      g.arc(x + 5, y - 2, 1.5, 0, Math.PI * 2);
      g.fill();
    }
  }
  for (const hit of hits) {
    const { x, y } = plotPosition(hit.x, hit.y);
    g.strokeStyle = `rgba(255,210,91,${hit.strength})`;
    g.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      const angle = i * Math.PI / 3;
      g.beginPath();
      g.moveTo(x + Math.cos(angle) * 8, y + Math.sin(angle) * 8);
      g.lineTo(x + Math.cos(angle) * (13 + 12 * (1 - hit.strength)), y + Math.sin(angle) * (13 + 12 * (1 - hit.strength)));
      g.stroke();
    }
  }
  g.strokeStyle = "rgba(255,255,255,.4)";
  g.lineWidth = 12;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(142, 160);
  g.lineTo(142, 280);
  g.moveTo(168, 151);
  g.lineTo(168, 222);
  g.stroke();
  g.strokeStyle = night ? "#a7c1c7" : "#eff8ea";
  g.lineWidth = 9;
  g.beginPath();
  g.roundRect(105, 125, 590, 285, 32);
  g.stroke();
  g.fillStyle = night ? "#40555a" : "#72906f";
  g.beginPath();
  g.roundRect(160, 400, 480, 20, 10);
  g.fill();
}
function createLandRenderer(canvas) {
  let state = null;
  let previous = /* @__PURE__ */ new Map();
  let movedAt = 0;
  let hitAt = 0;
  let hits = [];
  let frame = 0;
  let disposed = false;
  const currentPositions = (now) => {
    return new Map((state?.bugs ?? []).map((bug) => {
      const old = previous.get(bug.id) ?? bug;
      const t = Math.min(1, (now - movedAt) / (bug.species === "ant" ? 350 : 900));
      return [bug.id, { x: old.x + (bug.x - old.x) * t, y: old.y + (bug.y - old.y) * t }];
    }));
  };
  const render = (now) => {
    if (disposed || !state) return;
    drawScene(canvas, state, currentPositions(now), hits.map((hit) => ({ ...hit, strength: Math.max(0, 1 - (now - hitAt) / 900) })));
    frame = requestAnimationFrame(render);
  };
  return {
    setState(next) {
      if (disposed) return;
      const now = performance.now();
      const removed = state ? state.bugs.filter((bug) => !next.bugs.some((current) => current.id === bug.id) && next.bugs.some((hunter) => hunter.x === bug.x && hunter.y === bug.y && (hunter.species === "spider" ? bug.species !== "spider" : hunter.species === "beetle" && bug.species === "aphid"))).map((bug) => ({ x: bug.x, y: bug.y })) : [];
      if (removed.length) {
        hits = removed;
        hitAt = now;
      }
      const oldPositions = currentPositions(now);
      const moved = next.bugs.some((bug) => {
        const old = state?.bugs.find((current) => current.id === bug.id);
        return old && (old.x !== bug.x || old.y !== bug.y);
      });
      if (moved) {
        previous = oldPositions;
        movedAt = now;
      }
      state = next;
      if (!frame) frame = requestAnimationFrame(render);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
    }
  };
}
function createScene(canvas, language = "zh") {
  const renderer = createLandRenderer(canvas);
  const viewer = createNestViewer(canvas, language);
  return {
    setState(state, recordedAtMs) {
      renderer.setState(state);
      viewer.setState(state, recordedAtMs);
    },
    dispose() {
      viewer.dispose();
      renderer.dispose();
    }
  };
}
function createReplayControls(container, language = "zh") {
  return createPlaybackControls(container, (canvas) => createScene(canvas, language), language);
}

// webui/history.ts
function historyPaths(points, maxValue) {
  const first = points[0]?.recordedAtMs ?? 0;
  const duration = Math.max(1, (points.at(-1)?.recordedAtMs ?? first) - first);
  const paths = [];
  let path = "";
  for (const point of points) {
    if (point.value === null) {
      if (path) paths.push(path);
      path = "";
    } else {
      const x = 44 + (point.recordedAtMs - first) / duration * 696;
      const y = 164 - point.value / maxValue * 140;
      path += `${path ? " L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
    }
  }
  if (path) paths.push(path);
  return paths;
}
function drawHistory(history, selected, labels, language) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 800 232");
  svg.setAttribute("role", "img");
  svg.classList.add("terrarium-history");
  const add = (tag, attrs, text) => {
    const node = document.createElementNS(ns, tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    if (text !== void 0) node.textContent = text;
    svg.append(node);
    return node;
  };
  add("title", {}, `${selected}: ${labels.moisture}, ${labels.health}, ${labels.stage}`);
  for (const value of [0, 50, 100]) {
    const y = String(164 - value * 1.4);
    add("line", { x1: "44", x2: "740", y1: y, y2: y, stroke: "currentColor", opacity: ".15" });
    add("text", { x: "36", y, "text-anchor": "end", fill: "currentColor", "font-size": "12" }, String(value));
  }
  const soil = selected.startsWith("soil:");
  const series = soil ? [{ label: labels.moisture, color: "#398db0", field: "moisture", max: 100 }] : [
    { label: labels.moisture, color: "#398db0", field: "moisture", max: 100 },
    { label: labels.health, color: "#44894c", field: "health", max: 100 },
    { label: `${labels.stage} (0\u20133)`, color: "#ac772c", field: "stage", max: 3 }
  ];
  if (history.length < 2) add("text", { x: "400", y: "96", "text-anchor": "middle", fill: "currentColor" }, labels.empty);
  for (const [i, line] of series.entries()) {
    const points = history.map((sample) => {
      const plant = sample.plants.find((plant2) => plant2.id === selected);
      const value = soil ? sample.soilMoisture[Number(selected.slice(5))] : plant?.[line.field];
      return { recordedAtMs: sample.recordedAtMs, value: value ?? null };
    });
    for (const d of historyPaths(points, line.max)) add("path", { d, fill: "none", stroke: line.color, "stroke-width": "2.5" });
    add("text", { x: String(44 + i * 220), y: "222", fill: line.color, "font-size": "14" }, line.label);
  }
  for (const [sample, x, anchor] of [[history[0], "44", "start"], [history.at(-1), "740", "end"]]) {
    if (sample) add("text", { x, y: "190", "text-anchor": anchor, fill: "currentColor", "font-size": "12" }, new Date(sample.recordedAtMs).toLocaleString(language));
  }
  return svg;
}

// webui/client.ts
function mount(ctx) {
  const copy = pick(ctx.language, {
    zh: { loading: "\u8BFB\u53D6\u4E2D", refresh: "\u5237\u65B0", day: "\u767D\u5929", night: "\u591C\u665A", fern: "\u8568\u8349", clover: "\u4E09\u53F6\u8349", stage: "\u9636\u6BB5", moisture: "\u6C34\u5206", dry: "\u571F\u58E4\u53D8\u5E72", scene: "\u7684\u751F\u6001\u7BB1", seed: "\u79CD\u5B50", bug: "\u866B\u5B50", egg: "\u5375", nest: "\u8681\u5DE2", food: "\u50A8\u7CAE", depth: "\u5C42", light: "\u5F53\u524D\u5149\u7167", soil: "\u571F\u58E4\u6C34\u5206", history: "\u5C0F\u65F6\u5386\u53F2 \xB7 \u6700\u8FD1\u4E03\u5929", health: "\u5065\u5EB7", empty: "\u7B49\u5F85\u7B2C\u4E8C\u4E2A\u5C0F\u65F6\u6837\u672C", needs: "\u751F\u957F\u6761\u4EF6\uFF08\u6C34\u5206 / \u767D\u5929\u5149\u7167\uFF09", plot: "\u683C\u5B50" },
    en: { loading: "Loading", refresh: "Refresh", day: "Day", night: "Night", fern: "Fern", clover: "Clover", stage: "stage", moisture: "moisture", dry: "dry soil", scene: " terrarium", seed: "seeds", bug: "bugs", egg: "eggs", nest: "ant nest", food: "stored food", depth: "levels", light: "Current light", soil: "Soil moisture", history: "Hourly history \xB7 Last seven days", health: "Health", empty: "Waiting for a second hourly sample", needs: "Growth conditions (moisture / daylight)", plot: "Cell" }
  });
  const card = ctx.ui.sheet({ title: "\u751F\u6001\u7BB1\xB7\u5730", en: "Terrarium \xB7 Land" });
  const name = ctx.ui.h("h2", "");
  const status = ctx.ui.msgline(copy.loading);
  const canvas = document.createElement("canvas");
  canvas.className = "terrarium-scene";
  canvas.width = 800;
  canvas.height = 500;
  canvas.setAttribute("role", "img");
  const scene = createScene(canvas, ctx.language.startsWith("zh") ? "zh" : "en");
  const replayContainer = ctx.ui.h("div", "terrarium-replays");
  const replay = createReplayControls(replayContainer, ctx.language === "zh" ? "zh" : "en");
  ctx.signal.addEventListener("abort", () => replay.dispose(), { once: true });
  ctx.signal.addEventListener("abort", () => scene.dispose(), { once: true });
  const details = ctx.ui.h("div", "terrarium-details");
  const refresh = ctx.ui.button(copy.refresh, { size: "sm", onClick: () => {
    void load();
  } });
  const habitat = ctx.ui.h("div", "terrarium-habitat");
  const grid = ctx.ui.h("div", "terrarium-grid");
  const cellStatus = ctx.ui.h("div", "terrarium-cell-status");
  const requirements = ctx.ui.h("div", "terrarium-requirements");
  habitat.append(grid, cellStatus, requirements);
  const historyTitle = ctx.ui.h("h3", "", copy.history);
  const select = document.createElement("select");
  select.className = "terrarium-select";
  select.setAttribute("aria-label", copy.history);
  const chart = ctx.ui.h("div", "");
  let selected = "soil:0";
  let current;
  const renderHistory = () => {
    if (!current) return;
    const plant = current.plants.find((plant2) => plant2.id === selected);
    const index = selected.startsWith("soil:") ? Number(selected.slice(5)) : plant ? plant.y * 5 + plant.x : -1;
    const cell = current.soil[index];
    cellStatus.textContent = cell ? `(${cell.x},${cell.y}) \xB7 ${copy.moisture} ${cell.moisture.toFixed(1)} \xB7 ${copy.light} ${(current.phase === "day" ? daylight(current, cell.x, cell.y) : 0).toFixed(2)}` : "";
    grid.querySelectorAll("button").forEach((button, i) => {
      button.setAttribute("aria-pressed", String(i === index));
    });
    chart.replaceChildren(drawHistory(current.history, selected, copy, ctx.language));
  };
  select.addEventListener("change", () => {
    selected = select.value;
    renderHistory();
  });
  card.body.append(name, status, canvas, replayContainer, details, habitat, historyTitle, select, chart, refresh);
  ctx.root.appendChild(card.el);
  const load = async () => {
    try {
      const response = await ctx.invoke("state");
      const state = response.state;
      for (const el of [canvas, replayContainer, details, habitat, historyTitle, select, chart]) el.hidden = !response.claimed;
      if (!response.claimed || !state) {
        status.textContent = pick(ctx.language, { zh: "\u672A\u8BA4\u9886", en: "Unclaimed" });
        return;
      }
      if (ctx.signal.aborted) return;
      name.textContent = state.name ?? pick(ctx.language, { zh: "\u751F\u6001\u7BB1", en: "Terrarium" });
      status.textContent = `${state.phase === "day" ? copy.day : copy.night}${response.id ? ` \xB7 ID ${response.id}` : ""}`;
      canvas.setAttribute("aria-label", `${name.textContent} \xB7 ${status.textContent}${copy.scene}: ${state.plants.length} plants, ${state.seeds?.length ?? 0} ${copy.seed}, ${state.bugs?.length ?? 0} ${copy.bug}`);
      scene.setState(state);
      replay.setReplays(state.replays ?? []);
      current = state;
      const cells = state.soil.map((cell, index) => {
        const light = state.phase === "day" ? daylight(state, cell.x, cell.y) : 0;
        const label = `(${cell.x},${cell.y}) \xB7 ${copy.moisture} ${cell.moisture.toFixed(1)} \xB7 ${copy.light} ${light.toFixed(2)}`;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "terrarium-cell";
        button.style.backgroundColor = `hsl(195 35% ${85 - cell.moisture * 0.45}%)`;
        button.style.color = cell.moisture > 65 ? "#fff" : "#18313b";
        button.textContent = `${Math.round(cell.moisture)}`;
        button.title = label;
        button.setAttribute("aria-label", label);
        button.addEventListener("click", () => {
          selected = `soil:${index}`;
          select.value = selected;
          renderHistory();
        });
        return button;
      });
      grid.setAttribute("aria-label", copy.soil);
      grid.replaceChildren(...cells);
      const names = new Map(state.history.flatMap((sample) => sample.plants.map((plant) => [plant.id, plant.species])));
      for (const plant of state.plants) names.set(plant.id, plant.species);
      const options = [...state.soil.map((cell, i) => [`soil:${i}`, `${copy.plot} (${cell.x},${cell.y})`]), ...Array.from(names, ([id, species]) => [id, `${id} (${species})`])];
      select.replaceChildren(...options.map(([value, label]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        return option;
      }));
      if (!options.some(([id]) => id === selected)) selected = "soil:0";
      select.value = selected;
      requirements.replaceChildren(ctx.ui.h("div", "", copy.needs), ...Object.entries(TERRARIUM_PLANT_REQUIREMENTS).map(([species, needs]) => ctx.ui.h("div", "", `${species}: ${needs.minMoisture}\u2013${needs.maxMoisture} / ${needs.minLight}\u2013${needs.maxLight}`)));
      renderHistory();
      details.replaceChildren(...state.plants.map((plant) => ctx.ui.h(
        "div",
        "terrarium-plant",
        `${plant.id === "fern" ? copy.fern : plant.id === "clover" ? copy.clover : plant.species} \xB7 ${copy.stage} ${plant.stage} \xB7 ${copy.moisture} ${Math.round(plant.moisture)} \xB7 HP ${Math.round(plant.health)}${plant.dry ? ` \xB7 ${copy.dry}` : ""}`
      )), ctx.ui.h("div", "terrarium-plant", `${copy.seed} ${state.seeds?.length ?? 0} \xB7 ${copy.bug} ${state.bugs?.length ?? 0} \xB7 ${copy.egg} ${state.eggs?.length ?? 0}`), ...(state.nests ?? []).map((nest) => ctx.ui.h("div", "terrarium-plant", `${copy.nest} ${nest.id} (${nest.x},${nest.y}) \xB7 ${nest.depth} ${copy.depth} \xB7 ${copy.food} ${nest.food}/${nest.depth * 20}`)));
    } catch (error) {
      if (!ctx.signal.aborted) status.textContent = error instanceof Error ? error.message : String(error);
    }
  };
  void load();
  ctx.interval(() => {
    void load();
  }, 5e3);
}
var client_default = { panels: { garden: { mount }, water: { mount: mountWater } } };
export {
  client_default as default
};
