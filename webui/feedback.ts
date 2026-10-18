import type { WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';
import { parseFeedback, type TerrariumFeedbackReceipt } from '../src/feedback.ts';

let nextId = 0;
export function createFeedbackControls(ctx: WebUiPanelContext): HTMLElement {
  const zh = ctx.language.startsWith('zh'), prefix = `terrarium-feedback-${++nextId}`;
  const root = ctx.ui.h('section', 'terrarium-feedback');
  const panel = ctx.ui.h('div', 'terrarium-feedback-panel'); panel.id = prefix; panel.hidden = true;
  const toggle = ctx.ui.button(zh ? '意见反馈' : 'Send feedback', { size: 'sm', onClick: () => {
    panel.hidden = !panel.hidden; toggle.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) text.focus();
  } });
  toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', prefix);
  const form = document.createElement('form');
  const label = document.createElement('label'); label.textContent = zh ? '反馈内容（最多 2000 字）' : 'Feedback (up to 2000 characters)';
  const text = document.createElement('textarea'); text.maxLength = 2000; text.rows = 4; text.name = 'text'; label.append(text);
  const contactLabel = document.createElement('label'); contactLabel.textContent = zh ? '联系方式（选填）' : 'Contact (optional)';
  const contact = document.createElement('input'); contact.maxLength = 200; contact.name = 'contact'; contact.autocomplete = 'off'; contactLabel.append(contact);
  const privacy = ctx.ui.h('p', '', zh ? '仅服务端管理员可见。' : 'Visible only to the service administrator.');
  const status = ctx.ui.h('p', 'terrarium-feedback-status'); status.setAttribute('role', 'status');
  const submit = ctx.ui.button(zh ? '提交反馈' : 'Submit feedback', { size: 'sm' });
  submit.type = 'submit';
  let pending = false;
  const send = async (): Promise<void> => {
    if (pending) return;
    try {
      const input = parseFeedback({ text: text.value, contact: contact.value });
      pending = true; submit.disabled = true; text.disabled = true; contact.disabled = true;
      status.textContent = zh ? '提交中…' : 'Submitting…';
      const receipt = await ctx.invoke<TerrariumFeedbackReceipt>('feedback', [input]);
      if (ctx.signal.aborted) return;
      status.textContent = zh ? `已提交，编号 #${receipt.id}` : `Submitted, reference #${receipt.id}`;
      text.value = ''; contact.value = '';
    } catch (error) { if (!ctx.signal.aborted) status.textContent = error instanceof Error ? error.message : String(error); }
    finally { pending = false; submit.disabled = false; text.disabled = false; contact.disabled = false; }
  };
  form.addEventListener('submit', event => { event.preventDefault(); void send(); });
  form.append(label, contactLabel, privacy, submit, status); panel.append(form); root.append(toggle, panel);
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); toggle.focus(); } });
  return root;
}
