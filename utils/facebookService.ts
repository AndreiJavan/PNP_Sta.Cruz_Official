import dotenv from 'dotenv';
import { db } from '../config/database.js';
import { classifyCategory } from './categoryClassifier.js';
import { FacebookScraper } from './facebookScraper.js';

dotenv.config();

export interface FacebookAttachmentMedia {
  image?: { src: string; height?: number; width?: number };
  source?: string; // Video playable source URL
}

export interface FacebookAttachmentTarget {
  id?: string;
  url?: string;
}

export interface FacebookAttachmentItem {
  description?: string;
  media?: FacebookAttachmentMedia;
  media_type?: string; // 'photo', 'video', 'album', 'link'
  target?: FacebookAttachmentTarget;
  title?: string;
  type?: string;
  url?: string;
  subattachments?: {
    data: FacebookAttachmentItem[];
  };
}

export interface FacebookPost {
  id: string;
  message?: string;
  story?: string;
  caption?: string;
  created_time: string;
  full_picture?: string;
  attachments?: {
    data: FacebookAttachmentItem[];
  };
  permalink_url?: string;
  images?: string[];
  video_url?: string;
}

export interface SyncStats {
  retrieved: number;
  added: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: string[];
}

export class FacebookService {
  private static getCredentials() {
    const pageId = process.env.FB_PAGE_ID || 'stacruzpolicelagunappo';
    const accessToken = process.env.FB_PAGE_ACCESS_TOKEN || (process.env.FB_APP_ID && process.env.FB_APP_SECRET ? `${process.env.FB_APP_ID}|${process.env.FB_APP_SECRET}` : '');
    return { pageId, accessToken };
  }

  /**
   * Resolves Page ID and fetches latest posts directly from Meta Graph API using pagination cursors
   */
  public static async fetchLatestPosts(limit = 50): Promise<FacebookPost[]> {
    const { pageId, accessToken } = this.getCredentials();

    if (!pageId || !accessToken) {
      console.warn('[FACEBOOK SYNC] FB_PAGE_ID or access token missing. Skipping fetch.');
      return [];
    }

    // Resolve exact numeric Page ID from Meta Graph API
    let numericPageId = pageId;
    try {
      const meRes = await fetch(`https://graph.facebook.com/v19.0/me?access_token=${accessToken}`);
      if (meRes.ok) {
        const meData = await meRes.json();
        if (meData && meData.id) {
          numericPageId = meData.id;
          console.log(`[FACEBOOK SYNC] Resolved Meta Page Name: "${meData.name}", Numeric ID: ${numericPageId}`);
        }
      }
    } catch (_) {}

    const fields = 'id,message,story,caption,created_time,full_picture,picture,source,attachments{description,media,media_type,target,title,type,url,subattachments{description,media,media_type,target,title,type,url}},permalink_url';
    const batchLimit = Math.min(25, limit);
    const initialEndpoints = [
      `https://graph.facebook.com/v19.0/${numericPageId}/published_posts?fields=${fields}&limit=${batchLimit}&access_token=${accessToken}`,
      `https://graph.facebook.com/v19.0/${numericPageId}/feed?fields=${fields}&limit=${batchLimit}&access_token=${accessToken}`,
      `https://graph.facebook.com/v19.0/${numericPageId}/posts?fields=${fields}&limit=${batchLimit}&access_token=${accessToken}`,
      `https://graph.facebook.com/v19.0/${pageId}/published_posts?fields=${fields}&limit=${batchLimit}&access_token=${accessToken}`
    ];

    const allPosts: FacebookPost[] = [];
    const seenPostIds = new Set<string>();

    for (const startUrl of initialEndpoints) {
      if (allPosts.length >= limit) break;

      let currentUrl: string | null = startUrl;
      let pageCount = 0;
      const MAX_PAGES = 4; // Safety limit for pagination loop

      while (currentUrl && pageCount < MAX_PAGES && allPosts.length < limit) {
        pageCount++;
        try {
          console.log(`[FACEBOOK SYNC API] Fetching page ${pageCount}: ${currentUrl.split('?')[0]}`);
          const response = await fetch(currentUrl);
          if (!response.ok) {
            const errBody = await response.json().catch(() => ({}));
            console.warn(`[FACEBOOK SYNC API NOTICE] Endpoint returned HTTP ${response.status}:`, errBody);
            break;
          }

          const result = await response.json();
          const batch: FacebookPost[] = result.data || [];
          let newInBatch = 0;

          for (const post of batch) {
            if (post.id && !seenPostIds.has(post.id)) {
              seenPostIds.add(post.id);
              allPosts.push(post);
              newInBatch++;
            }
          }

          console.log(`[FACEBOOK SYNC PAGINATION] Page ${pageCount}: Retrieved ${batch.length} posts (${newInBatch} new unique). Total collected: ${allPosts.length}`);

          // Meta Graph API Cursor Pagination check
          if (result.paging && result.paging.next && allPosts.length < limit) {
            currentUrl = result.paging.next;
          } else {
            currentUrl = null;
          }
        } catch (err: any) {
          console.error(`[FACEBOOK SYNC API ERROR] Page ${pageCount} fetch failed:`, err.message || err);
          break;
        }
      }

      if (allPosts.length > 0) break;
    }

    return allPosts;
  }

