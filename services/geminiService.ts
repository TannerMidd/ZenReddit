
import { RedditPostData, AIConfig } from "../types";

export interface AnalysisResult {
  id: string;
  isRageBait: boolean;
  zenScore: number;
  reason: string;
}

export const analyzePostsForZen = async (posts: RedditPostData[], config?: AIConfig): Promise<AnalysisResult[]> => {
  if (posts.length === 0) return [];

  // Use config key first, fallback to env (if provided during build), otherwise null
  const apiKey = config?.openRouterKey || process.env.API_KEY;

  if (!apiKey) {
      // Fail silently/gracefully if no key, just return fallback
      return fallbackResult(posts);
  }

  // Enhanced payload with contextual signals for better analysis
  const postsPayload = posts.map(p => {
    // Calculate engagement ratio (high ratio often = controversial)
    const engagementRatio = p.score > 0 ? (p.num_comments / p.score).toFixed(2) : '0';
    const isLinkPost = !p.selftext && p.url && !p.url.includes('reddit.com');
    
    return {
      id: p.id,
      title: p.title,
      subreddit: p.subreddit,
      body_snippet: p.selftext ? p.selftext.substring(0, 300) : "No text",
      domain: isLinkPost ? p.domain : null, // source domain for link posts
      flair: p.link_flair_text || null, // post flair
      engagement_ratio: engagementRatio, // comments/score ratio
      is_link_post: isLinkPost,
    };
  });

  const threshold = config?.minZenScore ?? 50;
  // Default to a free/cheap model on OpenRouter if not specified
  const model = config?.openRouterModel || 'google/gemini-2.0-flash-lite-preview-02-05:free';
  
  const customPrompt = config?.customInstructions ? 
    `USER CUSTOM PREFERENCES (IMPORTANT): "${config.customInstructions}". Adjust your scoring and reasoning based on these preferences.` : "";

  const systemPrompt = `
    Analyze the following Reddit posts to curate a "Zen" feed. 
    Your goal is to strictly filter out rage bait, intentionally divisive politics, aggressive arguments, and content designed to induce anxiety or anger.
    
    ${customPrompt}

    CONTEXT SIGNALS TO ANALYZE:
    1. **Subreddit**: Hobby, nature, creative, and support subs usually have high Zen scores. News, political, and drama subs need extra scrutiny.
    2. **Domain**: For link posts, evaluate the source. Tabloids, hyper-partisan news (left or right), outrage-focused sites, and clickbait farms should significantly lower the score.
    3. **Flair**: Post flairs provide important context. "Politics", "News", "Rant", "Drama" are warning signs. "Wholesome", "OC", "Question", "Discussion" are typically fine.
    4. **Engagement Ratio**: A high comments-to-score ratio (>0.5) often indicates controversial or divisive content that sparks arguments.
    5. **Title Analysis**: Watch for clickbait patterns, ALL CAPS, excessive punctuation (!!!, ???), accusatory/inflammatory language, or phrases designed to provoke outrage.
    6. **Link Posts**: External links to news or political sites require more scrutiny than self-posts sharing personal experiences.
    
    Output Requirements:
    Return a JSON object with a single key "results" containing an array of objects.
    Each object must have:
    - "id": string (matching the input post id)
    - "zenScore": number (0 to 100. 100 = Perfectly Zen/Calm/Constructive, 0 = Pure Rage Bait/Toxic).
    - "isRageBait": boolean (true if zenScore is below ${threshold}).
    - "reason": string (very short explanation, max 10 words).
  `;

  try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": window.location.origin, // Required by OpenRouter
          "X-Title": "ZenReddit"
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: JSON.stringify(postsPayload) }
          ],
          response_format: { type: "json_object" } 
        })
      });

      if (!response.ok) {
          throw new Error(`OpenRouter API Error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      
      if (!content) throw new Error("No content in AI response");

      let parsed;
      try {
          parsed = JSON.parse(content);
      } catch (e) {
          console.warn("AI response was not valid JSON", content);
          return fallbackResult(posts);
      }

      // Handle both { results: [...] } and direct array [...]
      const results = Array.isArray(parsed) ? parsed : (parsed.results || parsed.data);

      if (!Array.isArray(results)) {
           console.warn("AI response did not contain an array", parsed);
           return fallbackResult(posts);
      }

      // Map back to ensure IDs exist
      return results.map((r: any) => ({
          id: r.id,
          isRageBait: typeof r.isRageBait === 'boolean' ? r.isRageBait : (r.zenScore < threshold),
          zenScore: typeof r.zenScore === 'number' ? r.zenScore : 50,
          reason: r.reason || "AI analysis"
      }));

  } catch (error) {
      console.error("Gemini/OpenRouter Analysis Failed:", error);
      return fallbackResult(posts);
  }
};

const fallbackResult = (posts: RedditPostData[]): AnalysisResult[] => {
    return posts.map(p => ({
        id: p.id,
        isRageBait: false,
        zenScore: 50,
        reason: "Analysis unavailable"
    }));
};
