import type { ToolDef } from 'cortico/core/types.ts';

export interface PhotoLink { url: string; expiresAt: string }
/** Link metadata is returned as data; the client never fetches it or forwards box credentials. */
export function parsePhotoLink(url: unknown, expiresAt: unknown, capturedAt: string): PhotoLink | undefined {
  if (url === undefined && expiresAt === undefined) return undefined;
  if (typeof url !== 'string' || url.length > 2048 || typeof expiresAt !== 'string' || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.parse(capturedAt)) throw new Error('Invalid photo link metadata');
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error('Invalid photo link metadata'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) throw new Error('Invalid photo link metadata: HTTPS URL required without credentials or fragment');
  return { url, expiresAt };
}

export const TERRARIUM_PHOTO_TOOL_DECL: Omit<ToolDef, 'handler'> = {
  name: 'terrarium_take_photo', tags: ['write'],
  description: 'Photograph your claimed land or water box (default land) as a 1280×1600 Material You PNG poster. Optional caption: at most 120 Unicode characters. Syncs the current snapshot by WebSocket, then verifies its state hash before rendering on the configured server. Requires a server supporting photos; never claims a box. Returns an image attachment with a log: handle supplied by Core, plus url and expiresAt in this same tool result when the server supports temporary HTTPS links. Use url with image tools that accept only HTTPS; it expires at expiresAt (24 hours on the default server). Older photo servers return null url/expiresAt; use the attachment in that case. To send to QQ, pass that handle as image to the available QQ send tool, with a recipient and optional message chosen from the conversation. Taking a photo does not send a message or authorize unsolicited contact. The attached PNG preserves this moment even after the box changes; save or send the image to retain it.',
  parameters: { type: 'object', additionalProperties: false, properties: { habitat: { type: 'string', enum: ['land', 'water'] }, caption: { type: 'string', maxLength: 120 } } },
};
export function photoCaption(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value !== 'string' || [...value].length > 120 || /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u.test(value)) throw new Error('caption must be text of at most 120 characters without control characters');
  return value.trim();
}
