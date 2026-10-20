// src/scoring.ts
var TERRARIUM_SCORE_VERSION = 2;
function speciesScore(organisms, value) {
  const groups = /* @__PURE__ */ new Map();
  for (const organism of organisms) {
    const values = groups.get(organism.species) ?? [];
    values.push(value(organism));
    groups.set(organism.species, values);
  }
  return Math.round([...groups.values()].reduce((sum, values) => sum + values.sort((a, b) => b - a).slice(0, 3).reduce((total, v, i) => total + v * [1, 0.5, 0.25][i], 0), 0));
}
var maturity = (ageHours) => 0.25 + 0.75 * Math.min(1, ageHours / 24);
function scoreParts(state) {
  const plants = speciesScore(state.plants, (plant) => (plant.stage + 1) * plant.health / 10);
  if ("fish" in state) {
    const fish = speciesScore(state.fish, (fish2) => 40 * fish2.health / 100 * fish2.energy / 100 * maturity(fish2.ageHours) * Math.min(1, state.oxygen / 50, state.cleanliness / 50));
    return { plants, fish, water: Math.round(40 * Math.min(state.oxygen, state.cleanliness) / 100 * Math.min(1, plants / 40, fish / 40)) };
  }
  return {
    plants,
    bugs: speciesScore(state.bugs, (bug) => 40 * bug.energy / 100 * (1 - (bug.hunger ?? 0) / 100) * maturity(bug.ageHours)),
    seeds: 0
  };
}
function score(state) {
  return Object.values(scoreParts(state)).reduce((sum, part) => sum + part, 0);
}
var TERRARIUM_SCORE_RULES = "\u540C\u79CD\u53EA\u53D6\u8D21\u732E\u6700\u9AD8\u7684\u524D\u4E09\u4E2A\uFF0C\u6743\u91CD 100%/50%/25%\uFF1B\u79CD\u5B50\u548C\u989D\u5916\u6D47\u6C34\u4E0D\u76F4\u63A5\u8BA1\u5206\u3002\u52A8\u7269\u6210\u719F\u5EA6\u5728 24 \u4E2A\u6A21\u62DF\u5C0F\u65F6\u540E\u8FBE\u5230\u4E0A\u9650\uFF0C\u9965\u997F\u6216\u5065\u5EB7\u3001\u80FD\u91CF\u4E0E\u6C34\u73AF\u5883\u5F71\u54CD\u52A8\u7269\u5206\u3002\u6C34\u73AF\u5883\u5206 = round(40 \xD7 min(\u6C27\u6C14, \u6C34\u8D28)/100 \xD7 min(1, \u690D\u7269\u5206/40, \u9C7C\u5206/40))\u3002";

