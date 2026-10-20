import type { WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';
import type { TerrariumSyncStatus } from '../src/leaderboard.ts';

export function createSyncControls(ctx: WebUiPanelContext, reload: () => Promise<void>) {
  const zh = ctx.language.startsWith('zh');
  const el = ctx.ui.h('div', 'terrarium-sync');
  const status = ctx.ui.h('div', 'terrarium-sync-status');
  status.setAttribute('role', 'status');
  let busy = false, available = false;
  const button = ctx.ui.button(zh ? '立即完整同步' : 'Sync full snapshot', { size: 'sm', onClick: () => { void sync(); } });
  const sync = async (): Promise<void> => {
    if (busy || !available) return;
    busy = true; button.disabled = true; el.dataset.state = 'syncing';
    status.textContent = zh ? '上报中…' : 'Uploading…';
    try { await ctx.invoke('sync'); busy = false; await reload(); }
    catch (error) { if (!ctx.signal.aborted) { el.dataset.state = 'error'; status.textContent = error instanceof Error ? error.message : String(error); } }
    finally { busy = false; button.disabled = !available; }
  };
  el.append(status, button);
  return { el, update(value: TerrariumSyncStatus, claimed: boolean): void {
    if (ctx.signal.aborted) return;
    available = claimed && value.state !== 'disabled';
    button.disabled = busy || !available;
    if (busy) return;
    el.dataset.state = value.state;
    const labels = zh
      ? { disabled: '公开上报已关闭', idle: '尚未上报', syncing: '上报中…', synced: '最近上报成功', error: '上报失败' }
      : { disabled: 'Public reporting disabled', idle: 'No report yet', syncing: 'Uploading…', synced: 'Last upload succeeded', error: 'Upload failed' };
    const parts = [labels[value.state], `${zh ? '客户端' : 'Client'} ${value.clientVersion}`];
    if (value.lastSuccessStateAt) parts.push(`${zh ? '已提交模拟时间' : 'Accepted simulation time'} ${new Date(value.lastSuccessStateAt).toLocaleString(ctx.language)}`);
    if (value.nextRetryAt) parts.push(`${zh ? '下次重试' : 'Next retry'} ${new Date(value.nextRetryAt).toLocaleString(ctx.language)}`);
    if (value.transport) parts.push(value.transport === 'ws' ? 'WebSocket' : (zh ? 'HTTP 兼容模式' : 'HTTP compatibility'));
    if (value.transport === 'ws' && value.mode === 'incremental') parts.push(zh ? '增量' : 'Incremental');
    if (value.lastSuccessAt) parts.push(`${zh ? '最近成功' : 'Last success'} ${new Date(value.lastSuccessAt).toLocaleString(ctx.language)}`);
    if (value.state === 'error') parts.push(`${zh ? '连续失败' : 'Consecutive failures'} ${value.consecutiveFailures}`, value.lastError ?? '');
    status.textContent = parts.filter(Boolean).join(' · ');
  } };
}
