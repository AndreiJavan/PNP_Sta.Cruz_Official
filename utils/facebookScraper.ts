import { classifyCategory } from './categoryClassifier.js';

export interface ScrapedFacebookPost {
  id: string;
  message: string;
  created_time: string;
  full_picture?: string;
  permalink_url: string;
}

/**
 * Public Facebook Post Parser & Scraper Engine
 * Bypasses Meta App Publishing / Business Verification by reading public page OpenGraph metadata & oEmbed streams.
 */
export class FacebookScraper {
  /**
   * Fetches public posts from a Facebook Page without requiring Meta App Review or tokens.
   */
  public static async fetchPublicPagePosts(pageHandle: string = 'stacruzpolicelagunappo', limit = 15): Promise<ScrapedFacebookPost[]> {
    console.log(`[PUBLIC FB SCRAPER] Fetching public page feed for: ${pageHandle}`);
    
    try {
      const pageUrl = `https://mbasic.facebook.com/${pageHandle}`;
      const response = await fetch(pageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });

      if (!response.ok) {
        console.warn(`[PUBLIC FB SCRAPER] mbasic page returned status ${response.status}`);
        return [];
      }

      const html = await response.text();
      const posts: ScrapedFacebookPost[] = [];

      // Regex matches story blocks, permalinks, text, and images from public HTML
      const articleRegex = /<div class="[^"]*"(?: id="[^"]*")?>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;
      const permalinkRegex = /\/story\.php\?story_fbid=([^&"']+)/;
      const imgRegex = /<img[^>]+src="([^"]+)"/g;

      // Simple HTML tag stripper
      const stripTags = (str: string) => str.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

      // Extract sections matching story posts
      const sections = html.split('href="/story.php?story_fbid=');
      
      for (let i = 1; i < sections.length && posts.length < limit; i++) {
        const chunk = sections[i];
        const fbidMatch = chunk.match(/^([^&"']+)/);
        if (!fbidMatch) continue;

        const fbid = fbidMatch[1];
        const postUrl = `https://www.facebook.com/permalink.php?story_fbid=${fbid}&id=${pageHandle}`;

        // Extract message text snippet
        let message = stripTags(chunk.substring(0, 1500));
        // Remove common mbasic noise labels
        message = message.replace(/Like Comment Share Full Story|More|Like · Comment · Share/gi, '').trim();

        if (message.length < 10) continue;

        // Extract picture URL if present
        let fullPicture: string | undefined = undefined;
        let imgMatch;
        while ((imgMatch = imgRegex.exec(chunk)) !== null) {
          const src = imgMatch[1];
          if (src.includes('scontent') || src.includes('fbcdn')) {
            fullPicture = src.replace(/&amp;/g, '&');
            break;
          }
        }

        posts.push({
          id: fbid,
          message: message,
          created_time: new Date().toISOString(),
          full_picture: fullPicture,
          permalink_url: postUrl
        });
      }

      console.log(`[PUBLIC FB SCRAPER] Extracted ${posts.length} public posts without Meta App Review.`);
      return posts;
    } catch (err: any) {
      console.error('[PUBLIC FB SCRAPER ERROR]', err.message || err);
      return [];
    }
  }

  /**
   * Fetches metadata for an individual Facebook Post URL (e.g. pasted by admin).
   */
  public static async parsePostUrl(postUrl: string): Promise<ScrapedFacebookPost | null> {
    try {
      const cleanUrl = postUrl.trim();
      const oembedUrl = `https://www.facebook.com/plugins/post/oembed.json/?url=${encodeURIComponent(cleanUrl)}`;
      
      const response = await fetch(oembedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (response.ok) {
        const data = await response.json();
        const html = data.html || '';
        const authorName = data.author_name || 'PNP Sta. Cruz';
        
        // Strip HTML from oEmbed response
        const messageText = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || `Official Announcement from ${authorName}`;

        return {
          id: `fb_url_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          message: messageText,
          created_time: new Date().toISOString(),
          permalink_url: cleanUrl
        };
      }
    } catch (err) {
      console.warn('[PUBLIC FB SCRAPER] oEmbed fetch failed, returning URL object fallback:', err);
    }

    return {
      id: `fb_url_${Date.now()}`,
      message: `Official PNP Sta. Cruz Facebook Announcement`,
      created_time: new Date().toISOString(),
      permalink_url: postUrl
    };
  }
}
