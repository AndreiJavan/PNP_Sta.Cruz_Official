import dotenv from 'dotenv';
import { db } from '../config/database.js';
import { classifyCategory } from './categoryClassifier.js';
import { FacebookScraper } from './facebookScraper.js';

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

    // Resolve exact numeric Page ID from Meta Graph API using access token
    let numericPageId = pageId;
    try {
      const meRes = await fetch(`https://graph.facebook.com/v19.0/me?access_token=${accessToken}`);
      if (meRes.ok) {
        const meData = await meRes.json();
        if (meData && meData.id) {
          numericPageId = meData.id;
          console.log(`[FACEBOOK SYNC] Resolved Page Name: "${meData.name}", Numeric ID: ${numericPageId}`);
        }
      }
    } catch (_) {}

    const fields = 'id,message,story,caption,created_time,full_picture,attachments{media,subattachments,description,title},permalink_url';
    const endpoints = [
      `https://graph.facebook.com/v19.0/${numericPageId}/published_posts?fields=${fields}&limit=${limit}&access_token=${accessToken}`,
      `https://graph.facebook.com/v19.0/${numericPageId}/feed?fields=${fields}&limit=${limit}&access_token=${accessToken}`,
      `https://graph.facebook.com/v19.0/${numericPageId}/posts?fields=${fields}&limit=${limit}&access_token=${accessToken}`,
      `https://graph.facebook.com/v19.0/me/published_posts?fields=${fields}&limit=${limit}&access_token=${accessToken}`,
      `https://graph.facebook.com/v19.0/me/feed?fields=${fields}&limit=${limit}&access_token=${accessToken}`,
      `https://graph.facebook.com/v19.0/me/posts?fields=${fields}&limit=${limit}&access_token=${accessToken}`,
      `https://graph.facebook.com/v19.0/${pageId}/published_posts?fields=${fields}&limit=${limit}&access_token=${accessToken}`,
      `https://graph.facebook.com/v19.0/${pageId}/feed?fields=${fields}&limit=${limit}&access_token=${accessToken}`,
      `https://graph.facebook.com/v19.0/${pageId}/posts?fields=${fields}&limit=${limit}&access_token=${accessToken}`
    ];

    let lastError: any = null;

    for (const url of endpoints) {
      try {
        console.log(`[FACEBOOK SYNC] Attempting fetch endpoint: ${url.split('?')[0]}`);
        const response = await fetch(url);
        if (response.ok) {
          const result = await response.json();
          const posts: FacebookPost[] = result.data || [];
          if (posts.length > 0) {
            console.log(`[FACEBOOK SYNC SUCCESS] Retreived ${posts.length} posts from endpoint: ${url.split('?')[0]}`);
            return posts;
          }
        } else {
          const errData = await response.json().catch(() => ({}));
          lastError = errData;
        }
      } catch (err: any) {
        lastError = err;
      }
    }

    if (lastError) {
      console.warn('[FACEBOOK SYNC] All endpoint attempts returned empty or error:', lastError);
    }
    return [];
  }

  /**
   * Synchronizes Facebook posts into local database / bulletins table with Auto-Segregation
   */
  public static async syncPostsToBulletins(limit = 25): Promise<{ total: number; added: number; skipped: number; errors: string[] }> {
    let posts = await this.fetchLatestPosts(limit);

    // If Graph API returns empty array (e.g. Meta app is unpublished), fall back to Public Facebook Scraper
    if (!posts || posts.length === 0) {
      console.log('[FACEBOOK SYNC] Graph API returned 0 posts. Switching to Public Facebook Scraper fallback...');
      const scraped = await FacebookScraper.fetchPublicPagePosts('stacruzpolicelagunappo', limit);
      posts = scraped as FacebookPost[];
    }

    if (!posts || posts.length === 0) {
      return { total: 0, added: 0, skipped: 0, errors: [] };
    }

    let addedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    try {
      // 1. Fetch existing bulletins to avoid duplicate insertion
      let existingSnap;
      try {
        existingSnap = await db.collection('bulletins').get();
      } catch (dbErr) {
        console.warn('[FACEBOOK SYNC] Database fetch fallback check:', dbErr);
        existingSnap = { docs: [] };
      }

      const existingSignatures = new Set<string>();
      existingSnap.docs.forEach((doc: any) => {
        const data = doc.data ? doc.data() : doc;
        if (data.title) existingSignatures.add(data.title.trim());
        if (data.body) existingSignatures.add(data.body.trim());
      });

      for (const post of posts) {
        try {
          const rawMessage = post.message?.trim() || (post as any).story?.trim() || (post as any).caption?.trim() || '';
          const messageText = rawMessage || 'Official Facebook Announcement from PNP Sta. Cruz';
          const title = rawMessage ? rawMessage.split('\n')[0].substring(0, 120) : 'Official Facebook Post';
          const fbPermalink = post.permalink_url || `https://www.facebook.com/${post.id}`;
          const bodyWithLink = `${messageText}\n\n[View Official Facebook Post](${fbPermalink})`;

          // Skip if already imported by checking title / body signatures
          if (existingSignatures.has(title.trim()) || existingSignatures.has(bodyWithLink.trim())) {
            skippedCount++;
            continue;
          }

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

          // Encode category using system custom category encoder to pass Supabase check constraint
          const STANDARD_CATS = ['Wanted Person', 'Missing Person', 'Crime Advisory', 'Recovered Property', 'General Announcement'];
          let dbCategory = autoCategory;
          let finalBody = bodyWithLink;

          if (!STANDARD_CATS.includes(autoCategory)) {
            dbCategory = 'General Announcement';
            finalBody = `${finalBody}\n<!--CUSTOM_CATEGORY:${autoCategory}-->`;
          }

          const bulletinRecord: any = {
            title: title,
            category: dbCategory,
            body: finalBody,
            photo_path: photoPaths.length > 0 ? JSON.stringify(photoPaths) : null,
            is_archived: false,
            created_at: new Date(post.created_time || Date.now()).toISOString(),
            updated_at: new Date().toISOString()
          };

          // Insert into database using standard schema
          await db.collection('bulletins').add(bulletinRecord);
          addedCount++;
          console.log(`[FACEBOOK SYNC] Imported & Segregated FB Post ${post.id} as [${autoCategory}]`);
        } catch (postErr: any) {
          console.error(`[FACEBOOK SYNC POST ERROR] Post ${post.id}:`, postErr);
          errors.push(`Post ${post.id}: ${postErr.message || postErr}`);
        }
      }

      console.log(`[FACEBOOK SYNC COMPLETED] Total: ${posts.length}, Added: ${addedCount}, Skipped: ${skippedCount}, Errors: ${errors.length}`);
      return { total: posts.length, added: addedCount, skipped: skippedCount, errors };
    } catch (err: any) {
      console.error('[FACEBOOK SYNC FAILED]', err);
      throw err;
    }
  }
}