// src/progression.ts
var TERRARIUM_LEVELS = [
  { level: 1, requiredScore: 0, size: 5, organisms: 12, collection: 48 },
  { level: 2, requiredScore: 120, size: 6, organisms: 18, collection: 64 },
  { level: 3, requiredScore: 260, size: 7, organisms: 24, collection: 96 },
  { level: 4, requiredScore: 420, size: 8, organisms: 32, collection: 128 }
];
var TERRARIUM_WATER_LEVELS = TERRARIUM_LEVELS.map((level, index) => ({ ...level, requiredScore: [0, 120, 240, 360][index] }));
function expansionLevels(state) {
  return "kind" in state && state.kind === "water" ? TERRARIUM_WATER_LEVELS : TERRARIUM_LEVELS;
}
var TERRARIUM_FACILITIES = {
  mulch: { habitat: "land", level: 2, name: "\u4FDD\u6E7F\u8986\u76D6", effect: "\u5168\u7BB1\u571F\u58E4\u84B8\u53D1\u51CF\u5C11 25%\uFF1B\u4E0D\u6539\u53D8\u6E17\u900F\u3002" },
  shade: { habitat: "land", level: 3, name: "\u906E\u9634\u68DA", effect: "\u6240\u5728\u683C\u4E0E\u4E0A\u4E0B\u5DE6\u53F3\u7684\u65E5\u5149\u4E58\u4EE5 0.6\uFF0C\u53EF\u79FB\u52A8\u6216\u5173\u95ED\u3002" },
  grow_light: { habitat: "land", level: 4, name: "\u80B2\u82D7\u706F", effect: "\u767D\u5929\u5C06\u6240\u5728\u683C\u4E0E\u4E0A\u4E0B\u5DE6\u53F3\u7684\u5149\u7167\u63D0\u9AD8\u5230\u81F3\u5C11 0.75\uFF1B\u591C\u665A\u4ECD\u4E0D\u751F\u957F\u3002" },
  air_stone: { habitat: "water", level: 2, name: "\u6C14\u6CE1\u77F3", effect: "\u5168\u7BB1\u6BCF\u5C0F\u65F6\u989D\u5916\u589E\u52A0 2 \u6C27\u6C14\u3002" },
  filter: { habitat: "water", level: 3, name: "\u8FC7\u6EE4\u5668", effect: "\u5168\u7BB1\u6BCF\u5C0F\u65F6\u6062\u590D 2 \u6C34\u8D28\u3002" },
  water_light: { habitat: "water", level: 4, name: "\u6C34\u8349\u706F", effect: "\u767D\u5929\u6C34\u8349\u751F\u957F\u901F\u5EA6\u63D0\u9AD8 25%\uFF1B\u591C\u665A\u4ECD\u4E0D\u751F\u957F\u3002" }
};
function capacity(state) {
  return expansionLevels(state).find((l) => l.level === state.progression?.level) ?? expansionLevels(state)[0];
}
function nearFacility(state, kind, x, y) {
  return state.facilities?.some((f) => f.kind === kind && f.enabled && Math.abs(f.x - x) + Math.abs(f.y - y) <= 1) ?? false;
}
var LAND_LETTERS = [
  { title: "\u4E00\u5C01\u6CA1\u6709\u7F72\u540D\u7684\u6765\u4FE1", text: "\u6B22\u8FCE\u63A5\u624B\u8FD9\u5EA7\u5C0F\u5C0F\u7684\u89C2\u5BDF\u7AD9\u3002\u7B2C\u4E00\u5C01\u4FE1\u5939\u5728\u7BB1\u76D6\u91CC\uFF1A\u201C\u5148\u770B\u770B\u8FD9\u91CC\u7684\u4F4F\u5BA2\u548C\u73AF\u5883\uFF0C\u518D\u51B3\u5B9A\u600E\u6837\u7167\u987E\u5B83\u4EEC\u3002\u201D\u4E3B\u4EBA\u53EF\u4EE5\u5728 Cortico \u6216 Coopanion \u7684\u751F\u6001\u7BB1\u9762\u677F\u67E5\u770B\u753B\u9762\u3002\u5148\u7528 inspect \u7684 soil\u3001care \u5206\u533A\u770B\u6C34\u5206\u3001\u5149\u7167\u548C\u9002\u5B9C\u533A\u95F4\u3002\u5B81\u53EF\u5C11\u6D47\uFF0C\u5148\u786E\u8BA4\u9700\u8981\u518D\u52A0\u6C34\uFF1B\u6C34\u5206\u9AD8\u4E8E\u7269\u79CD\u4E0A\u9650\u6216\u4F4E\u4E8E\u4E0B\u9650\u65F6\uFF0C\u6BCF\u4E2A\u6A21\u62DF\u5C0F\u65F6\u635F\u5931 0.5 \u5065\u5EB7\u3002\u690D\u7269\u4E0E\u79CD\u5B50\u53EA\u5728\u6761\u4EF6\u5408\u9002\u7684\u767D\u5929\u7D2F\u8BA1\u751F\u957F\uFF0C\u591C\u91CC\u7B49\u5F85\u5929\u4EAE\uFF1B\u77F3\u5B50\u4F1A\u8BA9\u6240\u5728\u683C\u548C\u4E0A\u4E0B\u5DE6\u53F3\u7684\u65E5\u5149\u53EA\u5269 35%\u3002\u6E29\u5EA6\u76EE\u524D\u6CA1\u6709\u5355\u72EC\u6A21\u62DF\u3002\u67E5\u770B\u540E\u786E\u8BA4\uFF1Asoil \u4E2D\u6BCF\u682A\u6240\u5728\u683C\u7684\u6C34\u5206\u548C\u767D\u5929\u5149\u7167\u843D\u5728 requirements \u5BF9\u5E94\u533A\u95F4\uFF1B\u591C\u95F4 care.waitForDaylight \u4E3A true \u65F6\uFF0C\u73AF\u5883\u9002\u5B9C\u5C31\u7B49\u5F85\u5929\u4EAE\u3002", task: "\u7528 terrarium_inspect \u67E5\u770B\u5730\u7BB1\uFF0Csoil \u67E5\u73AF\u5883\u4E0E\u9002\u5B9C\u8303\u56F4\uFF0Ccare \u67E5\u751F\u957F\u6761\u4EF6\u3002", action: "observe" },
  { title: "\u6C34\u58F6\u65C1\u7684\u4FBF\u7B7E", text: "\u65E7\u6C34\u58F6\u65C1\u7559\u7740\u4E00\u884C\u5B57\uFF1A\u201C\u5408\u9002\u6BD4\u66F4\u591A\u91CD\u8981\u3002\u201D\u6D47\u6C34\u9ED8\u8BA4\u662F\u589E\u52A0 35\uFF0Camount \u662F\u52A0\u6C34\u91CF\uFF0CtargetMoisture \u624D\u662F\u8865\u5230\u76EE\u6807\u6C34\u5206\u3002fern \u9002\u5B9C\u6C34\u5206 30\u201385\u3001clover 20\u201380\u3001moss 45\u201390\u3001basil 30\u201375\u3001bean 25\u201370\uFF1Bcare \u4F1A\u7ED9\u51FA\u6BCF\u682A\u9002\u5B9C\u8303\u56F4\u3002\u5148\u6309\u8FD9\u682A\u690D\u7269\u7684\u9002\u5B9C\u533A\u95F4\u9009\u76EE\u6807\uFF1B\u8FC7\u6E7F\u548C\u7F3A\u6C34\u90FD\u4F1A\u6301\u7EED\u635F\u5931\u5065\u5EB7\u3002onlyDry \u4F1A\u8DF3\u8FC7\u5DF2\u8FBE\u5230\u7269\u79CD\u6700\u4F4E\u6C34\u5206\u7684\u683C\u5B50\uFF0C\u4E0D\u662F\u8865\u6EE1\u3002\u6D47\u6C34\u540E\u770B\u56DE\u6267 watering.watered\u3001\u690D\u7269 moistureStatus \u4E0E\u9002\u5B9C\u8303\u56F4\uFF1Bwatered \u4E3A 0 \u8868\u793A\u6CA1\u6709\u52A0\u6C34\uFF0C\u4E0D\u5FC5\u91CD\u590D\u8865\u6EE1\u3002", task: "\u6309\u5B9E\u9645\u6C34\u5206\u9700\u8981\u6D47\u6C34\u4E00\u6B21\uFF1B\u5DF2\u7ECF\u9002\u5B9C\u5C31\u4E0D\u5FC5\u4E3A\u4E86\u505A\u4EFB\u52A1\u53CD\u590D\u6D47\u3002", action: "care" },
  { title: "\u7A7A\u767D\u7684\u690D\u7269\u6807\u7B7E", text: "\u62BD\u5C49\u91CC\u6709\u51E0\u5F20\u7A7A\u767D\u6807\u7B7E\u3002\u6311\u4E00\u683C\u6C34\u5206\u548C\u5149\u7167\u5408\u9002\u7684\u7A7A\u5730\u79CD\u4E0B\u690D\u7269\u3002\u79CD\u5B50\u9700\u8981\u7D2F\u8BA1 2 \u4E2A\u9002\u5B9C\u767D\u5929\u6A21\u62DF\u5C0F\u65F6\u624D\u53D1\u82BD\uFF0C\u591C\u91CC\u4E0D\u7D2F\u8BA1\uFF1B\u540C\u79CD\u53EA\u53D6\u8D21\u732E\u6700\u9AD8\u7684\u524D\u4E09\u682A\uFF0C\u6309 100%\u300150%\u300125% \u8BA1\u5206\uFF0C\u79CD\u5B50\u672C\u8EAB\u4E0D\u8BA1\u5206\u3002\u591A\u6837\u5316\u79CD\u690D\u6BD4\u6324\u6EE1\u540C\u4E00\u79CD\u66F4\u6709\u7528\u3002\u64AD\u79CD\u540E\u770B\u56DE\u6267 seed \u6216 seeds \u7684 ID \u548C\u5750\u6807\u786E\u8BA4\u5165\u571F\uFF1B\u4E4B\u540E\u7528 care \u770B\u53D1\u82BD\u5269\u4F59\u9002\u5B9C\u767D\u5929\u6A21\u62DF\u5C0F\u65F6\uFF0C\u591C\u95F4\u4FDD\u6301\u4E0D\u53D8\u662F\u6B63\u5E38\u7684\u3002", task: "\u5728\u7A7A\u683C\u64AD\u79CD\u4E00\u6B21\uFF1B\u53EF\u7528 terrarium_sow_area \u6279\u91CF\u64AD\u79CD\u3002", action: "plant" },
  { title: "\u4F1A\u52A8\u7684\u90BB\u5C45", text: "\u89C2\u5BDF\u7B14\u8BB0\u8FD8\u7F3A\u51E0\u9875\uFF1A\u8C01\u5403\u4EC0\u4E48\uFF0C\u8C01\u53C8\u9700\u8981\u5E87\u62A4\uFF1F\u5148\u786E\u8BA4\u98DF\u7269\u6765\u6E90\u518D\u653E\u866B\u3002\u869C\u866B\u4F1A\u5543\u690D\u7269\uFF0C\u7532\u866B\u9700\u8981\u869C\u866B\uFF0C\u8718\u86DB\u4F1A\u6355\u98DF\u5176\u4ED6\u866B\uFF1B\u8682\u8681\u7F3A\u7CAE\u4E5F\u53EF\u80FD\u91C7\u96C6\u690D\u7269\u3002\u80FD\u91CF\u4E0E\u9965\u997F\u5206\u5F00\uFF0Cfeed_bug \u53EA\u8865\u80FD\u91CF\uFF0C\u5B9E\u9645\u53D6\u98DF\u624D\u80FD\u964D\u4F4E\u9965\u997F\u3002\u653E\u5165\u8682\u8681\u5E76\u51FA\u73B0\u8681\u5DE2\u540E\uFF0C\u7528 inspect \u7684 colonies \u627E\u5DE2 ID\uFF0C\u518D\u7528 terrarium_feed_nest \u7ED9\u5DE2\u6DFB 5 \u4EFD\u7CAE\u3002\u653E\u866B\u540E\u7528 inspect \u7684 residents \u786E\u8BA4 ID\uFF0C\u518D\u7528 care \u7684 feeding \u770B lastMeal\uFF1B\u9965\u997F\u4E0B\u964D\u624D\u8868\u793A\u5B9E\u9645\u5403\u5230\u4E86\uFF0C\u5355\u8865\u80FD\u91CF\u4E0D\u7B97\u3002", task: "\u786E\u8BA4\u98DF\u7269\u6765\u6E90\u540E\u653E\u5165\u4E00\u53EA\u866B\u5B50\uFF0C\u89C2\u5BDF\u5176\u53D6\u98DF\u4E0E\u9965\u997F\u3002", action: "inhabit" },
  { title: "\u65E7\u4ED3\u5E93\u7684\u94A5\u5319", text: "\u67DC\u5E95\u7684\u94A5\u5319\u7EC8\u4E8E\u627E\u5230\u4E86\u3002\u6536\u85CF\u4F1A\u6682\u505C\u8FD9\u4F4D\u4F4F\u5BA2\u7684\u6A21\u62DF\uFF0C\u4E5F\u4E0D\u518D\u8BA1\u5206\uFF1B\u5176\u4ED6\u751F\u547D\u4ECD\u9700\u7167\u987E\u3002\u653E\u56DE\u690D\u7269\u6216\u79CD\u5B50\u9700\u8981\u4E00\u4E2A\u6CA1\u6709\u690D\u7269\u548C\u79CD\u5B50\u7684\u683C\u5B50\u3002\u9762\u677F\u53EF\u5148\u70B9\u9009\u7A7A\u683C\u518D\u70B9\u201C\u653E\u56DE\u9009\u4E2D\u683C\u201D\uFF0C\u5DE5\u5177\u9700\u8981\u6307\u5B9A x/y\u3002\u6536\u85CF\u540E\u770B\u56DE\u6267 collectionCount \u548C\u6536\u85CF\u5217\u8868\u786E\u8BA4\u6807\u672C\uFF1B\u653E\u56DE\u540E\u67E5\u770B\u56DE\u6267\u5750\u6807\u548C residents\uFF0C\u786E\u8BA4\u5B83\u5DF2\u56DE\u5230\u7BB1\u5185\u3002", task: "\u6536\u85CF\u4E00\u4F4D\u4F4F\u5BA2\uFF1B\u653E\u56DE\u65F6\u5148\u9009\u5408\u6CD5\u4F4D\u7F6E\uFF0C\u4F4D\u7F6E\u4E0D\u5408\u9002\u4E0D\u4F1A\u4E22\u5931\u6536\u85CF\u3002", action: "collect" },
  { title: "\u56F4\u680F\u5916\u7684\u65B0\u5730\u65B9", text: "\u6700\u540E\u4E00\u5C01\u4FE1\u5199\u7740\uFF1A\u201C\u5F53\u8FD9\u91CC\u8DB3\u591F\u7E41\u76DB\uFF0C\u56F4\u680F\u5916\u8FD8\u6709\u5730\u65B9\u3002\u201D\u6269\u5EFA\u6309\u65B0\u516C\u5F0F\u5DF2\u8BB0\u5F55\u7684\u6700\u9AD8\u5206\u5224\u5B9A\uFF0C\u4E0D\u82B1\u5206\uFF0C\u4E5F\u4E0D\u4F1A\u56E0\u5F53\u524D\u5206\u4E0B\u964D\u7F29\u5C0F\u3002\u5730\u7BB1\u95E8\u69DB\u4E3A 120\u3001260\u3001420\uFF1B\u65E7\u516C\u5F0F\u9AD8\u5206\u4E0D\u7528\u4E8E\u89E3\u9501\u3002\u540C\u79CD\u53EA\u8BA1\u524D\u4E09\uFF0C\u52A8\u7269\u517B\u6EE1 24 \u4E2A\u6A21\u62DF\u5C0F\u65F6\u624D\u6709\u5B8C\u6574\u6210\u719F\u5EA6\u8D21\u732E\uFF0C\u8FC7\u997F\u4F1A\u964D\u5206\u3002\u6269\u5EFA\u540E\u7528 terrarium_progress \u786E\u8BA4 level\u3001size \u548C collection \u5BB9\u91CF\u5DF2\u589E\u52A0\uFF1B\u6700\u9AD8\u5206\u4FDD\u7559\uFF0C\u4E0D\u6263\u5206\u3002", task: "\u65B0\u516C\u5F0F\u6700\u9AD8\u5206\u8FBE\u5230 120 \u540E\u6269\u5EFA\u5230\u4E8C\u7EA7\uFF1B\u5267\u60C5\u6CA1\u6709\u989D\u5916\u79EF\u5206\u5956\u52B1\u3002", action: "upgrade" }
];
var WATER_LETTERS = [
  { title: "\u4E00\u5C01\u6CA1\u6709\u7F72\u540D\u7684\u6765\u4FE1", text: "\u6B22\u8FCE\u63A5\u624B\u8FD9\u5EA7\u6C34\u4E0B\u89C2\u5BDF\u7AD9\u3002\u7B2C\u4E00\u5C01\u4FE1\u5939\u5728\u7BB1\u76D6\u91CC\uFF1A\u201C\u5148\u770B\u770B\u8FD9\u91CC\u7684\u4F4F\u5BA2\u548C\u73AF\u5883\uFF0C\u518D\u51B3\u5B9A\u600E\u6837\u7167\u987E\u5B83\u4EEC\u3002\u201D\u4E3B\u4EBA\u53EF\u4EE5\u5728 Cortico \u6216 Coopanion \u7684\u751F\u6001\u7BB1\xB7\u6C34\u9762\u677F\u67E5\u770B\u3002\u7528 inspect \u7684 care \u5206\u533A\u770B\u542B\u6C27\u3001\u6C34\u8D28\u548C\u6C34\u8349\u751F\u957F\u6761\u4EF6\u3002\u6C34\u8349\u53EA\u5728\u6761\u4EF6\u9002\u5B9C\u7684\u767D\u5929\u751F\u957F\uFF0C\u591C\u91CC\u7B49\u5F85\u5929\u4EAE\uFF0C\u540C\u65F6\u7EE7\u7EED\u6D88\u8017\u6C27\u6C14\uFF1B\u6E29\u5EA6\u76EE\u524D\u6CA1\u6709\u5355\u72EC\u6A21\u62DF\u3002\u67E5\u770B\u540E\u786E\u8BA4\uFF1Ainspect \u4E2D\u6C27\u6C14\u548C\u6C34\u8D28\u7684\u5F53\u524D\u503C\uFF0C\u4EE5\u53CA care \u4E2D\u7684\u751F\u957F\u6761\u4EF6\u548C\u5929\u4EAE\u542B\u6C27\u4F30\u8BA1\uFF1B\u591C\u95F4 waitForDaylight \u4E3A true \u65F6\u4E0D\u7528\u53CD\u590D\u79CD\u690D\u3002", task: "\u7528 terrarium_inspect \u67E5\u770B\u6C34\u7BB1\u548C care \u7167\u6599\u5EFA\u8BAE\u3002", action: "observe" },
  { title: "\u6C34\u58F6\u65C1\u7684\u4FBF\u7B7E", text: "\u4FBF\u7B7E\u4E0A\u5199\u7740\uFF1A\u201C\u6E05\u6C34\u4E5F\u9700\u8981\u7559\u5FC3\u7167\u987E\u3002\u201D\u5148\u68C0\u67E5\u6C27\u6C14\u3001\u6C34\u8D28\u4E0E\u6B8B\u9975\uFF1B\u6362\u6C34\u80FD\u6539\u5584\u73AF\u5883\uFF0C\u6295\u9972\u6599\u5E94\u6309\u5B9E\u9645\u9700\u8981\uFF0C\u5403\u4E0D\u5B8C\u7684\u9972\u6599\u4F1A\u6C61\u67D3\u6C34\u8D28\u3002\u9C7C\u9700\u8981\u5148\u6E38\u5230\u98DF\u7269\u5904\uFF0C\u5DF2\u6709\u6B8B\u9975\u65F6\u7B49\u5F85\u4E5F\u662F\u6B63\u786E\u64CD\u4F5C\uFF0C\u4E0D\u5FC5\u91CD\u590D\u6295\u653E\u3002\u6C27\u6C14\u964D\u81F3 40 \u4F1A\u63D0\u9192\uFF0C\u4F4E\u4E8E 25 \u635F\u5BB3\u9C7C\u5065\u5EB7\uFF1B\u6C34\u8D28\u81F3\u5C11 40 \u624D\u80FD\u957F\u8349\uFF0C\u4F4E\u4E8E 30 \u4F1A\u635F\u5BB3\u9C7C\u8349\u5065\u5EB7\u3002\u6362\u6C34\u540E\u770B inspect \u7684 oxygen\u3001cleanliness\uFF1B\u6295\u9972\u6599\u540E\u770B food.portions \u548C\u9C7C\u7684 lastMeal\uFF0C\u5C1A\u672A\u6E38\u5230\u65F6\u5148\u7B49\u5F85\uFF0C\u4E0D\u8981\u770B\u5230\u6B8B\u9975\u5C31\u518D\u52A0\u3002", task: "\u6309\u73AF\u5883\u548C\u9965\u997F\u9700\u8981\u6362\u6C34\u6216\u6295\u653E\u9972\u6599\u4E00\u6B21\u3002", action: "care" },
  { title: "\u6C34\u4E0B\u7684\u690D\u7269\u6807\u7B7E", text: "\u6311\u4E00\u683C\u7A7A\u4F4D\uFF0C\u7ED9\u6C34\u8349\u3001\u7761\u83B2\u6216\u6D77\u85FB\u6302\u4E0A\u6807\u7B7E\u3002\u6C34\u8349\u9700\u8981\u9002\u5B9C\u6C34\u8D28\u548C\u767D\u5929\u6A21\u62DF\u65F6\u95F4\uFF1B\u540C\u79CD\u53EA\u8BA1\u8D21\u732E\u6700\u9AD8\u7684\u524D\u4E09\u682A\uFF0C\u6743\u91CD 100%\u300150%\u300125%\u3002\u6C34\u73AF\u5883\u5206\u6700\u9AD8 40\uFF0C\u6309\u6700\u4F4E\u7684\u6C27\u6C14\u6216\u6C34\u8D28\u6BD4\u4F8B\uFF0C\u518D\u4E58\u4EE5\u690D\u7269\u5206/40\u3001\u9C7C\u5206/40 \u4E0E 1 \u4E2D\u7684\u6700\u5C0F\u503C\uFF1B\u53EA\u6709\u6C34\u5E72\u51C0\u3001\u6CA1\u6709\u9C7C\u8349\uFF0C\u5E76\u4E0D\u80FD\u62FF\u6EE1\u73AF\u5883\u5206\u3002\u79CD\u690D\u540E\u7528 inspect \u7684 residents \u786E\u8BA4\u7269\u79CD\u548C\u5750\u6807\uFF0C\u518D\u770B care \u7684 canGrowNow \u4E0E suitableHoursRemaining\uFF1B\u591C\u95F4\u7B49\u5F85\u5929\u4EAE\u3002", task: "\u79CD\u690D\u4E00\u79CD\u6C34\u8349\u3001\u7761\u83B2\u6216\u6D77\u85FB\u3002", action: "plant" },
  { title: "\u4F1A\u6E38\u6CF3\u7684\u90BB\u5C45", text: "\u5148\u770B\u770B\u98DF\u7269\uFF0C\u518D\u51B3\u5B9A\u8BF7\u8C01\u4F4F\u8FDB\u6765\u3002\u5B54\u96C0\u9C7C\u4E0E\u91D1\u9C7C\u5403\u9972\u6599\uFF0C\u91D1\u9C7C\u4E5F\u4F1A\u5403\u6D77\u85FB\uFF1B\u9C88\u9C7C\u4F1A\u6355\u98DF\u5B54\u96C0\u9C7C\u3002\u7559\u5FC3\u6C27\u6C14\u3001\u6C34\u8D28\u3001\u5065\u5EB7\u4E0E\u80FD\u91CF\uFF0C\u9C7C\u9700\u8981\u517B\u6EE1 24 \u4E2A\u6A21\u62DF\u5C0F\u65F6\u624D\u6709\u5B8C\u6574\u6210\u719F\u5EA6\u8D21\u732E\u3002\u653E\u9C7C\u540E\u7528 inspect \u7684 residents \u786E\u8BA4\u9C7C\u7684 ID\u3001\u5065\u5EB7\u4E0E\u80FD\u91CF\uFF0C\u518D\u7528 care \u7684 feeding.lastMeal \u67E5\u770B\u5B9E\u9645\u8FDB\u98DF\u8BB0\u5F55\u3002", task: "\u786E\u8BA4\u98DF\u7269\u548C\u6C27\u6C14\u6761\u4EF6\u540E\u653E\u5165\u4E00\u6761\u9C7C\u3002", action: "inhabit" },
  { title: "\u65E7\u4ED3\u5E93\u7684\u94A5\u5319", text: "\u6536\u85CF\u53EF\u4EE5\u6682\u505C\u4E00\u6761\u9C7C\u6216\u4E00\u682A\u6C34\u8349\u7684\u6A21\u62DF\uFF0C\u4E5F\u6682\u505C\u5B83\u7684\u79EF\u5206\u8D21\u732E\u3002\u653E\u56DE\u6C34\u8349\u9700\u8981\u6CA1\u6709\u5176\u4ED6\u6C34\u8349\u7684\u683C\u5B50\uFF1B\u5148\u5728\u9762\u677F\u9009\u4F4D\u7F6E\u518D\u653E\u56DE\uFF0C\u6216\u5728\u5DE5\u5177\u4E2D\u7ED9\u51FA x/y\u3002\u6C34\u7BB1\u8FDB\u5EA6\u72EC\u7ACB\u4FDD\u5B58\uFF0C\u5185\u5BB9\u56F4\u7ED5\u6C34\u4E0B\u7167\u6599\u5C55\u5F00\uFF0C\u53EF\u4EE5\u5355\u72EC\u8DF3\u8FC7\u3002\u6536\u85CF\u540E\u67E5 collection \u5217\u8868\u786E\u8BA4\u6807\u672C\uFF1B\u653E\u56DE\u540E\u7528 inspect \u7684 residents \u786E\u8BA4\u9C7C\u6216\u6C34\u8349\u5DF2\u56DE\u5230\u6307\u5B9A\u4F4D\u7F6E\u3002", task: "\u6536\u85CF\u4E00\u4F4D\u6C34\u4E0B\u4F4F\u5BA2\uFF1B\u6309\u9700\u9009\u4F4D\u7F6E\u653E\u56DE\u3002", action: "collect" },
  { title: "\u73BB\u7483\u5916\u7684\u65B0\u5730\u65B9", text: "\u89C2\u5BDF\u7AD9\u7E41\u76DB\u8D77\u6765\uFF0C\u6C34\u4E0B\u4E5F\u53EF\u4EE5\u62E5\u6709\u66F4\u5BBD\u655E\u7684\u7A7A\u95F4\u3002\u6C34\u7BB1\u6269\u5EFA\u95E8\u69DB\u4E3A\u65B0\u516C\u5F0F\u6700\u9AD8\u5206 120\u3001240\u3001360\uFF0C\u6309\u5DF2\u8BB0\u5F55\u6700\u9AD8\u5206\u5224\u5B9A\uFF0C\u4E0D\u82B1\u5206\u3002\u65E7\u516C\u5F0F\u9AD8\u5206\u4E0D\u7528\u4E8E\u89E3\u9501\uFF0C\u5206\u6570\u4E0B\u964D\u4E0D\u4F1A\u7F29\u56DE\u5DF2\u7ECF\u6269\u5EFA\u7684\u7A7A\u95F4\u3002\u6269\u5EFA\u540E\u7528 terrarium_progress \u786E\u8BA4 level\u3001size \u548C collection \u5BB9\u91CF\u5DF2\u589E\u52A0\uFF1B\u6C34\u7BB1\u8FDB\u5EA6\u72EC\u7ACB\u4E8E\u5730\u7BB1\u3002", task: "\u65B0\u516C\u5F0F\u6700\u9AD8\u5206\u8FBE\u5230 120 \u540E\u6269\u5EFA\u5230\u4E8C\u7EA7\uFF1B\u5267\u60C5\u6CA1\u6709\u989D\u5916\u79EF\u5206\u5956\u52B1\u3002", action: "upgrade" }
];
var letters = (state) => "fish" in state ? WATER_LETTERS : LAND_LETTERS;
function guide(state) {
  const p = state.progression ?? { guideStep: 0, guideSkipped: false, actions: [] };
  const chapters = letters(state), chapter = chapters[p.guideStep];
  return { step: p.guideStep, total: chapters.length, skipped: p.guideSkipped, completed: p.guideStep >= chapters.length, ...chapter && !p.guideSkipped ? { ...chapter, ready: p.actions.includes(chapter.action) } : {} };
}
function development(state) {
  const c = capacity(state), peakScore = Math.max(state.progression?.scoreVersion === TERRARIUM_SCORE_VERSION ? state.progression.peakScore : 0, score(state), ...state.history.filter((h) => h.scoreVersion === TERRARIUM_SCORE_VERSION).map((h) => h.score ?? 0)), next = expansionLevels(state).find((l) => l.level === c.level + 1);
  return { ...c, scoreParts: scoreParts(state), peakScore, next: next ? { ...next, remainingScore: Math.max(0, next.requiredScore - peakScore), available: peakScore >= next.requiredScore } : null, facilities: Object.entries(TERRARIUM_FACILITIES).filter(([, f]) => f.habitat === ("fish" in state ? "water" : "land")).map(([kind, f]) => ({ kind, ...f, unlocked: c.level >= f.level, installed: state.facilities?.find((e) => e.kind === kind) ?? null })), guide: guide(state) };
}

