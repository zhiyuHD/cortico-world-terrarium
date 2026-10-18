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
  const locations = bugPositions(state.bugs, positions);
  for (const bug of state.bugs) {
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
function createScene(canvas) {
  let state = null;
  let previous = /* @__PURE__ */ new Map();
  let movedAt = 0;
  let hitAt = 0;
  let hits = [];
  let frame = 0;
  let disposed = false;
  const currentPositions = (now) => {
    const t = Math.min(1, (now - movedAt) / 900);
    return new Map((state?.bugs ?? []).map((bug) => {
      const old = previous.get(bug.id) ?? bug;
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

// webui/client.ts
function mount(ctx) {
  const copy = pick(ctx.language, {
    zh: { loading: "\u8BFB\u53D6\u4E2D", refresh: "\u5237\u65B0", day: "\u767D\u5929", night: "\u591C\u665A", fern: "\u8568\u8349", clover: "\u4E09\u53F6\u8349", stage: "\u9636\u6BB5", moisture: "\u6C34\u5206", dry: "\u571F\u58E4\u53D8\u5E72", scene: "\u7684\u751F\u6001\u7BB1", seed: "\u79CD\u5B50", bug: "\u866B\u5B50" },
    en: { loading: "Loading", refresh: "Refresh", day: "Day", night: "Night", fern: "Fern", clover: "Clover", stage: "stage", moisture: "moisture", dry: "dry soil", scene: " terrarium", seed: "seeds", bug: "bugs" }
  });
  const card = ctx.ui.sheet({ title: "\u751F\u6001\u7BB1", en: "Terrarium" });
  const status = ctx.ui.msgline(copy.loading);
  const canvas = document.createElement("canvas");
  canvas.className = "terrarium-scene";
  canvas.width = 800;
  canvas.height = 500;
  canvas.setAttribute("role", "img");
  const scene = createScene(canvas);
  ctx.signal.addEventListener("abort", () => scene.dispose(), { once: true });
  const details = ctx.ui.h("div", "terrarium-details");
  const refresh = ctx.ui.button(copy.refresh, { size: "sm", onClick: () => {
    void load();
  } });
  card.body.append(status, canvas, details, refresh);
  ctx.root.appendChild(card.el);
  const load = async () => {
    try {
      const state = await ctx.invoke("state");
      if (ctx.signal.aborted) return;
      status.textContent = state.phase === "day" ? copy.day : copy.night;
      canvas.setAttribute("aria-label", `${status.textContent}${copy.scene}: ${state.plants.length} plants, ${state.seeds?.length ?? 0} ${copy.seed}, ${state.bugs?.length ?? 0} ${copy.bug}`);
      scene.setState(state);
      details.replaceChildren(...state.plants.map((plant) => ctx.ui.h(
        "div",
        "terrarium-plant",
        `${plant.id === "fern" ? copy.fern : plant.id === "clover" ? copy.clover : plant.species} \xB7 ${copy.stage} ${plant.stage} \xB7 ${copy.moisture} ${Math.round(plant.moisture)} \xB7 HP ${Math.round(plant.health)}${plant.dry ? ` \xB7 ${copy.dry}` : ""}`
      )), ctx.ui.h("div", "terrarium-plant", `${copy.seed} ${state.seeds?.length ?? 0} \xB7 ${copy.bug} ${state.bugs?.length ?? 0}`));
    } catch (error) {
      if (!ctx.signal.aborted) status.textContent = error instanceof Error ? error.message : String(error);
    }
  };
  void load();
  ctx.interval(() => {
    void load();
  }, 5e3);
}
var client_default = { panels: { garden: { mount } } };
export {
  client_default as default
};