  /**
   * Helper: Extracts ONLY photos and videos belonging to THIS exact post.
   */
  public static extractPostMedia(post: FacebookPost): { photos: string[]; videos: string[] } {
    const photos: string[] = [];
    const videos: string[] = [];

    const toProxyUrl = (url: string) => {
      if (!url) return '';
      const clean = url.trim();
      if (clean.startsWith('/api/media-proxy')) return clean;
      if (clean.includes('lookaside.fbsbx.com') || clean.includes('.fbcdn.net')) {
        return `/api/media-proxy?url=${encodeURIComponent(clean)}`;
      }
      return clean;
    };

    const addPhoto = (src?: string) => {
      if (src && typeof src === 'string' && (src.startsWith('http') || src.startsWith('/api/media-proxy'))) {
        const proxied = toProxyUrl(src);
        if (!photos.includes(proxied)) {
          photos.push(proxied);
        }
      }
    };

    const addVideo = (src?: string) => {
      if (src && typeof src === 'string' && (src.startsWith('http') || src.startsWith('/api/media-proxy'))) {
        const proxied = toProxyUrl(src);
        if (!videos.includes(proxied)) {
          videos.push(proxied);
        }
      }
    };

    // Scraped / custom format pre-assigned array
    if (post.images && Array.isArray(post.images)) {
      post.images.forEach(addPhoto);
    }
    if ((post as any).photos && Array.isArray((post as any).photos)) {
      (post as any).photos.forEach(addPhoto);
    }
    if (post.video_url) {
      addVideo(post.video_url);
    }
    if ((post as any).videos && Array.isArray((post as any).videos)) {
      (post as any).videos.forEach(addVideo);
    }

    // Direct Graph API full_picture, picture, and video source
    if ((post as any).source) {
      addVideo((post as any).source);
    }
    if (post.full_picture) {
      addPhoto(post.full_picture);
    }
    if ((post as any).picture) {
      addPhoto((post as any).picture);
    }

    // Inspect Graph API attachments strictly belonging to THIS post
    if (post.attachments?.data && Array.isArray(post.attachments.data)) {
      for (const att of post.attachments.data) {
        // Video attachment check
        if (att.media_type === 'video' || att.type === 'video_inline' || att.type === 'video') {
          if (att.media?.source) {
            addVideo(att.media.source);
          } else if (att.url && (att.url.includes('/videos/') || att.url.includes('/reel/') || att.url.includes('/watch'))) {
            addVideo(att.url);
          }
          if (att.media?.image?.src) {
            addPhoto(att.media.image.src); // Keep video thumbnail as photo preview fallback
          }
        } else {
          // Photo attachment check
          if (att.media?.image?.src) {
            addPhoto(att.media.image.src);
          }
        }

        // Subattachments check (Multi-photo album / Carousel)
        if (att.subattachments?.data && Array.isArray(att.subattachments.data)) {
          for (const sub of att.subattachments.data) {
            if (sub.media_type === 'video' || sub.type === 'video_inline' || sub.type === 'video') {
              if (sub.media?.source) addVideo(sub.media.source);
              if (sub.media?.image?.src) addPhoto(sub.media.image.src);
            } else if (sub.media?.image?.src) {
              addPhoto(sub.media.image.src);
            }
          }
        }
      }
    }

    return { photos, videos };
  }