// webui/progression.ts
function createProgressionControls(ctx, reload) {
  const zh = ctx.language.startsWith("zh"), el = ctx.ui.h("section", "terrarium-progress"), content = ctx.ui.h("div", ""), status = ctx.ui.h("div", "terrarium-progress-status");
  el.setAttribute("aria-label", zh ? "\u89C2\u5BDF\u7AD9\u4E0E\u6269\u5EFA" : "Observation station and expansion");
  status.setAttribute("role", "status");
  el.append(content, status);
  let busy = false, showLetter = true, showRules = false;
  let current, selected = { x: 0, y: 0 };
  const run = async (args) => {
    if (busy || !current || ctx.signal.aborted) return;
    busy = true;
    render();
    try {
      await ctx.invoke("care", [{ tool: "terrarium_progress", habitat: "fish" in current ? "water" : "land", ...args }]);
      if (!ctx.signal.aborted) {
        status.textContent = zh ? "\u5DF2\u4FDD\u5B58" : "Saved";
        await reload();
      }
    } catch (error) {
      if (!ctx.signal.aborted) status.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
      if (!ctx.signal.aborted) render();
    }
  };
  const button = (text, args, disabled = false) => {
    const b = ctx.ui.button(text, { size: "sm", onClick: () => {
      void run(args);
    } });
    b.disabled = busy || disabled;
    return b;
  };
  const names = { mulch: "Mulch", shade: "Shade canopy", grow_light: "Grow light", air_stone: "Air stone", filter: "Filter", water_light: "Aquatic grow light" };
  const render = () => {
    if (!current) return;
    const d = development(current), head = ctx.ui.h("div", "terrarium-progress-head");
    const label = ctx.ui.h("div", "", zh ? `\u89C2\u5BDF\u7AD9 \xB7 \u7B49\u7EA7 ${d.level}` : `Observation station \xB7 Level ${d.level}`);
    const area = ctx.ui.h("strong", "", `${d.size} \xD7 ${d.size}`);
    head.append(label, area);
    const limits = ctx.ui.h("div", "terrarium-progress-limits", zh ? `\u690D\u7269 ${current.plants.length}/${d.organisms} \xB7 ${"fish" in current ? "\u9C7C" : "\u866B\u4E0E\u5375"} ${"fish" in current ? current.fish.length : current.bugs.length + (current.eggs?.length ?? 0)}/${d.organisms} \xB7 \u6536\u85CF ${current.collection?.length ?? 0}/${d.collection}` : `Plants ${current.plants.length}/${d.organisms} \xB7 Animals ${"fish" in current ? current.fish.length : current.bugs.length + (current.eggs?.length ?? 0)}/${d.organisms} \xB7 Collection ${current.collection?.length ?? 0}/${d.collection}`);
    const progress = ctx.ui.h("div", "terrarium-progress-track"), fill = ctx.ui.h("span", "");
    fill.style.width = `${d.next ? Math.min(100, d.peakScore / d.next.requiredScore * 100) : 100}%`;
    progress.append(fill);
    progress.setAttribute("role", "progressbar");
    progress.setAttribute("aria-label", zh ? "\u6269\u5EFA\u6240\u9700\u6700\u9AD8\u79EF\u5206" : "Peak score toward expansion");
    progress.setAttribute("aria-valuemin", "0");
    progress.setAttribute("aria-valuemax", String(d.next?.requiredScore ?? d.peakScore));
    progress.setAttribute("aria-valuenow", String(Math.min(d.peakScore, d.next?.requiredScore ?? d.peakScore)));
    const score2 = ctx.ui.h("div", "terrarium-progress-score", d.next ? zh ? `\u6700\u9AD8 ${d.peakScore} / ${d.next.requiredScore} \u5206 \xB7 \u8FD8\u5DEE ${d.next.remainingScore} \u5206 \xB7 \u4E0B\u4E00\u7EA7 ${d.next.size}\xD7${d.next.size}\uFF0C\u6536\u85CF ${d.next.collection}` : `Peak ${d.peakScore} / ${d.next.requiredScore} \xB7 ${d.next.remainingScore} remaining \xB7 Next ${d.next.size}\xD7${d.next.size}, collection ${d.next.collection}` : zh ? `\u6700\u9AD8 ${d.peakScore} \u5206 \xB7 \u5DF2\u5B8C\u6210\u5168\u90E8\u6269\u5EFA` : `Peak ${d.peakScore} \xB7 Fully expanded`);
    const upgrade = button(zh ? "\u6269\u5EFA\u89C2\u5BDF\u7AD9" : "Expand habitat", { action: "upgrade" }, !d.next?.available);
    const letter = ctx.ui.h("div", "terrarium-letter");
    const toggle = ctx.ui.button(zh ? `\u89C2\u5BDF\u7AD9\u6765\u4FE1 \xB7 ${d.guide.completed ? "\u5DF2\u8BFB\u5B8C" : d.guide.skipped ? "\u5DF2\u8DF3\u8FC7" : `${d.guide.step + 1}/${d.guide.total}`}` : `Letters \xB7 ${d.guide.step + 1}/${d.guide.total}`, { size: "sm", onClick: () => {
      showLetter = !showLetter;
      render();
    } });
    toggle.setAttribute("aria-expanded", String(showLetter));
    letter.append(toggle);
    if (showLetter && "title" in d.guide) {
      letter.append(ctx.ui.h("h3", "", d.guide.title), ctx.ui.h("p", "", d.guide.text), ctx.ui.h("p", "terrarium-letter-task", d.guide.task));
      const actions = ctx.ui.h("div", "terrarium-progress-actions");
      actions.append(button(zh ? d.guide.ready ? "\u9605\u8BFB\u4E0B\u4E00\u5C01\u4FE1" : "\u7B49\u5F85\u5B8C\u6210\u672C\u7AE0" : d.guide.ready ? "Next letter" : "Task pending", { action: "guide", step: d.guide.step }, !d.guide.ready), button(zh ? "\u8DF3\u8FC7\u5F15\u5BFC" : "Skip guide", { action: "skip" }));
      letter.append(actions);
    }
    const facilities = ctx.ui.h("div", "terrarium-facilities");
    for (const f of d.facilities) {
      const card = ctx.ui.h("article", `terrarium-facility${f.unlocked ? "" : " is-locked"}`);
      card.append(ctx.ui.h("strong", "", `${zh ? f.name : names[f.kind]} \xB7 ${zh ? "\u7B49\u7EA7" : "Lv"} ${f.level}`), ctx.ui.h("p", "", f.effect));
      const installed = f.installed;
      card.append(ctx.ui.h("div", "", !f.unlocked ? zh ? "\u5C1A\u672A\u89E3\u9501" : "Locked" : installed ? `${installed.enabled ? zh ? "\u8FD0\u884C\u4E2D" : "On" : zh ? "\u5DF2\u5173\u95ED" : "Off"} \xB7 (${installed.x},${installed.y})` : zh ? "\u53EF\u5EFA\u9020" : "Available"));
      const actions = ctx.ui.h("div", "terrarium-progress-actions");
      actions.append(button(zh ? `${installed ? "\u79FB\u5230" : "\u5EFA\u5728"} (${selected.x},${selected.y})` : `${installed ? "Move" : "Build"} (${selected.x},${selected.y})`, { action: "install", facility: f.kind, ...selected, enabled: true }, !f.unlocked));
      if (installed) actions.append(button(zh ? installed.enabled ? "\u5173\u95ED" : "\u5F00\u542F" : installed.enabled ? "Turn off" : "Turn on", { action: "install", facility: f.kind, x: installed.x, y: installed.y, enabled: !installed.enabled }));
      card.append(actions);
      facilities.append(card);
    }
    const parts = ctx.ui.h("div", "terrarium-progress-score", Object.entries(d.scoreParts).map(([key, value]) => `${zh ? { plants: "\u690D\u7269", bugs: "\u866B\u5B50", seeds: "\u79CD\u5B50", fish: "\u9C7C", water: "\u6C34\u73AF\u5883" }[key] : key} ${value}`).join(" \xB7 "));
    const rules = ctx.ui.h("div", "terrarium-score-rules");
    const rulesToggle = ctx.ui.button(zh ? "\u8BA1\u5206\u89C4\u5219" : "Score rules", { size: "sm", onClick: () => {
      showRules = !showRules;
      render();
    } });
    rulesToggle.setAttribute("aria-expanded", String(showRules));
    rules.append(rulesToggle);
    if (showRules) rules.append(ctx.ui.h("p", "", zh ? TERRARIUM_SCORE_RULES : "Only the strongest three of each species count at 100%, 50%, 25%. Seeds and extra watering add no points. Animal maturity reaches its maximum after 24 simulation hours. Water points: round(40 \xD7 min(oxygen, cleanliness)/100 \xD7 min(1, plant points/40, fish points/40))."));
    content.replaceChildren(head, limits, progress, score2, parts, rules, upgrade, letter, facilities);
  };
  return { el, update(state, cell) {
    current = state;
    if (cell) selected = cell;
    render();
  } };
}

// webui/deaths.ts
function createDeathHistory(ctx) {
  const zh = ctx.language.startsWith("zh");
  const el = ctx.ui.h("section", "terrarium-deaths");
  const list = ctx.ui.h("div", "terrarium-death-list");
  let records = [], expanded = false;
  const toggle = ctx.ui.button("", { size: "sm", onClick: () => {
    expanded = !expanded;
    render();
  } });
  const render = () => {
    toggle.textContent = `${zh ? "\u6B7B\u4EA1\u8BB0\u5F55" : "Death records"} \xB7 ${records.length} ${expanded ? zh ? "\u6536\u8D77" : "Hide" : zh ? "\u5C55\u5F00" : "Show"}`;
    toggle.setAttribute("aria-expanded", String(expanded));
    list.hidden = !expanded;
    list.replaceChildren(...records.slice().reverse().map((r) => {
      const o = r.organism;
      const card = ctx.ui.h("div", "terrarium-death");
      const values = Object.entries(o).filter(([key]) => ["health", "energy", "hunger", "ageHours"].includes(key)).map(([key, value]) => `${{ health: "\u5065\u5EB7", energy: "\u80FD\u91CF", hunger: "\u9965\u997F", ageHours: "\u5E74\u9F84(h)" }[zh ? key : ""] ?? key} ${Number(value).toFixed(1)}`);
      const meal = o.lastMeal;
      card.append(ctx.ui.h("strong", "", `${o.id} \xB7 ${o.species} \xB7 (${o.x},${o.y})`), ctx.ui.h("div", "", `${new Date(r.recordedAtMs).toLocaleString(ctx.language)} \xB7 ${r.cause}`), ctx.ui.h("div", "", values.join(" \xB7 ")), ctx.ui.h("div", "", `${zh ? "\u73AF\u5883" : "Environment"}: ${Object.entries(r.environment).map(([key, value]) => `${zh ? { phase: "\u65F6\u6BB5", moisture: "\u6C34\u5206", light: "\u5149\u7167", oxygen: "\u542B\u6C27", cleanliness: "\u6C34\u8D28" }[key] ?? key : key} ${typeof value === "number" ? value.toFixed(1) : zh && value === "day" ? "\u767D\u5929" : zh && value === "night" ? "\u591C\u665A" : value}`).join(" \xB7 ")}`));
      if ("energy" in o) card.append(ctx.ui.h("div", "", meal ? `${zh ? "\u6700\u8FD1\u5B9E\u9645\u53D6\u98DF" : "Last actual meal"}: ${new Date(meal.atMs).toLocaleString(ctx.language)} \xB7 ${zh ? { foraging: "\u5B9E\u9645\u53D6\u98DF", fish: "\u6355\u98DF", food: "\u9972\u6599", algae: "\u6D77\u85FB" }[meal.kind] ?? meal.kind : meal.kind}${meal.id ? ` (${meal.id})` : ""}` : zh ? "\u6700\u8FD1\u5B9E\u9645\u53D6\u98DF\uFF1A\u672A\u8BB0\u5F55" : "Last actual meal: not recorded"));
      return card;
    }));
  };
  el.append(toggle, list);
  return { el, update(value = []) {
    records = value;
    render();
  } };
}

