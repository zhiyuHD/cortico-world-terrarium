import type { ToolDef } from 'cortico/core/types.ts';

export const TERRARIUM_PHOTO_TOOL_DECL: Omit<ToolDef, 'handler'> = {
  name: 'terrarium_take_photo', tags: ['write'],
  description: 'Photograph your claimed land or water box (default land) as a 1280×1600 Material You PNG poster. Optional caption: at most 120 Unicode characters. Syncs the current snapshot by WebSocket, then verifies its state hash before rendering on the configured server. Requires a server supporting photos; never claims a box. Returns an image attachment with a log: handle supplied by Core. To send to QQ, pass that handle as image to the available QQ send tool, with a recipient and optional message chosen from the conversation. Taking a photo does not send a message or authorize unsolicited contact. The attached PNG preserves this moment even after the box changes; save or send the image to retain it.',
  parameters: { type: 'object', additionalProperties: false, properties: { habitat: { type: 'string', enum: ['land', 'water'] }, caption: { type: 'string', maxLength: 120 } } },
};
export function photoCaption(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value !== 'string' || [...value].length > 120 || /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u.test(value)) throw new Error('caption must be text of at most 120 characters without control characters');
  return value.trim();
}
