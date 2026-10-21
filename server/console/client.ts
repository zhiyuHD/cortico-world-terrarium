import './client.css';
import { icon, mountIcons, type IconName } from './icons.ts';
mountIcons();
interface Box { id: string; registered: boolean; name: string; kind: 'land' | 'water' | null; score: number | null; reportedAt: string | null; clientVersion: string | null; coopanionVersion: string | null; clientSystem?: { name: string; version: string } | null; reportTransport: 'http' | 'websocket' | null; wsConnections: number }
interface Feedback { id: number; text: string; contact?: string; boxId?: string; source: string; createdAt: string; resolvedAt?: string }
interface Notice { id: number; title: string; text: string; targets: 'all' | string[]; createdAt: string; expiresAt: string }
interface Controls { httpPush: { enabled: boolean; scheduledChange: { at: string; enabled: boolean } | null }; minimumClientVersion?: { version: string | null; scheduledChange: { at: string; version: string | null } | null } }
interface Snapshot { boxes: Box[]; serverAt: string; uptimeSec: number; memoryBytes: number }
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => el<HTMLInputElement>(id);
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') { const element = document.createElement(tag); element.textContent = text; element.className = className; return element; }
function button(text: string, action: () => void, className = '', symbol?: IconName) { const element = node('button', '', className); if (symbol) element.append(icon(symbol)); if (text) element.append(node('span', text)); element.type = 'button'; element.onclick = action; return element; }
function iconLabel(element: HTMLElement, symbol: IconName, text: string) { element.replaceChildren(icon(symbol), node('span', text)); element.classList.add('with-icon'); }
const date = (value?: string | null) => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium', hour12: false }).format(new Date(value)) : '尚未上报';
let token = sessionStorage.getItem('terrarium-admin-token') ?? '';
let epoch = 0, refreshing = false, snapshot: Snapshot | undefined, feedback: Feedback[] = [], notices: Notice[] = [], controls: Controls | undefined;
let filter = '*', pendingOnly = false, allTargets = false, scheduleEnabled = false, mutating = false;
const selected = new Set<string>();
const status = (message: string) => { el('status').textContent = message; };
function logout() { ++epoch; token = ''; sessionStorage.removeItem('terrarium-admin-token'); selected.clear(); snapshot = undefined; feedback = []; notices = []; controls = undefined; el('modal').hidden = true; modalWork = undefined; el('app').hidden = true; el('login').hidden = false; input('token').value = ''; for (const id of ['box-rows', 'feedback-list', 'notice-list', 'stats']) el(id).replaceChildren(); }
async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const currentEpoch = epoch;
  const response = await fetch(`/api/admin/${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (currentEpoch !== epoch) throw new Error('会话已变化');
  if (response.status === 401) { logout(); throw new Error('凭据无效，请重新登录'); }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data as T;
}
async function loadFeedback() {
  const result: Feedback[] = []; let after = 0;
  for (;;) { const page = await api<{ feedback: Feedback[]; nextCursor: number }>(`feedback?after=${after}`); result.push(...page.feedback); if (!page.feedback.length) return result; after = page.nextCursor; }
}
async function refresh() {
  if (!token || refreshing) return;
  refreshing = true; const currentEpoch = epoch;
  try {
    const [next, nextFeedback, nextNotices, nextControls] = await Promise.all([api<Snapshot>('boxes'), loadFeedback(), api<{ announcements: Notice[] }>('announcements'), api<Controls>('controls')]);
    if (epoch !== currentEpoch) return;
    snapshot = next; feedback = nextFeedback; notices = nextNotices.announcements; controls = nextControls;
    for (const id of selected) if (!next.boxes.some(box => box.id === id && box.registered)) selected.delete(id);
    el('login').hidden = true; el('app').hidden = false; status(''); render();
    el('sync-at').textContent = `更新于 ${date(next.serverAt)}`;
    el('server-info').textContent = `运行 ${Math.floor(next.uptimeSec / 3600)} 小时 · 内存 ${(next.memoryBytes / 1048576).toFixed(1)} MiB · 时间均为北京时间`;
  } catch (error) { const message = (error as Error).message; if (epoch === currentEpoch) status(message); if (!token || el('app').hidden) el('login-error').textContent = message; }
  finally { refreshing = false; }
}
function tab(name: string) { for (const section of Array.from(document.querySelectorAll<HTMLElement>('.panel'))) section.hidden = section.id !== name; for (const item of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-tab]'))) { item.classList.toggle('active', item.dataset.tab === name); if (item.dataset.tab === name) el('page-title').textContent = item.textContent!.trim(); } }
function version(box: Box) { return box.clientVersion ?? (box.reportedAt ? '≤0.7.3（推定）' : '未上报'); }
function visibleBoxes() { const query = input('search').value.trim().toLowerCase(); return (snapshot?.boxes ?? []).filter(box => (filter === '*' || version(box) === filter) && `${box.name} ${box.id}`.toLowerCase().includes(query)).sort((a, b) => (b.reportedAt ?? '').localeCompare(a.reportedAt ?? '')); }
function audience() {
  input('scope-all').setAttribute('aria-pressed', String(allTargets)); input('scope-selected').setAttribute('aria-pressed', String(!allTargets));
  el('audience').textContent = allTargets ? '广播 · 公网可见' : `定向 · ${selected.size} 个盒子`;
  el('audience-names').textContent = allTargets ? '所有现有及有效期内新注册的客户端，公网页面也会展示。' : [...selected].map(id => `${snapshot?.boxes.find(box => box.id === id)?.name ?? id} (${id})`).join('、') || '请先在盒子概览中选择接收者。';
}
function renderBoxes() {
  const rows = el('box-rows'); rows.replaceChildren();
  const visible = visibleBoxes();
  for (const box of visible) {
    const row = node('tr'); row.classList.toggle('selected', selected.has(box.id));
    const nameCell = node('td'), check = button('', () => { if (selected.has(box.id)) selected.delete(box.id); else selected.add(box.id); renderBoxes(); }, 'check', 'check');
    check.setAttribute('role', 'checkbox'); check.setAttribute('aria-checked', String(selected.has(box.id))); check.setAttribute('aria-label', `选择 ${box.name}`); check.disabled = !box.registered;
    const name = node('div'); name.append(node('strong', box.name), node('span', `${box.kind === 'land' ? '地' : box.kind === 'water' ? '水' : '待认领'} · ${box.id}`, 'small muted')); nameCell.append(check, name);
    row.append(nameCell, node('td', version(box)), node('td', box.coopanionVersion ?? '未上报'), node('td', box.clientSystem ? `${box.clientSystem.name} · ${box.clientSystem.version}` : '未上报'));
    const connection = node('td'), live = node('span', '', box.wsConnections ? 'pill' : 'muted'); iconLabel(live, box.wsConnections ? 'wifi' : 'wifi-off', box.wsConnections ? `WS 在线 (${box.wsConnections})` : 'WS 未连接'); connection.append(live, node('span', `最近提交：${box.reportTransport === 'websocket' ? 'WS' : box.reportTransport === 'http' ? 'HTTP' : '未知'}`, 'small muted'));
    row.append(connection, node('td', date(box.reportedAt)), node('td', box.score === null ? '未上报' : String(box.score))); rows.append(row);
  }
  if (!visible.length) { const row = node('tr'), cell = node('td', '没有符合条件的盒子', 'empty'); cell.colSpan = 7; row.append(cell); rows.append(row); }
  el('selection-info').textContent = `显示 ${visible.length} / ${snapshot?.boxes.length ?? 0} 个 · 已选择 ${selected.size} 个（切换筛选会保留选择）`;
  audience();
}
function render() {
  if (!snapshot) return;
  const stats = el('stats'); stats.replaceChildren();
  for (const [label, value] of [['已注册盒子', snapshot.boxes.length], ['WS 连接中的盒子', snapshot.boxes.filter(box => box.wsConnections > 0).length], ['待处理反馈', feedback.filter(item => !item.resolvedAt).length], ['有效公告', notices.filter(item => Date.parse(item.expiresAt) > Date.now()).length]]) { const card = node('div', '', 'stat'); card.append(node('strong', String(value)), node('span', String(label))); stats.append(card); }
  const versions = el('versions'); versions.replaceChildren();
  for (const value of ['*', ...new Set(snapshot.boxes.map(version))]) { const control = button(value === '*' ? '全部版本' : value, () => { filter = value; render(); }); control.setAttribute('aria-pressed', String(filter === value)); versions.append(control); }
  renderBoxes(); renderFeedback(); renderNotices(); renderControls();
}
function renderFeedback() {
  const list = el('feedback-list'); list.replaceChildren();
  for (const item of [...feedback].reverse().filter(item => !pendingOnly || !item.resolvedAt)) {
    const card = node('article', '', 'card'); card.append(node('span', item.resolvedAt ? '已解决' : '待处理', 'pill'), node('div', `#${item.id} · ${item.source} · ${date(item.createdAt)}`, 'meta'), node('p', item.text, 'wrap'));
    const box = snapshot?.boxes.find(box => box.id === item.boxId);
    card.append(node('p', `盒子：${box?.name ?? item.boxId ?? '匿名反馈'}${item.contact ? ` · 联系方式：${item.contact}` : ''}`, 'muted small wrap'));
    const actions = node('div', '', 'toolbar');
    if (item.boxId && box?.registered) actions.append(button('定向回复', () => { selected.clear(); selected.add(item.boxId!); allTargets = false; input('notice-title').value = `反馈 #${item.id} 回复`; input('notice-text').value = ''; audience(); tab('announcements'); input('notice-text').focus(); }, '', 'reply'));
    if (!item.resolvedAt) actions.append(button('标记已解决', () => confirmAction(`解决反馈 #${item.id}`, item.text, async () => { await api(`feedback/${item.id}/resolve`, 'POST'); }), 'primary', 'circle-check'));
    else card.append(node('p', `解决于 ${date(item.resolvedAt)}`, 'muted small'));
    card.append(actions); list.append(card);
  }
  if (!list.children.length) list.append(node('div', '暂无反馈', 'card empty'));
}
function renderNotices() {
  const list = el('notice-list'); list.replaceChildren();
  for (const notice of [...notices].reverse()) {
    const card = node('article', '', 'card'); card.append(node('h3', `#${notice.id} ${notice.title || '无标题'}`), node('p', notice.text, 'wrap'), node('p', notice.targets === 'all' ? '广播 · 公网可见' : `定向：${notice.targets.map(id => snapshot?.boxes.find(box => box.id === id)?.name ?? id).join('、')}`, 'small muted wrap'), node('p', `${date(notice.createdAt)} 至 ${date(notice.expiresAt)}${Date.parse(notice.expiresAt) <= Date.now() ? ' · 已过期' : ''}`, 'small muted'));
    card.append(button('撤回', () => confirmAction(`撤回公告 #${notice.id}`, `${notice.title}\n客户端将不再拉取此公告，已进入模型上下文的事件仍然保留。`, async () => { await api(`announcements/${notice.id}`, 'DELETE'); }), 'danger', 'undo-2')); list.append(card);
  }
  if (!list.children.length) list.append(node('div', '暂无公告', 'card empty'));
}
let serverOffset = 0;
function renderControls() {
  if (!controls || !snapshot) return;
  serverOffset = Date.parse(snapshot.serverAt) - Date.now();
  iconLabel(el('http-status'), controls.httpPush.enabled ? 'power' : 'power-off', controls.httpPush.enabled ? '已开启' : '已关闭');
  el<HTMLButtonElement>('http-cancel').disabled = !controls.httpPush.scheduledChange;
  const floor = controls.minimumClientVersion;
  el('minimum-status').textContent = floor?.version ? `至少 ${floor.version}` : '未限制';
  el('minimum-schedule').textContent = floor?.scheduledChange ? `${date(floor.scheduledChange.at)} · ${floor.scheduledChange.version ? `至少 ${floor.scheduledChange.version}` : '取消版本限制'}` : '暂无定时变更';
  el<HTMLButtonElement>('minimum-cancel').disabled = !floor?.scheduledChange;
  renderCountdown();
}
function renderCountdown() {
  const schedule = controls?.httpPush.scheduledChange;
  if (!schedule) { el('schedule-status').textContent = '暂无定时任务'; return; }
  const seconds = Math.ceil((Date.parse(schedule.at) - Date.now() - serverOffset) / 1000);
  el('schedule-status').textContent = `${date(schedule.at)} ${schedule.enabled ? '开启' : '关闭'} · ${seconds > 0 ? `剩余 ${Math.floor(seconds / 86400)} 天 ${Math.floor(seconds % 86400 / 3600)} 小时 ${Math.floor(seconds % 3600 / 60)} 分 ${seconds % 60} 秒` : '已到计划时间，等待刷新确认'}`;
}
let modalWork: (() => Promise<void>) | undefined, previousFocus: HTMLElement | null = null;
function closeModal() { if (mutating) return; el('modal').hidden = true; modalWork = undefined; previousFocus?.focus(); }
function confirmAction(title: string, text: string, work: () => Promise<void>) {
  if (mutating) return;
  previousFocus = document.activeElement as HTMLElement; modalWork = work; el('modal-title').textContent = title; el('modal-body').textContent = text; el('modal').hidden = false; el('modal-cancel').focus();
}
el('modal-confirm').onclick = async () => {
  if (!modalWork || mutating) return; mutating = true;
  el<HTMLButtonElement>('modal-confirm').disabled = true; el<HTMLButtonElement>('modal-cancel').disabled = true;
  try { await modalWork(); mutating = false; closeModal(); await refresh(); }
  catch (error) { el('modal-body').append(node('p', `操作失败：${(error as Error).message}`)); }
  finally { mutating = false; el<HTMLButtonElement>('modal-confirm').disabled = false; el<HTMLButtonElement>('modal-cancel').disabled = false; }
};
el('modal-cancel').onclick = closeModal;
el('modal').addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); if (event.key === 'Tab') { const first = el('modal-cancel'), last = el('modal-confirm'); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } } });
el('login-form').onsubmit = async event => { event.preventDefault(); if (refreshing) return; ++epoch; token = input('token').value.trim(); sessionStorage.setItem('terrarium-admin-token', token); el('login-error').textContent = ''; await refresh(); input('token').value = ''; };
el('logout').onclick = logout; el('refresh').onclick = () => { void refresh(); };
for (const item of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-tab]'))) item.onclick = () => tab(item.dataset.tab!);
input('search').oninput = renderBoxes;
el('select-visible').onclick = () => { for (const box of visibleBoxes()) if (box.registered) selected.add(box.id); renderBoxes(); };
el('clear-selected').onclick = () => { selected.clear(); renderBoxes(); };
el('compose-selected').onclick = () => { allTargets = false; audience(); tab('announcements'); };
el('scope-selected').onclick = () => { allTargets = false; audience(); };
el('scope-all').onclick = () => { allTargets = true; audience(); };
el('feedback-filter').onclick = () => { pendingOnly = !pendingOnly; el('feedback-filter').setAttribute('aria-pressed', String(pendingOnly)); renderFeedback(); };
for (const item of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-enable]'))) item.onclick = () => { scheduleEnabled = item.dataset.enable === 'true'; for (const other of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-enable]'))) other.setAttribute('aria-pressed', String(other === item)); };
for (const enabled of [true, false]) el(enabled ? 'http-on' : 'http-off').onclick = () => confirmAction(`立即${enabled ? '开启' : '关闭'} HTTP Push`, `${enabled ? '旧版客户端可以通过 HTTP 提交。' : '保留 HTTP 接口，忽略提交并返回未提交成功提示，同时发送升级公告。'}\n这会清除现有定时任务。`, async () => { await api('controls/http-push', 'PUT', { enabled }); });
el('http-cancel').onclick = () => confirmAction('取消定时任务', '保留当前生效的 HTTP Push 开关。', async () => { await api('controls/http-push', 'PUT', { cancel: true }); });
el('schedule-form').onsubmit = event => {
  event.preventDefault(); const value = input('schedule-at').value, at = new Date(`${value.replace(' ', 'T')}:00+08:00`);
  const canonical = Number.isFinite(at.getTime()) ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(at) : '';
  if (canonical !== value || at.getTime() <= Date.now() + serverOffset) { status('请输入有效的未来北京时间，格式为 YYYY-MM-DD HH:mm'); return; }
  const body = { enabled: scheduleEnabled, at: at.toISOString() };
  confirmAction('确认定时切换', `${value}（北京时间）${body.enabled ? '开启' : '关闭'} HTTP Push。\n将替换现有定时任务。`, async () => { await api('controls/http-push', 'PUT', body); });
};
el('notice-form').onsubmit = event => {
  event.preventDefault(); const hours = Number(input('expiry').value), text = input('notice-text').value.trim();
  if (!text || !Number.isFinite(hours) || hours <= 0 || hours > 720 || (!allTargets && (selected.size === 0 || selected.size > 100))) { status('请输入公告内容、0～720 小时有效期，并选择 1～100 个盒子或广播。'); return; }
  const body = { title: input('notice-title').value.trim(), text, targets: allTargets ? 'all' : [...selected], expiresAt: new Date(Date.now() + serverOffset + hours * 3600000).toISOString() };
  const recipients = allTargets ? '所有客户端（包括新注册客户端）及公网页面' : [...selected].map(id => `${snapshot?.boxes.find(box => box.id === id)?.name ?? id} (${id})`).join('\n');
  confirmAction('确认发布公告', `${body.title}\n\n${body.text}\n\n接收者：\n${recipients}\n\n有效至：${date(body.expiresAt)}`, async () => { await api('announcements', 'POST', body); input('notice-text').value = ''; });
};
if (localStorage.getItem('terrarium-admin-theme') === 'light') document.body.classList.add('light');
el('theme').onclick = () => { document.body.classList.toggle('light'); localStorage.setItem('terrarium-admin-theme', document.body.classList.contains('light') ? 'light' : 'dark'); };
setInterval(() => { if (!document.hidden) { void refresh(); renderCountdown(); } }, 15000);
setInterval(() => { if (!document.hidden && token) renderCountdown(); }, 1000);
if (token) void refresh();

el('minimum-form').onsubmit = event => {
  event.preventDefault();
  const version = input('minimum-version').value.trim(), at = input('minimum-at').value.trim();
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) || (at && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(at))) { status('请输入版本号及有效的北京时间'); return; }
  confirmAction('确认最低客户端版本', `最低版本 ${version}，${at ? `${at}（北京时间）生效` : '立即生效'}。低版本和未上报版本的提交将被忽略。`, async () => { await api('controls/minimum-client-version', 'PUT', { version, ...(at ? { at: at.replace(' ', 'T') + ':00+08:00' } : {}) }); });
};
el('minimum-off').onclick = () => confirmAction('取消版本限制', '允许所有客户端版本提交。HTTP Push 开关仍单独生效。', async () => { await api('controls/minimum-client-version', 'PUT', { version: null }); });
el('minimum-cancel').onclick = () => confirmAction('取消版本定时变更', '保留当前最低客户端版本。', async () => { await api('controls/minimum-client-version', 'PUT', { cancel: true }); });