// webui/care.ts
function returnReportText(report, zh) {
  if (!report) return [];
  const names = zh ? { score: "\u5206\u6570", meanMoisture: "\u5E73\u5747\u571F\u6E7F", oxygen: "\u542B\u6C27", cleanliness: "\u6C34\u8D28", plants: "\u690D\u7269", bugs: "\u866B\u5B50", seeds: "\u79CD\u5B50", fish: "\u9C7C" } : {};
  const summary = report.changes.filter((c) => ["score", "meanMoisture", "oxygen", "cleanliness", "plants", "bugs", "seeds", "fish"].includes(c.metric)).map((c) => `${names[c.metric] ?? c.metric} ${c.before.toFixed(1)} \u2192 ${c.after.toFixed(1)}`);
  return [zh ? `\u56DE\u5F52\u81EA\u68C0 \xB7 \u8DDD\u5B58\u6863 ${report.elapsedHours.toFixed(1)}h \xB7 \u5DF2\u8865\u7B97 ${report.simulatedHours.toFixed(1)}h` : `Return report \xB7 ${report.elapsedHours.toFixed(1)}h since save \xB7 ${report.simulatedHours.toFixed(1)}h simulated`, ...summary, ...report.warnings, ...report.removed.length ? [`${zh ? "\u5DF2\u4E0D\u5728\u7BB1\u5185" : "No longer active"}: ${report.removed.map((p) => `${p.id} (${p.species}) (${p.x},${p.y})`).join(", ")}`] : []];
}
function careText(care, zh) {
  const lines = [zh ? `${care.phase === "night" ? "\u8DDD\u79BB\u5929\u4EAE" : "\u8DDD\u79BB\u591C\u665A"} ${care.hoursUntilChange.toFixed(1)} \u5C0F\u65F6` : `${care.hoursUntilChange.toFixed(1)} hours until ${care.phase === "night" ? "daylight" : "night"}`];
  if ("summary" in care) lines.push(zh ? `\u6574\u7BB1\u6982\u89C8 \xB7 \u571F\u6E7F ${care.summary.minMoisture.toFixed(1)}\u2013${care.summary.maxMoisture.toFixed(1)} \xB7 \u7F3A\u6C34 ${care.summary.dryPlants} \u682A \xB7 \u8FC7\u6E7F ${care.summary.wetPlants} \u682A \xB7 \u4F4E\u5065\u5EB7 ${care.summary.lowHealth} \u682A` : `Overview \xB7 moisture ${care.summary.minMoisture.toFixed(1)}\u2013${care.summary.maxMoisture.toFixed(1)} \xB7 dry ${care.summary.dryPlants} \xB7 wet ${care.summary.wetPlants} \xB7 low health ${care.summary.lowHealth}`);
  for (const p of care.plants) {
    const reasons = [];
    if (p.waitForDaylight) reasons.push(zh ? "\u7B49\u5929\u4EAE" : "waiting for daylight");
    if ("moistureShortfall" in p) {
      if (p.moistureShortfall) reasons.push(`${zh ? "\u7F3A\u6C34" : "moisture shortfall"} ${p.moistureShortfall.toFixed(1)}`);
      if (p.moistureExcess) reasons.push(`${zh ? "\u6C34\u5206\u8D85\u51FA\u4E0A\u9650" : "excess moisture"} ${p.moistureExcess.toFixed(1)}`);
      if (p.lightShortfall) reasons.push(`${zh ? "\u767D\u5929\u5149\u7167\u8FD8\u5DEE" : "daylight shortfall"} ${p.lightShortfall.toFixed(2)}`);
      if (p.lightExcess) reasons.push(`${zh ? "\u767D\u5929\u5149\u7167\u8D85\u51FA" : "excess daylight"} ${p.lightExcess.toFixed(2)}`);
    } else if (p.cleanlinessShortfall) reasons.push(`${zh ? "\u6C34\u8D28\u8FD8\u5DEE" : "cleanliness shortfall"} ${p.cleanlinessShortfall.toFixed(1)}`);
    lines.push(`${p.id} \xB7 ${p.nextStage === null ? zh ? "\u5DF2\u5230\u6700\u9AD8\u9636\u6BB5" : "fully grown" : `${Math.round(p.progress * 100)}% \xB7 ${zh ? "\u4E0B\u9636\u6BB5\u8FD8\u9700\u9002\u5B9C\u767D\u5929\u6A21\u62DF\u5C0F\u65F6" : "suitable daylight remaining"} ${p.suitableHoursRemaining.toFixed(1)}h`}${reasons.length ? ` \xB7 ${reasons.join(" / ")}` : ""}`);
    if ("advice" in p && p.advice) lines.push(p.advice);
  }
  if ("seeds" in care) for (const s of care.seeds) lines.push(`${s.id} \xB7 ${zh ? "\u53D1\u82BD\u8FD8\u9700\u9002\u5B9C\u767D\u5929\u6A21\u62DF\u5C0F\u65F6" : "suitable daylight until sprouting"} ${s.suitableDaylightHoursRemaining.toFixed(1)}h${s.waitForDaylight ? zh ? " \xB7 \u7B49\u5929\u4EAE" : " \xB7 waiting for daylight" : ""}${s.moistureShortfall ? ` \xB7 ${zh ? "\u7F3A\u6C34" : "moisture shortfall"} ${s.moistureShortfall.toFixed(1)}` : ""}`);
  if ("oxygenForecast" in care) lines.push(zh ? `\u5929\u4EAE\u542B\u6C27\u4F30\u8BA1 ${care.oxygenForecast.oxygen.toFixed(1)}\uFF1B\u5047\u5B9A\u671F\u95F4\u4E0D\u4EBA\u5DE5\u64CD\u4F5C\uFF0C\u5B9E\u9645\u53EF\u80FD\u53D8\u5316\u3002` : `Estimated dawn oxygen ${care.oxygenForecast.oxygen.toFixed(1)}; assumes no caretaker actions.`);
  const goals = zh ? { "healthy-diversity": "\u5065\u5EB7\u690D\u7269\u79CD\u7C7B", "three-blooms": "\u540C\u65F6\u5F00\u82B1", "stocked-colony": "\u8681\u5DE2\u50A8\u7CAE", "healthy-aquatic-diversity": "\u5065\u5EB7\u6C34\u8349\u79CD\u7C7B", "balanced-water": "\u6C27\u6C14\u4E0E\u6C34\u8D28\u5747\u8861" } : {};
  for (const g of care.goals) lines.push(`${goals[g.id] ?? g.id}: ${Math.min(g.current, g.target).toFixed(0)}/${g.target}`);
  if ("suggestedFoodCleanup" in care && care.suggestedFoodCleanup.length) lines.push(`${zh ? "\u5EFA\u8BAE\u6E05\u7406\u6B8B\u9975" : "Suggested food cleanup"}: ${care.suggestedFoodCleanup.join(", ")}`);
  if ("feeding" in care) {
    for (const f of care.feeding) if (f.lastMeal) lines.push(`${f.fishId} \xB7 ${zh ? "\u6700\u8FD1\u53D6\u98DF" : "Last meal"}: ${f.lastMeal.id} (${f.lastMeal.kind}) \xB7 ${new Date(f.lastMeal.atMs).toISOString()}`);
  }
  return lines;
}
function createCareControls(ctx, habitat, reload) {
  const zh = ctx.language.startsWith("zh"), el = ctx.ui.h("div", "terrarium-care"), status = ctx.ui.h("div", "");
  status.setAttribute("role", "status");
  const hint = ctx.ui.h("div", "", zh ? "\u6536\u85CF\u540E\u6682\u505C\u751F\u957F\u4E0E\u6D88\u8017\uFF0C\u4E0D\u8BA1\u5206\uFF1B\u5BB9\u91CF\u968F\u7B49\u7EA7\u6269\u5EFA\uFF0C\u653E\u56DE\u4ECD\u53D7\u5BB9\u91CF\u9650\u5236\u3002" : "Collected organisms are frozen and unscored; capacity expands with level. Restoring uses normal capacity.");
  const actions = ctx.ui.h("div", "terrarium-watering-buttons");
  let busy = false;
  const run = async (args) => {
    if (busy || ctx.signal.aborted) return;
    busy = true;
    try {
      await ctx.invoke("care", [args]);
      if (!ctx.signal.aborted) {
        status.textContent = zh ? "\u5DF2\u4FDD\u5B58" : "Saved";
        await reload();
      }
    } catch (e) {
      if (!ctx.signal.aborted) status.textContent = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  };
  el.append(hint, actions, status);
  return { el, update(state, cell = { x: 2, y: 2 }) {
    hint.textContent = zh ? `\u6536\u85CF\u540E\u6682\u505C\u6A21\u62DF\u3001\u4E0D\u8BA1\u5206\uFF1B\u5F53\u524D\u6536\u85CF\u5BB9\u91CF ${capacity(state).collection}\uFF0C\u653E\u56DE\u4ECD\u53D7\u751F\u7269\u548C\u5360\u683C\u9650\u5236\u3002` : `Collected organisms are frozen and unscored; collection capacity ${capacity(state).collection}. Restoring uses normal limits.`;
    actions.replaceChildren();
    const add = (text, args, disabled = false) => {
      const button = ctx.ui.button(text, { size: "sm", onClick: () => {
        void run(args);
      } });
      button.disabled = disabled;
      actions.append(button);
    };
    if (habitat === "land") {
      const allowed = state.soil?.find((c) => c.x === cell.x && c.y === cell.y)?.allowAntForaging !== false;
      add(zh ? `(${cell.x},${cell.y}) ${allowed ? "\u7981\u6B62" : "\u5141\u8BB8"}\u8682\u8681\u91C7\u96C6` : `${allowed ? "Forbid" : "Allow"} ant harvesting in selected cell`, { tool: "terrarium_set_ant_foraging", ...cell, enabled: !allowed });
      for (const nest of state.nests ?? []) add(`${nest.id} ${zh ? "\u6DFB\u7CAE 5 \u4EFD" : "add 5 food"}`, { tool: "terrarium_feed_nest", id: nest.id, portions: 5 });
      add(zh ? `(${cell.x},${cell.y}) \u6392\u6C34 10` : "Drain selected cell by 10", { tool: "terrarium_drain", ...cell, amount: 10 });
      add(zh ? "\u9009\u4E2D\u683C\u6BCF\u5C0F\u65F6\u8865\u5230 60" : "Selected cell: hourly target 60", { tool: "terrarium_set_irrigation", ...cell, enabled: true, targetMoisture: 60 });
      add(zh ? "\u5173\u95ED\u9009\u4E2D\u683C\u5B9A\u65F6\u6D47\u6C34" : "Disable selected cell irrigation", { tool: "terrarium_set_irrigation", ...cell, enabled: false });
    } else {
      for (const food of state.food ?? []) add(`${zh ? "\u6E05\u7406\u6B8B\u9975" : "Remove food"} ${food.id}`, { tool: "terrarium_cleanup_food", id: food.id });
      for (const species of ["waterweed", "waterlily", "algae"]) add(`${zh ? "\u9009\u4E2D\u683C\u79CD\u690D" : "Plant selected cell"} ${species}`, { tool: "terrarium_plant_aquatic_area", species, x1: cell.x, y1: cell.y, x2: cell.x, y2: cell.y });
    }
    for (const p of [...state.plants, ...state.bugs ?? [], ...state.fish ?? [], ...state.seeds ?? []]) add(`${zh ? "\u6536\u85CF" : "Collect"} ${p.id}`, { tool: "terrarium_collection", action: "collect", id: p.id });
    for (const item of state.collection ?? []) {
      const blocked = ["plant", "seed", "aquatic"].includes(item.kind) && [...state.plants, ...state.seeds ?? []].some((p) => {
        const position = p;
        return position.x === cell.x && position.y === cell.y;
      });
      add(`${blocked ? zh ? "\u8BF7\u5148\u9009\u7A7A\u683C\u518D\u653E\u56DE" : "Select an empty cell to restore" : zh ? "\u653E\u56DE\u9009\u4E2D\u683C" : "Restore to selected cell"} ${item.specimen.id}`, { tool: "terrarium_collection", action: "restore", id: item.specimen.id, ...cell }, blocked);
    }
  } };
}

// src/habitat.ts
var TERRARIUM_PLANT_LOW_HEALTH = 20;
var TERRARIUM_PLANT_RECOVERED_HEALTH = 35;
var TERRARIUM_PLANT_REQUIREMENTS = {
  fern: { minMoisture: 30, maxMoisture: 85, minLight: 0.15, maxLight: 0.7 },
  clover: { minMoisture: 20, maxMoisture: 80, minLight: 0.45, maxLight: 1 },
  moss: { minMoisture: 45, maxMoisture: 90, minLight: 0.15, maxLight: 0.4 },
  basil: { minMoisture: 30, maxMoisture: 75, minLight: 0.65, maxLight: 1 },
  bean: { minMoisture: 25, maxMoisture: 70, minLight: 0.7, maxLight: 1 }
};
function wateringReport(plants, cells) {
  const watered = plants.filter((plant) => cells.some((cell) => cell.x === plant.x && cell.y === plant.y)).map((plant) => {
    const { minMoisture, maxMoisture } = TERRARIUM_PLANT_REQUIREMENTS[plant.species];
    const moisture = cells.find((cell) => cell.x === plant.x && cell.y === plant.y).moisture;
    return { ...plant, moisture, minMoisture, maxMoisture, belowMaximum: maxMoisture - moisture, moistureDeficit: Math.max(0, minMoisture - moisture), moistureStatus: moisture > maxMoisture ? "high" : moisture < minMoisture ? "low" : "suitable" };
  });
  const warnings = watered.filter((plant) => plant.moistureStatus !== "suitable").map((plant) => `${plant.id}\uFF08${plant.species}\uFF09(${plant.x},${plant.y}) \u6C34\u5206${plant.moistureStatus === "high" ? "\u8FC7\u9AD8" : "\u8FC7\u4F4E"}\uFF1A${plant.moisture.toFixed(1)}\uFF0C\u9002\u5B9C ${plant.minMoisture}\u2013${plant.maxMoisture}\uFF1B\u6301\u7EED\u8D85\u9650\u6BCF\u5C0F\u65F6\u635F\u5931 0.5 \u5065\u5EB7\u3002`);
  return { plants: watered, warnings };
}
function daylight(habitat, x, y) {
  const shaded = habitat.items.some((item) => item.id === "pebble" && Math.abs(item.x - x) + Math.abs(item.y - y) <= 1);
  let light = (0.6 + x * 0.4 / (capacity(habitat).size - 1)) * (shaded ? 0.35 : 1);
  if (nearFacility(habitat, "shade", x, y)) light *= 0.6;
  if (nearFacility(habitat, "grow_light", x, y)) light = Math.max(0.75, light);
  return light;
}
var TERRARIUM_FLOWER_BUD_HOURS = 12;
var TERRARIUM_FLOWER_BLOOM_HOURS = 18;
function flowerStage(plant) {
  if (plant.species !== "clover" && plant.species !== "basil" && plant.species !== "bean") return;
  const needs = TERRARIUM_PLANT_REQUIREMENTS[plant.species];
  if (plant.health < TERRARIUM_PLANT_RECOVERED_HEALTH || plant.dry || plant.moisture < needs.minMoisture || plant.moisture > needs.maxMoisture) return;
  if ((plant.growthHours ?? 0) >= TERRARIUM_FLOWER_BLOOM_HOURS) return "bloom";
  if ((plant.growthHours ?? 0) >= TERRARIUM_FLOWER_BUD_HOURS) return "bud";
}
function validateWatering(options) {
  if (options.amount !== void 0 && (typeof options.amount !== "number" || !Number.isFinite(options.amount) || options.amount <= 0 || options.amount > 100) || options.targetMoisture !== void 0 && (typeof options.targetMoisture !== "number" || !Number.isFinite(options.targetMoisture) || options.targetMoisture < 0 || options.targetMoisture > 100) || options.amount !== void 0 && options.targetMoisture !== void 0 || options.onlyDry !== void 0 && typeof options.onlyDry !== "boolean") throw new Error("Supply amount (0..100, excluding zero) OR targetMoisture (0..100), and optional onlyDry");
}
function waterAdded(moisture, options) {
  validateWatering(options);
  return Math.max(0, Math.min(100 - moisture, options.targetMoisture === void 0 ? options.amount ?? 35 : options.targetMoisture - moisture));
}

// webui/watering.ts
function createWateringControls(ctx, reload) {
  const zh = ctx.language.startsWith("zh");
  const el = ctx.ui.h("div", "terrarium-watering");
  const status = ctx.ui.h("div", "terrarium-watering-status");
  status.setAttribute("role", "status");
  const hint = ctx.ui.h("div", "terrarium-watering-hint", zh ? "\u9009\u62E9\u6C34\u91CF\u6216\u76EE\u6807\u6C34\u5206\uFF1B\u5B9E\u9645\u6D47\u6C34\u7684\u690D\u7269 +5 \u5065\u5EB7\u3002" : "Choose a dose or moisture target; actually watered plants gain 5 health.");
  const preview = ctx.ui.h("div", "terrarium-watering-status");
  let amount = 35, targetMoisture, onlyDry = false;
  let lastState;
  let busy = false, claimed = false, cell;
  const buttons = ctx.ui.h("div", "terrarium-watering-buttons");
  const nearby = ctx.ui.button(zh ? "\u6D47\u9009\u4E2D\u683C\u53CA\u5468\u56F4" : "Water selected neighborhood", { size: "sm", onClick: () => {
    if (cell) void submit(Math.max(0, cell.x - 1), Math.max(0, cell.y - 1), Math.min(capacity(lastState ?? {}).size - 1, cell.x + 1), Math.min(capacity(lastState ?? {}).size - 1, cell.y + 1));
  } });
  const all = ctx.ui.button(zh ? "\u6D47\u5168\u90E8 25 \u683C" : "Water all 25 cells", { size: "sm", onClick: () => {
    void submit(0, 0, capacity(lastState ?? {}).size - 1, capacity(lastState ?? {}).size - 1);
  } });
  const updateButtons = () => {
    nearby.disabled = busy || !claimed || !cell;
    all.disabled = busy || !claimed;
  };
  const submit = async (x1, y1, x2, y2) => {
    if (busy || !claimed || ctx.signal.aborted) return;
    busy = true;
    updateButtons();
    status.textContent = zh ? "\u6D47\u6C34\u4E2D\u2026" : "Watering\u2026";
    try {
      const response = await ctx.invoke("water", [{ x1, y1, x2, y2, ...amount === void 0 ? { targetMoisture } : { amount }, onlyDry }]);
      if (ctx.signal.aborted) return;
      const count = (x2 - x1 + 1) * (y2 - y1 + 1);
      status.textContent = zh ? `\u5DF2\u6D47\u6C34\uFF1A${count} \u683C (${x1},${y1})\u2013(${x2},${y2})` : `Watered ${count} cells (${x1},${y1})\u2013(${x2},${y2})`;
      const warnings = response.watering.plants.filter((plant) => plant.moistureStatus !== "suitable").map((plant) => zh ? `${plant.id} (${plant.x},${plant.y}) \u6C34\u5206${plant.moistureStatus === "high" ? "\u8FC7\u9AD8" : "\u8FC7\u4F4E"} ${plant.moisture.toFixed(1)}\uFF08\u9002\u5B9C ${plant.minMoisture}\u2013${plant.maxMoisture}\uFF09` : `${plant.id} (${plant.x},${plant.y}) moisture too ${plant.moistureStatus === "high" ? "high" : "low"}: ${plant.moisture.toFixed(1)} (range ${plant.minMoisture}\u2013${plant.maxMoisture})`);
      if (warnings.length) status.textContent += ` \xB7 ${warnings.join("\uFF1B")}`;
      await reload();
    } catch (error) {
      if (!ctx.signal.aborted) status.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
      updateButtons();
    }
  };
  buttons.append(nearby, all);
  const modes = ctx.ui.h("div", "terrarium-watering-buttons");
  const modeButtons = [];
  const refreshModes = () => {
    modeButtons.forEach((b, i) => b.setAttribute("aria-pressed", String(i < 3 ? amount === [10, 20, 35][i] : targetMoisture === 60)));
    dry.setAttribute("aria-pressed", String(onlyDry));
    renderPreview();
  };
  for (const dose of [10, 20, 35]) {
    const button = ctx.ui.button(`+${dose}`, { size: "sm", onClick: () => {
      amount = dose;
      targetMoisture = void 0;
      refreshModes();
    } });
    modeButtons.push(button);
    modes.append(button);
  }
  const target = ctx.ui.button(zh ? "\u6D47\u5230 60" : "Target 60", { size: "sm", onClick: () => {
    amount = void 0;
    targetMoisture = 60;
    refreshModes();
  } });
  modeButtons.push(target);
  modes.append(target);
  const dry = ctx.ui.button(zh ? "\u53EA\u6D47\u7F3A\u6C34\u683C" : "Only dry cells", { size: "sm", onClick: () => {
    onlyDry = !onlyDry;
    refreshModes();
  } });
  modes.append(dry);
  const renderPreview = () => {
    const risks = lastState ? wateringReport(lastState.plants, lastState.soil.map((soil) => {
      const plant = lastState.plants.find((p) => p.x === soil.x && p.y === soil.y);
      const minimum = plant ? TERRARIUM_PLANT_REQUIREMENTS[plant.species].minMoisture : 30;
      return { ...soil, moisture: soil.moisture + (onlyDry && soil.moisture >= minimum ? 0 : waterAdded(soil.moisture, { amount, targetMoisture })) };
    })).plants.filter((plant) => plant.moistureStatus === "high") : [];
    preview.textContent = risks.length ? (zh ? "\u5168\u7BB1\u6D47\u6C34\u5C06\u8D85\u91CF\uFF1A" : "Watering all cells would exceed moisture limits: ") + risks.map((plant) => `${plant.id} (${plant.x},${plant.y}) ${plant.moisture.toFixed(1)} > ${plant.maxMoisture}`).join("\uFF1B") : "";
  };
  el.append(modes);
  refreshModes();
  el.append(buttons, hint, preview, status);
  updateButtons();
  return { el, update(available, selected, state) {
    claimed = available;
    cell = selected;
    el.hidden = !claimed;
    updateButtons();
    lastState = state;
    renderPreview();
    all.textContent = zh ? `\u6D47\u5168\u90E8 ${capacity(state ?? {}).size ** 2} \u683C` : `Water all ${capacity(state ?? {}).size ** 2} cells`;
    nearby.title = cell ? `(${Math.max(0, cell.x - 1)},${Math.max(0, cell.y - 1)})\u2013(${Math.min(capacity(lastState ?? {}).size - 1, cell.x + 1)},${Math.min(capacity(lastState ?? {}).size - 1, cell.y + 1)})` : "";
  } };
}

// src/feedback.ts
var TERRARIUM_MAX_FEEDBACK_TEXT = 2e3;
function parseFeedback(value) {
  const input = value;
  if (!input || typeof input.text !== "string" || !input.text.trim() || input.text.length > TERRARIUM_MAX_FEEDBACK_TEXT || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input.text)) throw new Error("Feedback text must contain 1..2000 characters without control characters");
  if (input.contact !== void 0 && (typeof input.contact !== "string" || input.contact.length > 200 || /[\x00-\x1f\x7f]/.test(input.contact))) throw new Error("Feedback contact must be at most 200 characters without control characters");
  return { text: input.text.trim(), ...input.contact?.trim() ? { contact: input.contact.trim() } : {} };
}

