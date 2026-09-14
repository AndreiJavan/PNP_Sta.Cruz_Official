import { classifyCategory } from './categoryClassifier.js';

export interface ScrapedFacebookPost {
  id: string;
  message: string;
  created_time: string;
  full_picture?: string;
  images?: string[];
  video_url?: string;
  permalink_url: string;
  media_type?: 'photo' | 'video' | 'reel' | 'post';
}

/**
 * Public Facebook Post Parser & Scraper Engine
 * Bypasses Meta App Publishing / Business Verification by reading public page OpenGraph metadata & oEmbed streams.
 */
export class FacebookScraper {
  /**
   * Validates if a Facebook URL is alive, reachable, and does not return 404.
   */
  public static async verifyUrlHealth(url: string): Promise<boolean> {
    if (!url || typeof url !== 'string') return false;

    try {
      const parsed = new URL(url);
      if (!parsed.hostname.includes('facebook.com')) return false;
    } catch (_) {
      return false;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);

      const response = await fetch(url, {
        method: 'HEAD',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      if (response.ok || (response.status >= 200 && response.status < 400)) {
        return true;
      }
    } catch (_) {}

    // Fallback validation via Facebook oEmbed endpoint
    try {
      const oembedUrl = `https://www.facebook.com/plugins/post/oembed.json/?url=${encodeURIComponent(url)}`;
      const res = await fetch(oembedUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      return res.ok;
    } catch (_) {
      return false;
    }
  }

  /**
   * Cleans and normalizes any Facebook URL (Photo, Reel, Video, Album, Post)
   * into a canonical direct Facebook redirect link.
   */
  public static normalizeFacebookUrl(rawUrl: string): { url: string; type: 'photo' | 'video' | 'reel' | 'post' } {
    if (!rawUrl) {
      return { url: 'https://www.facebook.com/2329513750399495', type: 'post' };
    }

    let url = rawUrl.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    try {
      const parsed = new URL(url);

      // Reel URL handling
      if (parsed.pathname.includes('/reel/')) {
        const reelMatch = parsed.pathname.match(/\/reel\/(\d+)/);
        const reelId = reelMatch ? reelMatch[1] : parsed.pathname.split('/').filter(Boolean).pop();
        return {
          url: `https://www.facebook.com/reel/${reelId}`,
          type: 'reel'
        };
      }

      // Video / Watch URL handling
      if (parsed.pathname.includes('/watch') || parsed.pathname.includes('/videos/')) {
        const vParam = parsed.searchParams.get('v');
        const vidMatch = parsed.pathname.match(/\/videos\/(\d+)/);
        const videoId = vParam || (vidMatch ? vidMatch[1] : null);
        return {
          url: videoId ? `https://www.facebook.com/reel/${videoId}` : `https://www.facebook.com/watch/?v=${videoId || ''}`,
          type: 'video'
        };
      }

      // Photo / Album URL handling
      if (parsed.pathname.includes('/photo') || parsed.pathname.includes('/photos/')) {
        const fbid = parsed.searchParams.get('fbid');
        const setParam = parsed.searchParams.get('set');
        if (fbid && setParam) {
          return {
            url: `https://www.facebook.com/photo?fbid=${fbid}&set=${encodeURIComponent(setParam)}`,
            type: 'photo'
          };
        } else if (fbid) {
          return {
            url: `https://www.facebook.com/photo?fbid=${fbid}`,
            type: 'photo'
          };
        }
        return {
          url: `https://www.facebook.com${parsed.pathname}`,
          type: 'photo'
        };
      }

      // Standard post or permalink
      return {
        url: `https://www.facebook.com${parsed.pathname}${parsed.search}`,
        type: 'post'
      };
    } catch (_) {
      return { url, type: 'post' };
    }
  }

  /**
   * Fetches public posts from a Facebook Page without requiring Meta App Review or tokens.
   * Uses direct crawler emulation to extract real captions, high-res photos, and videos.
   */
  public static async fetchPublicPagePosts(pageHandle: string = 'stacruzpolicelagunappo', limit = 25): Promise<ScrapedFacebookPost[]> {
    console.log(`[PUBLIC FB SCRAPER] Fetching public page feed for: ${pageHandle}`);
    
    const cleanHandle = pageHandle.replace(/^https?:\/\/(www\.)?facebook\.com\//, '').replace(/\/$/, '') || 'stacruzpolicelagunappo';

    try {
      // 1. PRIMARY STRATEGY: Direct Crawler Fetch (Googlebot UA receives full public timeline with all media)
      const res = await fetch(`https://www.facebook.com/${cleanHandle}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      });

      if (res.ok) {
        const html = await res.text();
        if (html.includes('"__typename":"Story"')) {
          const storyChunks = html.split(/"__typename":"Story"/);
          const parsedPosts: ScrapedFacebookPost[] = [];
          const seenIds = new Set<string>();

          for (let i = 1; i < storyChunks.length; i++) {
            if (parsedPosts.length >= limit) break;
            const chunk = storyChunks[i];

            // Post ID
            const idMatch = chunk.match(/"post_id":"(\d+)"/) || chunk.match(/story_fbid=(\d+)/);
            if (!idMatch) continue;
            const postId = idMatch[1];
            if (seenIds.has(postId)) continue;
            seenIds.add(postId);

            // Creation time
            const timeMatch = chunk.match(/"creation_time":(\d+)/);
            const creationTime = timeMatch 
              ? new Date(parseInt(timeMatch[1], 10) * 1000).toISOString() 
              : new Date(Date.now() - parsedPosts.length * 3600000).toISOString();

            // Message text / Caption
            let message = '';
            const msgMatch = chunk.match(/"message":\{"text":"([\s\S]*?)"\}/);
            if (msgMatch) {
              try {
                message = JSON.parse(`"${msgMatch[1]}"`);
              } catch (_) {
                message = msgMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
              }
            }

            // Permalink URL
            const urlMatch = chunk.match(/"url":"(https:[^"]+)"/);
            let permalink = urlMatch 
              ? urlMatch[1].replace(/\\\/|\\/g, '/') 
              : `https://www.facebook.com/${cleanHandle}/posts/${postId}`;
            if (permalink.includes('photo.php?fbid=')) {
              permalink = `https://www.facebook.com/photo/?fbid=${postId}&set=a.225279966311112`;
            }

            // Photos extraction
            const photos: string[] = [];
            const lookasideMatches = chunk.match(/https:\\\/\\\/lookaside\.fbsbx\.com\\\/lookaside\\\/crawler\\\/media\\\/[^"\s]+/g) || [];
            for (const m of lookasideMatches) {
              const clean = m.replace(/\\\/|\\/g, '/');
              // Filter out system icons or profile images
              if (!clean.includes('100064873290430') && !clean.includes('100000807064695') && !photos.includes(clean)) {
                photos.push(clean);
              }
            }

            const scontentMatches = chunk.match(/https:\\\/\\\/scontent[^"\s]+/g) || [];
            for (const m of scontentMatches) {
              const clean = m.replace(/\\\/|\\/g, '/');
              if (!clean.includes('.srt') && !clean.includes('s50x50') && !clean.includes('p50x50') && !photos.includes(clean)) {
                photos.push(clean);
              }
            }

            // Videos extraction
            const videos: string[] = [];
            const videoMatches = chunk.match(/"(playable_url|browser_native_hd_url|browser_native_sd_url)":"([^"]+)"/g) || [];
            for (const vm of videoMatches) {
              const vUrl = vm.replace(/^"[^"]+":"/, '').replace(/"$/, '').replace(/\\\/|\\/g, '/');
              if (vUrl && !videos.includes(vUrl)) {
                videos.push(vUrl);
              }
            }

            // If permalink is video / reel, resolve video crawler media ID
            if (permalink.includes('/videos/') || permalink.includes('/reel/') || permalink.includes('/watch')) {
              const vidIdMatch = permalink.match(/\/videos\/(\d+)/) || permalink.match(/\/reel\/(\d+)/);
              if (vidIdMatch) {
                const lookasideVid = `https://lookaside.fbsbx.com/lookaside/crawler/media/?media_id=${vidIdMatch[1]}`;
                if (!videos.includes(lookasideVid)) {
                  videos.unshift(lookasideVid);
                }
              }
            }

            if (!message && photos.length === 0 && videos.length === 0) continue;

            parsedPosts.push({
              id: postId,
              message: message || 'Official Facebook Announcement from PNP Sta. Cruz',
              created_time: creationTime,
              full_picture: photos[0] || undefined,
              images: photos,
              video_url: videos[0] || undefined,
              permalink_url: permalink,
              media_type: videos.length > 0 ? 'video' : 'photo'
            });
          }

          if (parsedPosts.length > 0) {
            console.log(`[PUBLIC FB SCRAPER] Successfully extracted ${parsedPosts.length} real posts via Crawler Engine.`);
            return parsedPosts;
          }
        }
      }
    } catch (crawlerErr: any) {
      console.warn('[PUBLIC FB SCRAPER] Crawler fetch warning:', crawlerErr.message || crawlerErr);
    }

    return [];
  }

  /**
   * Fetches metadata for an individual Facebook Photo, Reel, Video, or Post URL.
   */
  public static async parsePostUrl(postUrl: string): Promise<ScrapedFacebookPost | null> {
    const normalized = this.normalizeFacebookUrl(postUrl);

    try {
      const oembedEndpoint = normalized.type === 'video' || normalized.type === 'reel'
        ? `https://www.facebook.com/plugins/video/oembed.json/?url=${encodeURIComponent(normalized.url)}`
        : `https://www.facebook.com/plugins/post/oembed.json/?url=${encodeURIComponent(normalized.url)}`;

      const response = await fetch(oembedEndpoint, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (response.ok) {
        const data = await response.json();
        const html = data.html || '';
        const authorName = data.author_name || 'PNP Sta. Cruz';
        const extractedTitle = data.title || '';

        const messageText = extractedTitle || html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || `Official Announcement from ${authorName}`;
        const thumbnail = data.thumbnail_url || data.author_url || undefined;

        return {
          id: `fb_url_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          message: messageText,
          created_time: new Date().toISOString(),
          full_picture: thumbnail,
          images: thumbnail ? [thumbnail] : [],
          permalink_url: normalized.url,
          media_type: normalized.type
        };
      }
    } catch (err) {
      console.warn('[PUBLIC FB SCRAPER] oEmbed fetch failed, returning URL object fallback:', err);
    }

    return {
      id: `fb_url_${Date.now()}`,
      message: `Official PNP Sta. Cruz Facebook ${normalized.type.toUpperCase()}`,
      created_time: new Date().toISOString(),
      permalink_url: normalized.url,
      media_type: normalized.type
    };
  }
}