  /**
   * Synchronizes Facebook posts into database with auto-segregation and exact post-media association
   */
  public static async syncPostsToBulletins(limit = 50): Promise<SyncStats> {
    let posts = await this.fetchLatestPosts(limit);

    // Fallback to Public Scraper if Graph API returns 0 posts (e.g. unpublished Meta App)
    if (!posts || posts.length === 0) {
      console.log('[FACEBOOK SYNC] Meta Graph API returned 0 posts. Executing Public Page Scraper fallback...');
      const scraped = await FacebookScraper.fetchPublicPagePosts('stacruzpolicelagunappo', limit);
      posts = scraped as FacebookPost[];
    }

    const stats: SyncStats = {
      retrieved: posts ? posts.length : 0,
      added: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      errors: []
    };

    if (!posts || posts.length === 0) {
      return stats;
    }

    try {
      // Fetch existing bulletins snapshot for duplicate detection and upsert mapping
      let existingSnap;
      try {
        existingSnap = await db.collection('bulletins').get();
      } catch (dbErr) {
        console.warn('[FACEBOOK SYNC] Database snapshot warning:', dbErr);
        existingSnap = { docs: [] };
      }

      const existingPostsMap = new Map<string, { id: string; docData: any }>();
      const existingUrlsSet = new Set<string>();

      existingSnap.docs.forEach((doc: any) => {
        const docId = doc.id;
        const data = doc.data ? doc.data() : doc;
        
        if (data.body) {
          const fbUrlMatch = data.body.match(/<!--FACEBOOK_URL:(.*?)-->/) || data.body.match(/\[View Official Facebook Post\]\((.*?)\)/);
          if (fbUrlMatch && fbUrlMatch[1]) {
            const cleanUrl = fbUrlMatch[1].trim();
            existingUrlsSet.add(cleanUrl);
            existingPostsMap.set(cleanUrl, { id: docId, docData: data });
          }

          const fbIdMatch = data.body.match(/<!--FACEBOOK_POST_ID:(.*?)-->/);
          if (fbIdMatch && fbIdMatch[1]) {
            existingPostsMap.set(fbIdMatch[1].trim(), { id: docId, docData: data });
          }
        }

        if (data.facebook_post_id) {
          existingPostsMap.set(data.facebook_post_id, { id: docId, docData: data });
        }
      });

      const seenBatchUrls = new Set<string>();

      for (const post of posts) {
        try {
          const rawMessage = post.message?.trim() || post.story?.trim() || post.caption?.trim() || '';
          const messageText = rawMessage || 'Official Facebook Announcement from PNP Sta. Cruz';
          const title = rawMessage ? rawMessage.split('\n')[0].substring(0, 120) : 'Official Facebook Post';
          const rawPermalink = post.permalink_url || `https://www.facebook.com/stacruzpolicelagunappo/posts/${post.id}`;
          const normalizedMeta = FacebookScraper.normalizeFacebookUrl(rawPermalink);
          const fbPermalink = normalizedMeta.url;

          if (seenBatchUrls.has(fbPermalink)) {
            stats.skipped++;
            continue;
          }
          seenBatchUrls.add(fbPermalink);

          // Extract strictly associated media for THIS post
          const { photos, videos } = this.extractPostMedia(post);

          // Auto-Segregate into system categories
          const autoCategory = classifyCategory(messageText);

          const STANDARD_CATS = ['Wanted Person', 'Missing Person', 'Crime Advisory', 'Recovered Property', 'General Announcement'];
          let dbCategory = autoCategory;
          let finalBody = `${messageText}\n<!--FACEBOOK_URL:${fbPermalink}-->`;

          if (post.id) {
            finalBody = `${finalBody}\n<!--FACEBOOK_POST_ID:${post.id}-->`;
          }

          if (videos.length > 0) {
            finalBody = `${finalBody}\n<!--VIDEO_PATHS:${JSON.stringify(videos)}-->`;
          }

          if (!STANDARD_CATS.includes(autoCategory)) {
            dbCategory = 'General Announcement';
            finalBody = `${finalBody}\n<!--CUSTOM_CATEGORY:${autoCategory}-->`;
          }

          // Use original Facebook creation date for created_at
          const originalDate = post.created_time ? new Date(post.created_time).toISOString() : new Date().toISOString();

          // Compatible with Supabase public.bulletins schema cache (no missing column rejection)
          const bulletinRecord: any = {
            title: title,
            category: dbCategory,
            body: finalBody,
            photo_path: photos.length > 0 ? JSON.stringify(photos) : null,
            is_archived: false,
            created_at: originalDate,
            updated_at: new Date().toISOString()
          };

          // Upsert check: update if already exists in database, otherwise insert
          const existingEntry = existingPostsMap.get(fbPermalink) || existingPostsMap.get(post.id);

          if (existingEntry) {
            await db.collection('bulletins').doc(existingEntry.id).update({
              photo_path: bulletinRecord.photo_path,
              body: bulletinRecord.body,
              category: bulletinRecord.category,
              updated_at: new Date().toISOString()
            });
            stats.updated++;
            console.log(`[FACEBOOK SYNC UPSERT] Updated FB Post ${post.id} (${fbPermalink})`);
          } else {
            // Live URL Health Verification for new posts
            const isUrlAlive = await FacebookScraper.verifyUrlHealth(fbPermalink);
            if (!isUrlAlive) {
              console.warn(`[FACEBOOK SYNC] Skipping broken/unreachable URL: ${fbPermalink}`);
              stats.skipped++;
              continue;
            }

            await db.collection('bulletins').add(bulletinRecord);
            stats.added++;
            console.log(`[FACEBOOK SYNC INSERT] Inserted FB Post ${post.id} as [${autoCategory}] with ${photos.length} photos and ${videos.length} videos`);
          }
        } catch (postErr: any) {
          stats.failed++;
          const errMsg = `Post ${post.id}: ${postErr.message || postErr}`;
          console.error(`[FACEBOOK SYNC POST ERROR] ${errMsg}`);
          stats.errors.push(errMsg);
        }
      }

      console.log(`[FACEBOOK SYNC COMPLETED] Retrieved: ${stats.retrieved}, Added: ${stats.added}, Updated: ${stats.updated}, Skipped: ${stats.skipped}, Failed: ${stats.failed}`);
      return stats;
    } catch (err: any) {
      console.error('[FACEBOOK SYNC FATAL ERROR]', err);
      throw err;
    }
  }
}