// webui/feedback.ts
var nextId = 0;
function createFeedbackControls(ctx) {
  const zh = ctx.language.startsWith("zh"), prefix = `terrarium-feedback-${++nextId}`;
  const root = ctx.ui.h("section", "terrarium-feedback");
  const panel = ctx.ui.h("div", "terrarium-feedback-panel");
  panel.id = prefix;
  panel.hidden = true;
  const toggle = ctx.ui.button(zh ? "\u610F\u89C1\u53CD\u9988" : "Send feedback", { size: "sm", onClick: () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) text.focus();
  } });
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", prefix);
  const form = document.createElement("form");
  const label = document.createElement("label");
  label.textContent = zh ? "\u53CD\u9988\u5185\u5BB9\uFF08\u6700\u591A 2000 \u5B57\uFF09" : "Feedback (up to 2000 characters)";
  const text = document.createElement("textarea");
  text.maxLength = 2e3;
  text.rows = 4;
  text.name = "text";
  label.append(text);
  const contactLabel = document.createElement("label");
  contactLabel.textContent = zh ? "\u8054\u7CFB\u65B9\u5F0F\uFF08\u9009\u586B\uFF09" : "Contact (optional)";
  const contact = document.createElement("input");
  contact.maxLength = 200;
  contact.name = "contact";
  contact.autocomplete = "off";
  contactLabel.append(contact);
  const privacy = ctx.ui.h("p", "", zh ? "\u4EC5\u670D\u52A1\u7AEF\u7BA1\u7406\u5458\u53EF\u89C1\u3002" : "Visible only to the service administrator.");
  const status = ctx.ui.h("p", "terrarium-feedback-status");
  status.setAttribute("role", "status");
  const submit = ctx.ui.button(zh ? "\u63D0\u4EA4\u53CD\u9988" : "Submit feedback", { size: "sm" });
  submit.type = "submit";
  let pending = false;
  const send = async () => {
    if (pending) return;
    try {
      const input = parseFeedback({ text: text.value, contact: contact.value });
      pending = true;
      submit.disabled = true;
      text.disabled = true;
      contact.disabled = true;
      status.textContent = zh ? "\u63D0\u4EA4\u4E2D\u2026" : "Submitting\u2026";
      const receipt = await ctx.invoke("feedback", [input]);
      if (ctx.signal.aborted) return;
      status.textContent = zh ? `\u5DF2\u63D0\u4EA4\uFF0C\u7F16\u53F7 #${receipt.id}` : `Submitted, reference #${receipt.id}`;
      text.value = "";
      contact.value = "";
    } catch (error) {
      if (!ctx.signal.aborted) status.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      pending = false;
      submit.disabled = false;
      text.disabled = false;
      contact.disabled = false;
    }
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void send();
  });
  form.append(label, contactLabel, privacy, submit, status);
  panel.append(form);
  root.append(toggle, panel);
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      panel.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      toggle.focus();
    }
  });
  return root;
}

// webui/sync.ts
function createSyncControls(ctx, reload) {
  const zh = ctx.language.startsWith("zh");
  const el = ctx.ui.h("div", "terrarium-sync");
  const status = ctx.ui.h("div", "terrarium-sync-status");
  status.setAttribute("role", "status");
  let busy = false, available = false;
  const button = ctx.ui.button(zh ? "\u7ACB\u5373\u5B8C\u6574\u540C\u6B65" : "Sync full snapshot", { size: "sm", onClick: () => {
    void sync();
  } });
  const sync = async () => {
    if (busy || !available) return;
    busy = true;
    button.disabled = true;
    el.dataset.state = "syncing";
    status.textContent = zh ? "\u4E0A\u62A5\u4E2D\u2026" : "Uploading\u2026";
    try {
      await ctx.invoke("sync");
      busy = false;
      await reload();
    } catch (error) {
      if (!ctx.signal.aborted) {
        el.dataset.state = "error";
        status.textContent = error instanceof Error ? error.message : String(error);
      }
    } finally {
      busy = false;
      button.disabled = !available;
    }
  };
  el.append(status, button);
  return { el, update(value, claimed) {
    if (ctx.signal.aborted) return;
    available = claimed && value.state !== "disabled";
    button.disabled = busy || !available;
    if (busy) return;
    el.dataset.state = value.state;
    const labels = zh ? { disabled: "\u516C\u5F00\u4E0A\u62A5\u5DF2\u5173\u95ED", idle: "\u5C1A\u672A\u4E0A\u62A5", syncing: "\u4E0A\u62A5\u4E2D\u2026", synced: "\u6700\u8FD1\u4E0A\u62A5\u6210\u529F", error: "\u4E0A\u62A5\u5931\u8D25" } : { disabled: "Public reporting disabled", idle: "No report yet", syncing: "Uploading\u2026", synced: "Last upload succeeded", error: "Upload failed" };
    const parts = [labels[value.state], `${zh ? "\u5BA2\u6237\u7AEF" : "Client"} ${value.clientVersion}`];
    if (value.lastSuccessStateAt) parts.push(`${zh ? "\u5DF2\u63D0\u4EA4\u6A21\u62DF\u65F6\u95F4" : "Accepted simulation time"} ${new Date(value.lastSuccessStateAt).toLocaleString(ctx.language)}`);
    if (value.nextRetryAt) parts.push(`${zh ? "\u4E0B\u6B21\u91CD\u8BD5" : "Next retry"} ${new Date(value.nextRetryAt).toLocaleString(ctx.language)}`);
    if (value.transport) parts.push(value.transport === "ws" ? "WebSocket" : zh ? "HTTP \u517C\u5BB9\u6A21\u5F0F" : "HTTP compatibility");
    if (value.transport === "ws" && value.mode === "incremental") parts.push(zh ? "\u589E\u91CF" : "Incremental");
    if (value.lastSuccessAt) parts.push(`${zh ? "\u6700\u8FD1\u6210\u529F" : "Last success"} ${new Date(value.lastSuccessAt).toLocaleString(ctx.language)}`);
    if (value.state === "error") parts.push(`${zh ? "\u8FDE\u7EED\u5931\u8D25" : "Consecutive failures"} ${value.consecutiveFailures}`, value.lastError ?? "");
    status.textContent = parts.filter(Boolean).join(" \xB7 ");
  } };
}

