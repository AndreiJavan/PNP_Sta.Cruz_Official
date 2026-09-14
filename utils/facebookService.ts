import dotenv from 'dotenv';
import { db } from '../config/database.js';
import { classifyCategory } from './categoryClassifier.js';

dotenv.config();

export interface FacebookPost {
  id: string;
  message?: string;
  created_time: string;
  full_picture?: string;
  attachments?: {
    data: Array<{
      media?: { image?: { src: string } };
      subattachments?: {
        data: Array<{ media?: { image?: { src: string } } }>;
      };
    }>;
  };
  permalink_url?: string;
}

export class FacebookService {
  private static getCredentials() {
    const pageId = process.env.FB_PAGE_ID || 'stacruzpolicelagunappo';
    const accessToken = process.env.FB_PAGE_ACCESS_TOKEN || process.env.FB_APP_ID + '|' + process.env.FB_APP_SECRET;
    return { pageId, accessToken };
  }

  /**
   * Fetches latest posts directly from Facebook Graph API
   */
  public static async fetchLatestPosts(limit = 25): Promise<FacebookPost[]> {
    const { pageId, accessToken } = this.getCredentials();

    if (!pageId || !accessToken) {
      console.warn('[FACEBOOK SYNC] FB_PAGE_ID or access token missing. Skipping fetch.');
      return [];
    }

    try {
      const url = `https://graph.facebook.com/v19.0/${pageId}/posts?fields=id,message,created_time,full_picture,attachments{media,subattachments},permalink_url&limit=${limit}&access_token=${accessToken}`;
      console.log(`[FACEBOOK SYNC] Fetching posts from page: ${pageId}`);

      const response = await fetch(url);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('[FACEBOOK SYNC API ERROR]', errorData);
        throw new Error(`Facebook API responded with status ${response.status}: ${JSON.stringify(errorData)}`);
      }

      const result = await response.json();
      const posts: FacebookPost[] = result.data || [];
      console.log(`[FACEBOOK SYNC] Successfully fetched ${posts.length} posts from Facebook Graph API.`);
      return posts;
    } catch (err: any) {
      console.error('[FACEBOOK SYNC EXCEPTION]', err.message || err);
      throw err;
    }
  }

  /**
   * Synchronizes Facebook posts into local database / bulletins table with Auto-Segregation
   */
  public static async syncPostsToBulletins(limit = 25): Promise<{ total: number; added: number; skipped: number }> {
    const posts = await this.fetchLatestPosts(limit);
    if (!posts || posts.length === 0) {
      return { total: 0, added: 0, skipped: 0 };
    }

    let addedCount = 0;
    let skippedCount = 0;

    try {
      // 1. Fetch existing bulletins to avoid duplicate insertion
      let existingSnap;
      try {
        existingSnap = await db.collection('bulletins').get();
      } catch (dbErr) {
        console.warn('[FACEBOOK SYNC] Database fetch fallback check:', dbErr);
        existingSnap = { docs: [] };
      }

      const existingFbIds = new Set<string>();
      existingSnap.docs.forEach((doc: any) => {
        const data = doc.data ? doc.data() : doc;
        if (data.fb_post_id) {
          existingFbIds.add(data.fb_post_id);
        }
      });

      for (const post of posts) {
        // Skip if already imported
        if (existingFbIds.has(post.id)) {
          skippedCount++;
          continue;
        }

        const messageText = post.message?.trim() || 'Official Facebook Announcement from PNP Sta. Cruz';
        const title = messageText.split('\n')[0].substring(0, 120) || 'Facebook Post';

        // Auto-Segregation: classify post text into Crime, Traffic, Cybercrime, or Community Awareness
        const autoCategory = classifyCategory(messageText);

        // Extract pictures
        let photoPaths: string[] = [];
        if (post.full_picture) {
          photoPaths.push(post.full_picture);
        }

        if (post.attachments?.data) {
          for (const att of post.attachments.data) {
            if (att.subattachments?.data) {
              for (const sub of att.subattachments.data) {
                if (sub.media?.image?.src && !photoPaths.includes(sub.media.image.src)) {
                  photoPaths.push(sub.media.image.src);
                }
              }
            }
          }
        }

        const bulletinRecord = {
          title: title,
          category: autoCategory, // Automatically segregated into Crime, Traffic, Cybercrime, or Community Awareness
          body: messageText,
          photo_path: photoPaths.length > 0 ? JSON.stringify(photoPaths) : null,
          fb_post_id: post.id,
          fb_permalink: post.permalink_url || `https://facebook.com/${post.id}`,
          is_archived: false,
          created_at: new Date(post.created_time || Date.now()).toISOString(),
          updated_at: new Date().toISOString()
        };

        // Insert into database
        await db.collection('bulletins').add(bulletinRecord);
        addedCount++;
        console.log(`[FACEBOOK SYNC] Imported & Segregated FB Post ${post.id} as [${autoCategory}]`);
      }

      console.log(`[FACEBOOK SYNC COMPLETED] Total: ${posts.length}, Added: ${addedCount}, Skipped: ${skippedCount}`);
      return { total: posts.length, added: addedCount, skipped: skippedCount };
    } catch (err: any) {
      console.error('[FACEBOOK SYNC FAILED]', err);
      throw err;
    }
  }
}
