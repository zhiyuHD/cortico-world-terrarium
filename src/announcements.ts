export interface Announcement { id: number; title: string; text: string; createdAt: string; expiresAt: string; targets: 'all' | string[] }
export interface AnnouncementPage { announcements: Announcement[]; nextCursor: number }
export const TERRARIUM_MAX_ANNOUNCEMENTS = 2000;
export function validAnnouncement(value: unknown): value is Announcement {
  if (!value || typeof value !== 'object') return false;
  const notice = value as Announcement;
  return Number.isSafeInteger(notice.id) && notice.id > 0 && typeof notice.title === 'string' && notice.title.length <= 160 && typeof notice.text === 'string' && notice.text.trim().length > 0 && notice.text.length <= 2000 &&
    typeof notice.createdAt === 'string' && Number.isFinite(Date.parse(notice.createdAt)) && typeof notice.expiresAt === 'string' && Date.parse(notice.expiresAt) > Date.parse(notice.createdAt) &&
    (notice.targets === 'all' || (Array.isArray(notice.targets) && notice.targets.length > 0 && notice.targets.length <= 100 && notice.targets.every(id => typeof id === 'string' && /^[a-z0-9][a-z0-9_-]{1,39}$/.test(id))));
}