// webui/history.ts
function drawScoreHistory(samples, zh, language) {
  const el = document.createElement("div"), title = document.createElement("h3");
  title.textContent = zh ? "\u81EA\u5DF1\u7684\u5206\u6570 \xB7 \u6700\u8FD1 24 \u5C0F\u65F6\uFF08\u672C\u5730\u6A21\u62DF\uFF09" : "Your score \xB7 Last 24 hours (local simulation)";
  const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 800 205");
  svg.classList.add("terrarium-history");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", title.textContent);
  const add = (tag, attrs, text) => {
    const node = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (text !== void 0) node.textContent = text;
    svg.append(node);
  };
  const maximum = Math.max(10, ...samples.map((s) => s.score ?? 0));
  for (const value of [0, maximum / 2, maximum]) {
    const y = String(164 - value / maximum * 140);
    add("line", { x1: "44", x2: "740", y1: y, y2: y, stroke: "currentColor", opacity: ".15" });
    add("text", { x: "36", y, "text-anchor": "end", fill: "currentColor", "font-size": "12" }, value.toFixed(0));
  }
  for (const d of historyPaths(samples.map((s) => ({ recordedAtMs: s.recordedAtMs, value: s.score })), maximum)) add("path", { d, fill: "none", stroke: "#398db0", "stroke-width": "2.5" });
  if (samples.filter((s) => s.score !== null).length < 2) add("text", { x: "400", y: "90", "text-anchor": "middle", fill: "currentColor" }, zh ? "\u7B49\u5F85\u65B0\u7684\u5C0F\u65F6\u6837\u672C\uFF1B\u65E7\u8BB0\u5F55\u6216\u65E7\u516C\u5F0F\u5206\u6570\u7559\u7A7A\u3002" : "Waiting for hourly samples; older or previous-formula scores remain blank.");
  for (const [sample, x, anchor] of [[samples[0], "44", "start"], [samples.at(-1), "740", "end"]]) if (sample) add("text", { x, y: "190", "text-anchor": anchor, fill: "currentColor", "font-size": "12" }, new Date(sample.recordedAtMs).toLocaleString(language));
  el.append(title, svg);
  return el;
}
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
function drawHistory(history, selected, labels, language, gridSize = 5) {
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
      const value = soil ? Math.floor(Number(selected.slice(5)) / gridSize) < (sample.gridSize ?? 5) && Number(selected.slice(5)) % gridSize < (sample.gridSize ?? 5) ? sample.soilMoisture[Math.floor(Number(selected.slice(5)) / gridSize) * (sample.gridSize ?? 5) + Number(selected.slice(5)) % gridSize] : null : plant?.[line.field];
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

// ../../../packages/cortico-world-terrarium/node_modules/.pnpm/cortico@0.2.1/node_modules/cortico/src/core/language.ts
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

// ../../../packages/cortico-world-terrarium/node_modules/.pnpm/terrarium-renderer@0.1.0/node_modules/terrarium-renderer/dist/types.js
function sceneSize(scene) {
  return scene.gridSize ?? 5;
}

// ../../../packages/cortico-world-terrarium/node_modules/.pnpm/terrarium-renderer@0.1.0/node_modules/terrarium-renderer/dist/geometry.js
var LAND_SURFACE = { x: 84, y: 204, width: 632, height: 216 };
var WATER_SURFACE = { x: 90, y: 128, width: 620, height: 286 };
function cellPosition(surface, x, y, size) {
  return { x: surface.x + (x + 0.5) * surface.width / size, y: surface.y + (y + 0.5) * surface.height / size };
}
function plotPosition(x, y, size = 5) {
  return cellPosition(LAND_SURFACE, x, y, size);
}
function residentScale(size) {
  return 5 / size;
}

// ../../../packages/cortico-world-terrarium/node_modules/.pnpm/terrarium-renderer@0.1.0/node_modules/terrarium-renderer/dist/flowers.js
function drawPlantFlowers(g, plant, x, y, night) {
  const stage = plant.flower;
  if (!stage)
    return;
  g.save();
  g.translate(x, y);
  g.lineCap = "round";
  const stem = (tx, ty) => {
    g.strokeStyle = "#568451";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, 8);
    g.quadraticCurveTo(tx * 0.35, ty * 0.6, tx, ty);
    g.stroke();
  };
  const petal = (px, py, rx, ry, angle, color) => {
    g.fillStyle = color;
    g.beginPath();
    g.ellipse(px, py, rx, ry, angle, 0, Math.PI * 2);
    g.fill();
  };
  const bud = (px, py, color) => {
    petal(px, py, 4, 7, -0.15, color);
    g.fillStyle = "#5f965a";
    g.beginPath();
    g.moveTo(px - 5, py + 3);
    g.lineTo(px, py + 7);
    g.lineTo(px + 5, py + 2);
    g.lineTo(px, py + 4);
    g.fill();
  };
  if (plant.species === "clover") {
    for (const [tx, ty, scale] of [[-16, -19, 0.8], [11, -34, 1], [29, -9, 0.7]]) {
      stem(tx, ty + 8);
      g.save();
      g.translate(tx, ty);
      g.scale(scale, scale);
      if (stage === "bud" || night)
        bud(0, 0, "#d49cb4");
      else {
        petal(0, 2, 13, 11, 0, "#c47b9a");
        for (let ring = 0; ring < 3; ring++) {
          const count = 12 - ring * 3, radius = 9 - ring * 3;
          for (let i = 0; i < count; i++) {
            const angle = i * Math.PI * 2 / count + ring * 0.4;
            petal(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.8, 2.6, 5, angle + Math.PI / 2, ["#edb4c8", "#f7cfda", "#fff0e9"][ring]);
          }
        }
      }
      g.restore();
    }
  } else if (plant.species === "basil") {
    stem(0, -49);
    for (let level = 0; level < 5; level++)
      for (const side of [-1, 1]) {
        const px = side * (8 - level), py = -7 - level * 9;
        stem(px, py + 2);
        if (stage === "bud" || night)
          bud(px, py, "#b7a8ce");
        else {
          petal(px, py, 5, 4, side * 0.6, "#c8b5de");
          petal(px + side * 2, py + 2, 5, 3, -side * 0.25, "#f8efff");
          petal(px - side, py - 2, 3, 4, side * 0.3, "#eee4f7");
          petal(px + side * 3, py + 1, 1.5, 1.5, 0, "#d3a56b");
        }
      }
    bud(0, -51, "#c3b7d4");
  } else {
    for (const [tx, ty] of [[-15, -18], [20, -32], [31, -5]]) {
      stem(tx, ty + 6);
      if (stage === "bud" || night)
        bud(tx, ty, "#d69ab1");
      else {
        petal(tx, ty - 4, 12, 10, -0.15, "#d88fac");
        petal(tx, ty - 7, 9, 7, -0.15, "#f7cbd9");
        petal(tx - 7, ty + 3, 9, 5, 0.6, "#e9a6c0");
        petal(tx + 7, ty + 3, 9, 5, -0.6, "#f0b7ce");
        petal(tx + 1, ty + 5, 5, 6, -0.2, "#fff0e9");
        petal(tx + 1, ty + 2, 2, 2, 0, "#d6ab65");
      }
    }
  }
  g.restore();
}

// ../../../packages/cortico-world-terrarium/node_modules/.pnpm/terrarium-renderer@0.1.0/node_modules/terrarium-renderer/dist/nest-viewer.js
var NEST_SIZE = 4;
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
:root:is([data-theme="dark"],[data-color-mode="dark"]) .tn-dialog{background:#23251d;color:#e4e3ce;border-color:#65634b}
:root:is([data-theme="dark"],[data-color-mode="dark"]) .tn-head{background:#23251d}
:root:is([data-theme="dark"],[data-color-mode="dark"]) :is(.tn-kicker,.tn-detail p){color:#b5b299}
:root:is([data-theme="dark"],[data-color-mode="dark"]) :is(.tn-close,.tn-open){background:#313b29;color:#d0ddbd;border-color:#697655}
:root:is([data-theme="dark"],[data-color-mode="dark"]) :is(.tn-close,.tn-open):hover{background:#405135}
:root:is([data-theme="dark"],[data-color-mode="dark"]) .tn-summary span{background:#393d2e}
:root:is([data-theme="dark"],[data-color-mode="dark"]) .tn-grid{background:#403928;border-color:#62563b}
:root:is([data-theme="dark"],[data-color-mode="dark"]) .tn-cell{background:radial-gradient(ellipse at 40% 35%,#726443,#574329);border-color:#8c794d}
:root:is([data-theme="dark"],[data-color-mode="dark"]) .tn-cell:is(:hover,[aria-pressed="true"]){background:radial-gradient(ellipse at 40% 35%,#88764e,#6a5230)}

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
    if (label !== void 0)
      node.textContent = label;
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
  const cells = Array.from({ length: NEST_SIZE ** 2 }, (_, index) => {
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
    if (minutes <= 0)
      return zh ? "\u7B49\u5F85\u5B75\u5316" : "Awaiting hatching";
    const hours = Math.floor(minutes / 60), rest = minutes % 60;
    const duration = zh ? `${hours ? `${hours} \u5C0F\u65F6` : ""}${rest ? `${hours ? " " : ""}${rest} \u5206\u949F` : ""}` : `${hours ? `${hours}h` : ""}${rest ? `${hours ? " " : ""}${rest}m` : ""}`;
    return zh ? `\u9884\u8BA1 ${duration}\u540E\u5B75\u5316` : `Hatches in about ${duration}`;
  };
  const render = () => {
    const nest = state?.nests?.find((nest2) => nest2.id === selectedId);
    if (!state || !nest) {
      if (dialog.open)
        dialog.close();
      return;
    }
    const ants = state.bugs.filter((b) => b.species === "ant" && b.inside?.nestId === nest.id);
    const eggs = (state.eggs ?? []).filter((e) => e.species === "ant" && e.inside?.nestId === nest.id);
    const contents = { ants, eggs, queens: ants.filter((a) => a.role === "queen").length, food: nest.food };
    title.textContent = `${text.title} \xB7 ${nest.id}`;
    summary.replaceChildren(...[`${text.ant} ${contents.ants.length}`, `${text.queen} ${contents.queens}`, `${text.egg} ${contents.eggs.length}`, `${text.food} ${contents.food}/${nest.foodCapacity ?? "\u2014"}`].map((label) => el("span", "", label)));
    note.hidden = state.bugs.some((bug) => bug.species === "ant" && bug.role !== void 0);
    for (const [index, cell] of cells.entries()) {
      const x = index % NEST_SIZE, y = Math.floor(index / NEST_SIZE);
      const ants2 = contents.ants.filter((ant) => ant.inside.x === x && ant.inside.y === y), eggs2 = contents.eggs.filter((egg) => egg.inside.x === x && egg.inside.y === y);
      const hasQueen = ants2.some((ant) => ant.role === "queen");
      cell.classList.toggle("has-queen", hasQueen);
      cell.setAttribute("aria-pressed", String(index === cellIndex));
      cell.setAttribute("aria-label", `${roomName(x, y)} (${x},${y}), ${text.ant} ${ants2.length}, ${text.egg} ${eggs2.length}${hasQueen ? `, ${text.queen}` : ""}`);
      const occupants = el("span", "tn-occupants");
      const visibleAnts = [...ants2].sort((a, b) => Number(b.role === "queen") - Number(a.role === "queen")).slice(0, 2);
      for (const ant of visibleAnts) {
        const icon = el("span", "tn-ant" + (ant.role === "queen" ? " queen" : ""));
        icon.innerHTML = ANT_SVG;
        icon.title = `${ant.id} \xB7 ${ant.role === "queen" ? text.queen : text.worker}`;
        icon.setAttribute("aria-hidden", "true");
        occupants.append(icon);
      }
      if (eggs2.length) {
        const cluster = el("span", "tn-eggs");
        cluster.setAttribute("aria-hidden", "true");
        for (let i = 0; i < Math.min(3, eggs2.length); i++)
          cluster.append(el("span", "tn-egg"));
        occupants.append(cluster);
      }
      if (x === 3 && y === 0 && nest.food)
        occupants.append(el("span", "tn-food", `\u25CF ${nest.food}`));
      cell.replaceChildren(el("span", "tn-cell-label", `${roomName(x, y)} ${x},${y}`), occupants, el("span", "tn-cell-count", `${zh ? "\u8681" : "Ant"} ${ants2.length} \xB7 ${zh ? "\u5375" : "Egg"} ${eggs2.length}`));
      if (hasQueen)
        cell.append(el("span", "tn-queen-badge", text.queen));
      if (index === cellIndex) {
        detail.replaceChildren(el("h3", "", `${roomName(x, y)} (${x},${y})`));
        if (!ants2.length && !eggs2.length)
          detail.append(el("p", "", text.empty));
        if (x === 3 && y === 0)
          detail.append(el("p", "", `${text.food}: ${nest.food}`));
        for (const ant of ants2)
          detail.append(el("p", "", `${ant.id} \xB7 ${ant.role === "queen" ? text.queen : text.worker}${ant.energy === void 0 ? "" : ` \xB7 ${zh ? "\u4F53\u529B" : "Energy"} ${ant.energy.toFixed(0)}`}${ant.hunger === void 0 ? "" : ` \xB7 ${zh ? "\u9965\u997F" : "Hunger"} ${ant.hunger.toFixed(0)}/100`}`));
        for (const egg of eggs2) {
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
    if (dialog.open || !returnView)
      return;
    const saved = returnView;
    returnView = null;
    if (saved.opener.isConnected)
      saved.opener.focus({ preventScroll: true });
    for (const { node, x, y } of saved.ancestors)
      if (node.isConnected)
        node.scrollTo({ left: x, top: y, behavior: "instant" });
    doc.defaultView.scrollTo({ left: saved.x, top: saved.y, behavior: "instant" });
  };
  const open = (nest, opener) => {
    selectedId = nest.id;
    render();
    if (dialog.open)
      return;
    const ancestors = [];
    for (let node = canvas.parentElement; node; node = node.parentElement)
      ancestors.push({ node, x: node.scrollLeft, y: node.scrollTop });
    returnView = { opener, x: doc.defaultView.scrollX, y: doc.defaultView.scrollY, ancestors };
    opener.focus({ preventScroll: true });
    dialog.showModal();
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
      dialog.animate([{ opacity: 0, transform: "translateY(16px) scale(.98)" }, { opacity: 1, transform: "none" }], { duration: 240, easing: "ease-out" });
  };
  const hit = (event) => {
    const bounds = canvas.getBoundingClientRect();
    const rx = Math.max(24, 30 * bounds.width / canvas.width), ry = Math.max(24, 20 * bounds.height / canvas.height);
    const targets = (state?.nests ?? []).map((nest2) => ({
      nest: nest2,
      dx: event.clientX - bounds.left - plotPosition(nest2.x, nest2.y, sceneSize(state)).x * bounds.width / canvas.width,
      dy: event.clientY - bounds.top - plotPosition(nest2.x, nest2.y, sceneSize(state)).y * bounds.height / canvas.height
    })).filter(({ dx, dy }) => Math.abs(dx) <= rx && Math.abs(dy) <= ry);
    targets.sort((a, b) => a.dx ** 2 + a.dy ** 2 - b.dx ** 2 - b.dy ** 2);
    const nest = targets[0]?.nest;
    if (nest)
      open(nest, triggers.get(nest.id) ?? canvas);
  };
  dialog.addEventListener("close", restoreView);
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)
        dialog.close();
    }
  });
  canvas.addEventListener("click", hit);
  let nestIds = "";
  return {
    setState(next, atMs) {
      state = next;
      recordedAtMs = atMs;
      const nests = next.nests ?? [];
      if (canvas.parentElement && toolbar.parentElement !== canvas.parentElement)
        canvas.after(toolbar);
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
            if (current)
              open(current, button);
          });
          return button;
        }));
      }
      toolbar.hidden = !nests.length;
      canvas.style.cursor = nests.length ? "pointer" : "";
      if (dialog.open)
        render();
    },
    dispose() {
      canvas.removeEventListener("click", hit);
      canvas.style.cursor = "";
      if (dialog.open)
        dialog.close();
      restoreView();
      dialog.removeEventListener("close", restoreView);
      toolbar.remove();
      dialog.remove();
    }
  };
}

// ../../../packages/cortico-world-terrarium/node_modules/.pnpm/terrarium-renderer@0.1.0/node_modules/terrarium-renderer/dist/nest-scene.js
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

// ../../../packages/cortico-world-terrarium/node_modules/.pnpm/terrarium-renderer@0.1.0/node_modules/terrarium-renderer/dist/scene.js
function bugPositions(bugs, positions = /* @__PURE__ */ new Map(), size = 5) {
  const groups = /* @__PURE__ */ new Map();
  for (const bug of bugs) {
    const tile = `${bug.x},${bug.y}`;
    const group = groups.get(tile) ?? [];
    group.push(bug.id);
    groups.set(tile, group);
  }
  for (const group of groups.values())
    group.sort();
  const result = /* @__PURE__ */ new Map();
  for (const bug of bugs) {
    const position = positions.get(bug.id) ?? bug;
    const group = groups.get(`${bug.x},${bug.y}`);
    const ordinal = group.indexOf(bug.id);
    const columns = Math.min(3, group.length);
    const row = Math.floor(ordinal / columns);
    const rows = Math.ceil(group.length / columns);
    const rowSize = Math.min(columns, group.length - row * columns);
    const spacing = residentScale(size);
    const plot = plotPosition(position.x, position.y, size);
    result.set(bug.id, { x: plot.x + (ordinal % columns - (rowSize - 1) / 2) * 28 * spacing, y: plot.y - 6 * spacing + (row - (rows - 1) / 2) * Math.min(19 * spacing, 24 / rows) });
  }
  return result;
}
function drawScene(canvas, state, positions = /* @__PURE__ */ new Map(), hits = []) {
  const g = canvas.getContext("2d");
  if (!g)
    return;
  const size = sceneSize(state);
  const scale = residentScale(size);
  const plot = (x, y) => plotPosition(x, y, size);
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
  g.roundRect(60, 70, 680, 400, 24);
  g.fill();
  g.fillStyle = night ? "#50493e" : "#715438";
  g.beginPath();
  g.roundRect(76, 202, 648, 250, [10, 10, 20, 20]);
  g.fill();
  g.fillStyle = night ? "#756b53" : "#a7875b";
  g.beginPath();
  g.roundRect(76, 194, 648, 236, 12);
  g.fill();
  const cellWidth = LAND_SURFACE.width / size, cellHeight = LAND_SURFACE.height / size;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const center = plot(x, y);
      const cell = state.soil?.find((cell2) => cell2.x === x && cell2.y === y);
      const left = center.x - cellWidth / 2, top = center.y - cellHeight / 2;
      g.fillStyle = `rgba(36,91,107,${(cell?.moisture ?? 0) / 230})`;
      g.fillRect(left + 1, top + 1, cellWidth - 2, cellHeight - 2);
      if ((cell?.daylight ?? 1) < 0.4) {
        g.fillStyle = "rgba(20,30,40,.18)";
        g.fillRect(left + 1, top + 1, cellWidth - 2, cellHeight - 2);
      }
      g.strokeStyle = night ? "#dce9c51c" : "#f9efd42e";
      g.lineWidth = 1;
      g.beginPath();
      g.rect(left, top, cellWidth, cellHeight);
      g.stroke();
    }
  for (const nest of state.nests ?? []) {
    const { x, y } = plot(nest.x, nest.y);
    drawAntNest(g, x, y, night);
  }
  for (const web of state.webs ?? []) {
    const { x, y } = plot(web.x, web.y);
    g.save();
    g.translate(x, y - 38);
    g.strokeStyle = night ? "#cfdfed9c" : "#fff8e5b8";
    g.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(Math.cos(angle) * 28, Math.sin(angle) * 28);
      g.stroke();
    }
    for (const radius of [9, 18, 27]) {
      g.beginPath();
      for (let i = 0; i <= 8; i++) {
        const angle = i * Math.PI / 4;
        const px = Math.cos(angle) * radius, py = Math.sin(angle) * radius;
        if (!i)
          g.moveTo(px, py);
        else
          g.lineTo(px, py);
      }
      g.stroke();
    }
    g.restore();
  }
  for (const food of state.food ?? []) {
    const { x, y } = plot(food.x, food.y);
    g.fillStyle = "#e4b66c";
    for (let i = 0; i < Math.min(6, food.portions); i++) {
      g.beginPath();
      g.arc(x - 8 + i % 3 * 6, y + Math.floor(i / 3) * 5, 2.5, 0, Math.PI * 2);
      g.fill();
    }
  }
  for (const [index, egg] of (state.eggs ?? []).filter((egg2) => !egg2.inside).entries()) {
    const { x, y } = plot(egg.x, egg.y);
    g.fillStyle = egg.species === "ant" ? "#eee2bd" : "#dbd9b0";
    g.beginPath();
    g.ellipse(x - 12 + index % 4 * 7, y - 4, 3, 4, -0.3, 0, Math.PI * 2);
    g.fill();
  }
  for (const plant of [...state.plants].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const { x, y: base } = plot(plant.x, plant.y);
    g.save();
    g.translate(x, base);
    g.scale(scale, scale);
    g.translate(-x, -base);
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
      g.ellipse(x + side * (9 + plant.stage * 3), y - 7, 11 + plant.stage * 3, plant.species === "fern" ? 7 : 11, -side * 0.45, 0, Math.PI * 2);
      g.fill();
    }
    if (plant.species === "clover" && plant.stage > 1) {
      g.fillStyle = plant.dry ? "#a4ad77" : "#74b878";
      for (const dx of [-8, 0, 8]) {
        g.beginPath();
        g.arc(x + dx, base - height, 9, 0, Math.PI * 2);
        g.fill();
      }
    }
    drawPlantFlowers(g, plant, x, base - height, night);
    g.restore();
  }
  for (const facility of state.facilities ?? []) {
    const { x, y } = plot(facility.x, facility.y);
    g.save();
    g.translate(x, y);
    g.scale(scale, scale);
    g.translate(-x, -y);
    g.globalAlpha = facility.enabled ? 1 : 0.35;
    if (facility.kind === "mulch") {
      g.fillStyle = "#b79157";
      g.beginPath();
      g.ellipse(x, y, 24, 10, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#74522f";
      g.lineWidth = 2;
      for (let i = -2; i <= 2; i++) {
        g.beginPath();
        g.moveTo(x + i * 7 - 3, y - 4);
        g.lineTo(x + i * 7 + 3, y + 4);
        g.stroke();
      }
    } else if (facility.kind === "shade") {
      g.strokeStyle = "#9b7958";
      g.lineWidth = 3;
      for (const dx of [-25, 25]) {
        g.beginPath();
        g.moveTo(x + dx, y + 4);
        g.lineTo(x + dx, y - 54);
        g.stroke();
      }
      g.fillStyle = "#638b76bb";
      g.beginPath();
      g.moveTo(x - 33, y - 54);
      g.lineTo(x + 28, y - 58);
      g.lineTo(x + 34, y - 41);
      g.lineTo(x - 28, y - 37);
      g.closePath();
      g.fill();
    } else if (facility.kind === "grow_light") {
      g.strokeStyle = "#68847b";
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(x + 18, y);
      g.lineTo(x + 18, y - 64);
      g.lineTo(x - 10, y - 64);
      g.stroke();
      g.fillStyle = night ? "#a49b70" : "#ffe9a0";
      g.beginPath();
      g.ellipse(x - 10, y - 60, 14, 5, 0, 0, Math.PI * 2);
      g.fill();
      if (!night && facility.enabled) {
        g.fillStyle = "#ffeda126";
        g.beginPath();
        g.moveTo(x - 22, y - 56);
        g.lineTo(x + 14, y);
        g.lineTo(x - 35, y);
        g.closePath();
        g.fill();
      }
    }
    g.restore();
  }
  for (const item of state.items) {
    const { x, y } = plot(item.x, item.y);
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
    const { x, y } = plot(seed.x, seed.y);
    g.fillStyle = "#d9bd75";
    g.beginPath();
    g.ellipse(x, y, 7, 4, -0.3, 0, Math.PI * 2);
    g.fill();
  }
  const surfaceBugs = state.bugs.filter((bug) => !bug.inside);
  const locations = bugPositions(surfaceBugs, positions, sceneSize(state));
  for (const bug of surfaceBugs) {
    const location = locations.get(bug.id);
    const x = location.x, y = location.y - (bug.flying ? 30 * scale : 0);
    g.save();
    g.translate(x, y);
    g.scale(scale, scale);
    g.translate(-x, -y);
    g.fillStyle = "rgba(33,28,20,.26)";
    g.beginPath();
    g.ellipse(x, y + 9, 14, 4, 0, 0, Math.PI * 2);
    g.fill();
    if (bug.flying) {
      g.fillStyle = bug.species === "moth" ? "#d9bfa1" : "rgba(228,246,247,.85)";
      const span = bug.species === "moth" ? 12 : bug.species === "mosquito" ? 8 : 7;
      for (const side of [-1, 1]) {
        g.beginPath();
        g.ellipse(x + side * span * 0.6, y - 3, span, span * 0.55, side * -0.55, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = bug.species === "fruit_fly" ? "#be8056" : bug.species === "moth" ? "#8a6851" : "#465357";
      g.beginPath();
      g.ellipse(x, y, 3, bug.species === "mosquito" ? 8 : 6, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#5d5149";
      g.lineWidth = 1;
      for (const side of [-1, 1]) {
        g.beginPath();
        g.moveTo(x, y - 5);
        g.lineTo(x + side * 4, y - 11);
        g.stroke();
      }
      if (bug.species === "moth") {
        g.fillStyle = "#97745c";
        for (const side of [-1, 1]) {
          g.beginPath();
          g.arc(x + side * 9, y - 5, 2.4, 0, Math.PI * 2);
          g.fill();
        }
      }
    } else if (bug.species === "spider") {
      g.strokeStyle = "#282a36";
      g.lineWidth = 2.4;
      for (const side of [-1, 1])
        for (let i = -1; i <= 1; i++) {
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
      for (const side of [-1, 1])
        for (const dx of [-5, 0, 5]) {
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
      for (const side of [-1, 1])
        for (const dx of [-4, 1, 5]) {
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
    g.restore();
  }
  for (const hit of hits) {
    const { x, y } = plot(hit.x, hit.y);
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
  g.moveTo(76, 100);
  g.lineTo(76, 173);
  g.moveTo(94, 92);
  g.lineTo(94, 140);
  g.stroke();
  g.strokeStyle = night ? "#a7c1c7" : "#eff8ea";
  g.lineWidth = 9;
  g.beginPath();
  g.roundRect(60, 70, 680, 400, 24);
  g.stroke();
  g.fillStyle = night ? "#40555a" : "#72906f";
  g.beginPath();
  g.roundRect(90, 460, 620, 15, 7);
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
    if (disposed || !state)
      return;
    drawScene(canvas, state, currentPositions(now), hits.map((hit) => ({ ...hit, strength: Math.max(0, 1 - (now - hitAt) / 900) })));
    frame = requestAnimationFrame(render);
  };
  return {
    setState(next) {
      if (disposed)
        return;
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
      if (!frame)
        frame = requestAnimationFrame(render);
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

// ../../../packages/cortico-world-terrarium/node_modules/.pnpm/terrarium-renderer@0.1.0/node_modules/terrarium-renderer/dist/water-scene.js
function createWaterScene(canvas) {
  let state;
  let old = /* @__PURE__ */ new Map();
  let movedAt = 0;
  let request = 0;
  let disposed = false;
  const position = (x, y) => cellPosition(WATER_SURFACE, x, y, sceneSize(state ?? {}));
  const locations = (now) => new Map((state?.fish ?? []).map((fish) => {
    const previous = old.get(fish.id) ?? fish;
    const t = Math.min(1, (now - movedAt) / 900);
    return [fish.id, { x: previous.x + (fish.x - previous.x) * t, y: previous.y + (fish.y - previous.y) * t }];
  }));
  const render = (now) => {
    if (disposed || !state)
      return;
    const g = canvas.getContext("2d");
    if (g) {
      const night = state.phase === "night";
      const size = sceneSize(state), scale = residentScale(size);
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
      for (let x = 0; x < sceneSize(state); x++)
        for (let y = 0; y < sceneSize(state); y++) {
          const p = position(x, y);
          g.strokeRect(p.x - WATER_SURFACE.width / size / 2, p.y - WATER_SURFACE.height / size / 2, WATER_SURFACE.width / size, WATER_SURFACE.height / size);
        }
      for (const plant of state.plants) {
        const p = position(plant.x, plant.y), h = 22 + plant.stage * 9;
        g.save();
        g.translate(p.x, p.y);
        g.scale(scale, scale);
        g.translate(-p.x, -p.y);
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
        g.restore();
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
      for (const facility of state.facilities ?? []) {
        const p = position(facility.x, facility.y);
        g.save();
        g.translate(p.x, p.y);
        g.scale(scale, scale);
        g.translate(-p.x, -p.y);
        g.globalAlpha = facility.enabled ? 1 : 0.35;
        if (facility.kind === "air_stone") {
          g.fillStyle = "#769cad";
          g.beginPath();
          g.ellipse(p.x, p.y + 12, 15, 7, 0, 0, Math.PI * 2);
          g.fill();
          if (facility.enabled)
            for (let i = 0; i < 5; i++) {
              const rise = (now / 35 + i * 18) % 90;
              g.strokeStyle = "#d4f8ff99";
              g.lineWidth = 1.5;
              g.beginPath();
              g.arc(p.x + Math.sin(i + now / 1200) * 9, p.y - rise, 2 + i % 3, 0, Math.PI * 2);
              g.stroke();
            }
        } else if (facility.kind === "filter") {
          g.fillStyle = "#547e82";
          g.beginPath();
          g.roundRect(p.x - 12, p.y - 35, 24, 46, 6);
          g.fill();
          g.strokeStyle = "#b4e9db";
          g.lineWidth = 2;
          for (let i = 0; i < 3; i++) {
            g.beginPath();
            g.moveTo(p.x - 7, p.y - 24 + i * 8);
            g.lineTo(p.x + 7, p.y - 24 + i * 8);
            g.stroke();
          }
        } else if (facility.kind === "water_light") {
          g.fillStyle = night ? "#7d8580" : "#f9e6a4";
          g.beginPath();
          g.roundRect(p.x - 23, p.y - 45, 46, 8, 4);
          g.fill();
          if (!night && facility.enabled) {
            g.fillStyle = "#ffffba25";
            g.beginPath();
            g.moveTo(p.x - 18, p.y - 37);
            g.lineTo(p.x + 30, p.y + 20);
            g.lineTo(p.x - 30, p.y + 20);
            g.closePath();
            g.fill();
          }
        }
        g.restore();
      }
      const points = locations(now);
      for (const fish of state.fish) {
        const p = position(points.get(fish.id).x, points.get(fish.id).y);
        const companions = state.fish.filter((other) => other.x === fish.x && other.y === fish.y).map((other) => other.id).sort();
        const index = companions.indexOf(fish.id), columns = Math.min(3, companions.length);
        const rows = Math.ceil(companions.length / columns);
        p.x += (index % columns - (Math.min(columns, companions.length - Math.floor(index / columns) * columns) - 1) / 2) * 24 * scale;
        p.y += (Math.floor(index / columns) - (rows - 1) / 2) * Math.min(16 * scale, 24 / rows);
        g.save();
        g.translate(p.x, p.y);
        g.scale(scale, scale);
        g.translate(-p.x, -p.y);
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
        g.restore();
      }
    }
    request = requestAnimationFrame(render);
  };
  return {
    setState(next) {
      if (disposed)
        return;
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
      if (!request)
        request = requestAnimationFrame(render);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(request);
    }
  };
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
function createWaterScene2(canvas) {
  const renderer = createWaterScene(canvas);
  return { setState(state) {
    renderer.setState({ phase: state.phase, gridSize: capacity(state).size, facilities: state.facilities, oxygen: state.oxygen, cleanliness: state.cleanliness, plants: state.plants, fish: state.fish, food: state.food });
  }, dispose() {
    renderer.dispose();
  } };
}
function createWaterReplayControls(container, language = "zh") {
  return createPlaybackControls(container, createWaterScene2, language);
}

// webui/water-client.ts
function mountWater(ctx) {
  const zh = ctx.language === "zh";
  const card = ctx.ui.sheet({ title: "\u751F\u6001\u7BB1\xB7\u6C34", en: "Terrarium \xB7 Water" });
  const title = ctx.ui.h("h2", "");
  const status = ctx.ui.msgline(zh ? "\u8BFB\u53D6\u4E2D" : "Loading");
  card.body.classList.add("terrarium-panel");
  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 500;
  canvas.className = "terrarium-scene";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", zh ? "\u751F\u6001\u7BB1\xB7\u6C34" : "Water aquarium");
  const details = ctx.ui.h("div", "terrarium-details");
  const deathHistory = createDeathHistory(ctx);
  const diagnosis = ctx.ui.h("div", "terrarium-details");
  const grid = ctx.ui.h("div", "terrarium-grid");
  const progression = createProgressionControls(ctx, () => load());
  const careControls = createCareControls(ctx, "water", () => load());
  let selected = { x: 2, y: 2 };
  const replayContainer = ctx.ui.h("div", "terrarium-replays");
  const history = ctx.ui.h("div", "");
  const scoreChart = ctx.ui.h("div", "");
  const scene = createWaterScene2(canvas), replay = createWaterReplayControls(replayContainer, zh ? "zh" : "en");
  ctx.signal.addEventListener("abort", () => {
    scene.dispose();
    replay.dispose();
  }, { once: true });
  const sync = createSyncControls(ctx, () => load());
  const refresh = ctx.ui.button(zh ? "\u5237\u65B0" : "Refresh", { size: "sm", onClick: () => {
    void load();
  } });
  card.body.append(title, status, sync.el, canvas, details, diagnosis, deathHistory.el, grid, careControls.el, progression.el, replayContainer, history, scoreChart, refresh, createFeedbackControls(ctx));
  ctx.root.append(card.el);
  const load = async () => {
    try {
      const response = await ctx.invoke("state");
      if (ctx.signal.aborted) return;
      sync.update(response.sync, response.claimed);
      for (const el of [progression.el, canvas, details, diagnosis, deathHistory.el, grid, careControls.el, replayContainer, history, scoreChart]) el.hidden = !response.claimed;
      if (!response.claimed || !response.state) {
        status.textContent = zh ? "\u672A\u8BA4\u9886 \xB7 \u7528 terrarium_claim \u8BA4\u9886\u6C34\u7BB1\uFF0C\u5148\u79CD\u5C11\u91CF\u6C34\u8349\u3001\u653E\u5C11\u91CF\u9C7C\u3002\u591C\u95F4\u6C34\u8349\u7B49\u5929\u4EAE\u518D\u751F\u957F\u3002" : "Unclaimed \xB7 Use terrarium_claim. Start with a few plants and fish; plants wait for daylight.";
        return;
      }
      const state = response.state;
      deathHistory.update(state.deaths);
      scoreChart.replaceChildren(drawScoreHistory(state.scoreHistory, zh, ctx.language));
      title.textContent = state.name ?? (zh ? "\u751F\u6001\u7BB1\xB7\u6C34" : "Terrarium \xB7 Water");
      status.textContent = `${state.phase === "day" ? zh ? "\u767D\u5929" : "Day" : zh ? "\u591C\u665A" : "Night"}${response.id ? ` \xB7 ID ${response.id}` : ""} \xB7 ${zh ? "\u542B\u6C27\u91CF" : "Oxygen"} ${state.oxygen.toFixed(1)} \xB7 ${zh ? "\u6C34\u8D28" : "Cleanliness"} ${state.cleanliness.toFixed(1)}`;
      diagnosis.replaceChildren(...[...returnReportText(state.returnReport, zh), ...careText(state.care, zh)].map((text) => ctx.ui.h("div", "", text)));
      careControls.update(state, selected);
      progression.update(state, selected);
      grid.style.gridTemplateColumns = `repeat(${capacity(state).size}, minmax(0, 1fr))`;
      grid.replaceChildren(...Array.from({ length: capacity(state).size ** 2 }, (_, i) => {
        const cell = { x: i % capacity(state).size, y: Math.floor(i / capacity(state).size) };
        const button = ctx.ui.button(`(${cell.x},${cell.y})`, { size: "sm", onClick: () => {
          selected = cell;
          careControls.update(state, selected);
          progression.update(state, selected);
          for (const b of grid.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b === button));
        } });
        button.setAttribute("aria-pressed", String(selected.x === cell.x && selected.y === cell.y));
        return button;
      }));
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

// src/flight.ts
var TERRARIUM_FLY_SPECIES = ["fruit_fly", "mosquito", "moth"];
function isFlying(species) {
  return TERRARIUM_FLY_SPECIES.includes(species);
}

// webui/scene.ts
function landScene(state) {
  return { phase: state.phase, gridSize: capacity(state).size, facilities: state.facilities, eggs: state.eggs, nests: state.nests?.map((n) => ({ ...n, foodCapacity: n.depth * 20 })), food: state.food, webs: state.webs, seeds: state.seeds, items: state.items, soil: state.soil?.map((cell) => ({ ...cell, daylight: daylight(state, cell.x, cell.y) })), plants: state.plants.map((p) => ({ ...p, flower: flowerStage(p) })), bugs: state.bugs.map((b) => ({ ...b, flying: isFlying(b.species) })) };
}
function createScene2(canvas, language = "zh") {
  const renderer = createScene(canvas, language);
  return { setState(state, recordedAtMs) {
    renderer.setState(landScene(state), recordedAtMs);
  }, dispose() {
    renderer.dispose();
  } };
}
function createReplayControls(container, language = "zh") {
  return createPlaybackControls(container, (canvas) => createScene2(canvas, language), language);
}

// webui/client.ts
function mount(ctx) {
  const copy = pick(ctx.language, {
    zh: { loading: "\u8BFB\u53D6\u4E2D", refresh: "\u5237\u65B0", day: "\u767D\u5929", night: "\u591C\u665A", fern: "\u8568\u8349", clover: "\u4E09\u53F6\u8349", stage: "\u9636\u6BB5", moisture: "\u6C34\u5206", dry: "\u571F\u58E4\u53D8\u5E72", scene: "\u7684\u751F\u6001\u7BB1", seed: "\u79CD\u5B50", bug: "\u866B\u5B50", egg: "\u5375", nest: "\u8681\u5DE2", food: "\u50A8\u7CAE", depth: "\u5C42", light: "\u5F53\u524D\u5149\u7167", soil: "\u571F\u58E4\u6C34\u5206", history: "\u5C0F\u65F6\u5386\u53F2 \xB7 \u6700\u8FD1\u4E03\u5929", health: "\u5065\u5EB7", empty: "\u7B49\u5F85\u7B2C\u4E8C\u4E2A\u5C0F\u65F6\u6837\u672C", needs: "\u751F\u957F\u6761\u4EF6\uFF08\u6C34\u5206 / \u767D\u5929\u5149\u7167\uFF09", plot: "\u683C\u5B50", critical: "\u6FD2\u5371", bud: "\u82B1\u82DE", bloom: "\u5F00\u82B1", energy: "\u80FD\u91CF", hunger: "\u9965\u997F" },
    en: { loading: "Loading", refresh: "Refresh", day: "Day", night: "Night", fern: "Fern", clover: "Clover", stage: "stage", moisture: "moisture", dry: "dry soil", scene: " terrarium", seed: "seeds", bug: "bugs", egg: "eggs", nest: "ant nest", food: "stored food", depth: "levels", light: "Current light", soil: "Soil moisture", history: "Hourly history \xB7 Last seven days", health: "Health", empty: "Waiting for a second hourly sample", needs: "Growth conditions (moisture / daylight)", plot: "Cell", critical: "Critical", bud: "Budding", bloom: "Blooming", energy: "Energy", hunger: "Hunger" }
  });
  const card = ctx.ui.sheet({ title: "\u751F\u6001\u7BB1\xB7\u5730", en: "Terrarium \xB7 Land" });
  card.body.classList.add("terrarium-panel");
  const name = ctx.ui.h("h2", "");
  const status = ctx.ui.msgline(copy.loading);
  const canvas = document.createElement("canvas");
  canvas.className = "terrarium-scene";
  canvas.width = 800;
  canvas.height = 500;
  canvas.setAttribute("role", "img");
  const scene = createScene2(canvas, ctx.language.startsWith("zh") ? "zh" : "en");
  const replayContainer = ctx.ui.h("div", "terrarium-replays");
  const replay = createReplayControls(replayContainer, ctx.language === "zh" ? "zh" : "en");
  ctx.signal.addEventListener("abort", () => replay.dispose(), { once: true });
  ctx.signal.addEventListener("abort", () => scene.dispose(), { once: true });
  const details = ctx.ui.h("div", "terrarium-details");
  const deathHistory = createDeathHistory(ctx);
  const diagnosis = ctx.ui.h("div", "terrarium-details");
  const careControls = createCareControls(ctx, "land", () => load());
  const progression = createProgressionControls(ctx, () => load());
  const sync = createSyncControls(ctx, () => load());
  const refresh = ctx.ui.button(copy.refresh, { size: "sm", onClick: () => {
    void load();
  } });
  const habitat = ctx.ui.h("div", "terrarium-habitat");
  const grid = ctx.ui.h("div", "terrarium-grid");
  const cellStatus = ctx.ui.h("div", "terrarium-cell-status");
  const requirements = ctx.ui.h("div", "terrarium-requirements");
  const watering = createWateringControls(ctx, () => load());
  habitat.append(grid, cellStatus, watering.el, requirements);
  const historyTitle = ctx.ui.h("h3", "", copy.history);
  const select = document.createElement("select");
  select.className = "terrarium-select";
  select.setAttribute("aria-label", copy.history);
  const chart = ctx.ui.h("div", "");
  const scoreChart = ctx.ui.h("div", "");
  let selected = "soil:0";
  let current;
  const renderHistory = () => {
    if (!current) return;
    const plant = current.plants.find((plant2) => plant2.id === selected);
    const index = selected.startsWith("soil:") ? Number(selected.slice(5)) : plant ? plant.y * capacity(current).size + plant.x : -1;
    const cell = current.soil[index];
    watering.update(true, cell, current);
    careControls.update(current, cell);
    progression.update(current, cell);
    cellStatus.textContent = cell ? `(${cell.x},${cell.y}) \xB7 ${copy.moisture} ${cell.moisture.toFixed(1)} \xB7 ${copy.light} ${(current.phase === "day" ? daylight(current, cell.x, cell.y) : 0).toFixed(2)}` : "";
    grid.querySelectorAll("button").forEach((button, i) => {
      button.setAttribute("aria-pressed", String(i === index));
    });
    chart.replaceChildren(drawHistory(current.history, selected, copy, ctx.language, capacity(current).size));
  };
  select.addEventListener("change", () => {
    selected = select.value;
    renderHistory();
  });
  card.body.append(name, status, sync.el, canvas, replayContainer, details, diagnosis, deathHistory.el, habitat, careControls.el, progression.el, historyTitle, select, chart, scoreChart, refresh, createFeedbackControls(ctx));
  ctx.root.appendChild(card.el);
  const load = async () => {
    try {
      const response = await ctx.invoke("state");
      if (ctx.signal.aborted) return;
      sync.update(response.sync, response.claimed);
      watering.update(response.claimed);
      const state = response.state;
      for (const el of [progression.el, canvas, replayContainer, details, diagnosis, deathHistory.el, habitat, careControls.el, historyTitle, select, chart, scoreChart]) el.hidden = !response.claimed;
      if (!response.claimed || !state) {
        status.textContent = pick(ctx.language, { zh: "\u672A\u8BA4\u9886 \xB7 \u5148\u901A\u8FC7 terrarium_claim \u8BA4\u9886\u5730\u7BB1\uFF0C\u518D\u68C0\u67E5\u6BCF\u683C\u6C34\u5206\u548C\u5149\u7167\u540E\u64AD\u79CD\u3002", en: "Unclaimed \xB7 Use terrarium_claim, inspect moisture and light, then sow." });
        return;
      }
      if (ctx.signal.aborted) return;
      name.textContent = state.name ?? pick(ctx.language, { zh: "\u751F\u6001\u7BB1", en: "Terrarium" });
      status.textContent = `${state.phase === "day" ? copy.day : copy.night}${response.id ? ` \xB7 ID ${response.id}` : ""}`;
      canvas.setAttribute("aria-label", `${name.textContent} \xB7 ${status.textContent}${copy.scene}: ${state.plants.length} plants, ${state.seeds?.length ?? 0} ${copy.seed}, ${state.bugs?.length ?? 0} ${copy.bug}`);
      scene.setState(state);
      replay.setReplays(state.replays ?? []);
      current = state;
      deathHistory.update(state.deaths);
      scoreChart.replaceChildren(drawScoreHistory(state.scoreHistory, ctx.language.startsWith("zh"), ctx.language));
      diagnosis.replaceChildren(...[...returnReportText(state.returnReport, ctx.language.startsWith("zh")), ...careText(state.care, ctx.language.startsWith("zh"))].map((text) => ctx.ui.h("div", "", text)));
      const cells = state.soil.map((cell, index) => {
        const light = state.phase === "day" ? daylight(state, cell.x, cell.y) : 0;
        const label = `(${cell.x},${cell.y}) \xB7 ${copy.moisture} ${cell.moisture.toFixed(1)} \xB7 ${copy.light} ${light.toFixed(2)}`;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "terrarium-cell";
        button.style.setProperty("--terrarium-dark-moisture", `${28 - cell.moisture * 0.14}%`);
        button.style.backgroundColor = `hsl(195 35% ${85 - cell.moisture * 0.45}%)`;
        button.style.color = cell.moisture > 65 ? "#fff" : "#18313b";
        button.append(ctx.ui.h("span", "terrarium-cell-moisture", `${Math.round(cell.moisture)}`), ctx.ui.h("span", "terrarium-cell-light", light.toFixed(2)));
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
      grid.style.gridTemplateColumns = `repeat(${capacity(state).size}, minmax(0, 1fr))`;
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
        plant.health <= TERRARIUM_PLANT_LOW_HEALTH ? "terrarium-plant terrarium-plant-critical" : "terrarium-plant",
        `${plant.id === "fern" ? copy.fern : plant.id === "clover" ? copy.clover : plant.species} \xB7 ${copy.stage} ${plant.stage} \xB7 ${copy.moisture} ${Math.round(plant.moisture)} \xB7 HP ${Math.round(plant.health)}${plant.health <= TERRARIUM_PLANT_LOW_HEALTH ? ` \xB7 ${copy.critical}` : ""}${plant.dry ? ` \xB7 ${copy.dry}` : ""}${flowerStage(plant) ? ` \xB7 ${copy[flowerStage(plant)]}` : ""}`
      )), ...state.bugs.map((bug) => ctx.ui.h("div", (bug.hunger ?? 0) >= 80 ? "terrarium-plant terrarium-plant-critical" : "terrarium-plant", `${bug.id} (${bug.species}) \xB7 ${copy.energy} ${bug.energy === void 0 ? "\u2014" : Math.round(bug.energy)}/100 \xB7 ${copy.hunger} ${bug.hunger === void 0 ? "\u2014" : Math.round(bug.hunger)}/100`)), ctx.ui.h("div", "terrarium-plant", `${copy.seed} ${state.seeds?.length ?? 0} \xB7 ${copy.bug} ${state.bugs?.length ?? 0} \xB7 ${copy.egg} ${state.eggs?.length ?? 0} \xB7 ${ctx.language.startsWith("zh") ? "\u86DB\u7F51" : "Webs"} ${state.webs?.length ?? 0}`), ...(state.nests ?? []).map((nest) => ctx.ui.h("div", "terrarium-plant", `${copy.nest} ${nest.id} (${nest.x},${nest.y}) \xB7 ${nest.depth} ${copy.depth} \xB7 ${copy.food} ${nest.food}/${nest.depth * 20}`)));
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
