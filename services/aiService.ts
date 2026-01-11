
import { RedditPostData, AIConfig, RedditComment, CommentAnalysis, FactCheckResult } from "../types";

export interface AnalysisResult {
  id: string;
  isRageBait: boolean;
  zenScore: number;
  reason: string;
}

const cleanJsonString = (str: string) => {
    // Remove markdown code blocks if present (e.g. ```json ... ```)
    return str.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, '');
};

export const analyzePostsForZen = async (posts: RedditPostData[], config?: AIConfig): Promise<AnalysisResult[]> => {
  if (posts.length === 0) return [];

  // Enhanced payload with contextual signals
  const postsPayload = posts.map(p => {
    // Calculate engagement ratio (high ratio = controversial)
    const engagementRatio = p.score > 0 ? (p.num_comments / p.score).toFixed(2) : '0';
    const isLinkPost = !p.selftext && p.url && !p.url.includes('reddit.com');
    
    return {
      id: p.id,
      t: p.title, // title
      s: p.subreddit, // subreddit
      b: p.selftext ? p.selftext.substring(0, 200) : "", // body snippet
      d: isLinkPost ? p.domain : null, // domain for link posts
      f: p.link_flair_text || null, // flair
      e: engagementRatio, // engagement ratio (comments/score)
      lp: isLinkPost, // is link post
    };
  });

  const threshold = config?.minZenScore ?? 50;
  const customPrompt = config?.customInstructions ? 
    `USER PREF: "${config.customInstructions}".` : "";

  const systemPrompt = `
    Task: Filter Reddit posts for a "Zen" feed.
    Filter out: Rage bait, divisive politics, aggression, anxiety-inducing content.
    ${customPrompt}
    
    CONTEXT SIGNALS TO CONSIDER:
    1. **Subreddit (s)**: Hobby/creative/support subs are usually zen. News/political subs need scrutiny.
    2. **Domain (d)**: For link posts, consider source reputation. Tabloids, hyper-partisan sites, or outrage-focused domains should lower score.
    3. **Flair (f)**: Flairs like "Politics", "Rant", "Drama", "News" are signals. "Wholesome", "OC", "Discussion" are usually fine.
    4. **Engagement Ratio (e)**: High ratio (>0.5) often indicates controversial/divisive content.
    5. **Title (t)**: Clickbait phrases, ALL CAPS, excessive punctuation, accusatory language are red flags.
    6. **Link Post (lp)**: External links to news/political sites need extra scrutiny vs self-posts.
    
    Return JSON object with key "results" (array).
    Each item:
    - id: string
    - zenScore: number (0=Toxic/Rage, 100=Calm/Constructive)
    - reason: string (max 6 words)
    - isRageBait: boolean (true if zenScore < ${threshold})
  `;

  // Use OpenRouter exclusively
  const apiKey = config?.openRouterKey || process.env.API_KEY;

  if (apiKey) {
     return analyzeWithOpenRouter(postsPayload, systemPrompt, apiKey, config?.openRouterModel, threshold);
  } else {
     return fallbackResult(posts);
  }
};

const analyzeWithOpenRouter = async (
    payload: any, 
    systemPrompt: string, 
    apiKey: string, 
    model: string | undefined, 
    threshold: number
): Promise<AnalysisResult[]> => {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": window.location.origin, 
          "X-Title": "ZenReddit"
        },
        body: JSON.stringify({
          model: model || 'meta-llama/llama-3-8b-instruct:free',
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: JSON.stringify(payload) }
          ],
          response_format: { type: "json_object" } 
        })
      });

      if (!response.ok) throw new Error(`API Error: ${response.status}`);

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      
      if (!content) throw new Error("No content");

      let parsed;
      try {
          parsed = JSON.parse(cleanJsonString(content));
      } catch (e) {
          console.warn("Invalid JSON from AI", content);
          return fallbackResult(payload);
      }

      const results = Array.isArray(parsed) ? parsed : (parsed.results || parsed.data);

      if (!Array.isArray(results)) return fallbackResult(payload);

      return results.map((r: any) => ({
          id: r.id,
          isRageBait: typeof r.isRageBait === 'boolean' ? r.isRageBait : (r.zenScore < threshold),
          zenScore: typeof r.zenScore === 'number' ? r.zenScore : 50,
          reason: r.reason || "AI analysis"
      }));

  } catch (error) {
      console.error("OpenRouter Analysis Failed:", error);
      return fallbackResult(payload);
  }
}

const fallbackResult = (posts: any[]): AnalysisResult[] => {
    return posts.map(p => ({
        id: p.id,
        isRageBait: false,
        zenScore: 50,
        reason: "Analysis unavailable"
    }));
};

// --- Comment Analysis ---

export const analyzeCommentsForZen = async (
  comments: RedditComment[], 
  config?: AIConfig,
  context?: { title: string; subreddit: string; selftext?: string }
): Promise<CommentAnalysis[]> => {
  if (comments.length === 0) return [];

  const apiKey = config?.openRouterKey || process.env.API_KEY;
  if (!apiKey) return [];

  const payload = comments.slice(0, 15).map(c => {
    let repliesContext: string[] = [];
    if (c.data.replies && typeof c.data.replies !== 'string' && c.data.replies.data) {
        repliesContext = c.data.replies.data.children
            .filter((child: any) => child.kind === 't1')
            .slice(0, 3) 
            .map((child: any) => `[${child.data.author}]: ${child.data.body.substring(0, 60)}`);
    }
    return {
      id: c.data.id,
      author: c.data.author,
      body: c.data.body.substring(0, 250),
      replies_context: repliesContext
    };
  });

  const contextStr = context ? `
    SUBREDDIT: r/${context.subreddit}
    POST TITLE: "${context.title}"
    ${context.selftext ? `POST CONTEXT: "${context.selftext.substring(0, 200)}..."` : ''}
  ` : "Context: General Reddit Thread";

  const systemPrompt = `
    You are a highly nuanced moderator.
    Analyze the following Reddit comments for TOXICITY and FACT CHECKABILITY.

    ${contextStr}

    Instructions:
    1. **Toxicity**: Flag genuine abuse, hate, or harm. Ignore friendly banter ("lol I hate you") or dramatic slang ("I'm dying").
    2. **Fact Checkability**: Determine if the comment contains verifiable factual claims (statistics, historical events, scientific assertions, specific news).
       - Set "isFactCheckable": true if it contains checkable facts.
       - Set "isFactCheckable": false if it is pure opinion ("I like this"), personal anecdote ("I went there"), or a joke.

    Return JSON: { "results": [{ "id": "string", "isToxic": boolean, "reason": "string", "isFactCheckable": boolean }] }
  `;

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": window.location.origin, 
        "X-Title": "ZenReddit"
        },
        body: JSON.stringify({
        model: config?.openRouterModel || 'meta-llama/llama-3-8b-instruct:free',
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: JSON.stringify(payload) }
        ],
        response_format: { type: "json_object" } 
        })
    });

    if (!response.ok) return [];

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return [];

    const parsed = JSON.parse(cleanJsonString(content));
    const results = Array.isArray(parsed) ? parsed : (parsed.results || parsed.data);
    
    if (Array.isArray(results)) {
        return results.map((r: any) => ({
            id: r.id,
            isToxic: !!r.isToxic,
            reason: r.reason,
            isFactCheckable: !!r.isFactCheckable
        }));
    }
    return [];
  } catch (e) {
      console.warn("OpenRouter Comment analysis error", e);
      return [];
  }
};

// --- Fact Checking ---

export const factCheckComment = async (
    commentBody: string, 
    subreddit: string,
    apiKey?: string,
    model?: string
): Promise<FactCheckResult> => {
    // If no specific key passed, try env
    const key = apiKey || process.env.API_KEY;
    
    if (!key) {
        return {
            verdict: 'Unverified',
            explanation: "API Key required for fact checking.",
            sources: []
        };
    }

    try {
        const systemPrompt = `
            You are a fact checker for Reddit comments.
            Analyze the following comment from r/${subreddit}.
            
            1. Verify the main claims using your training knowledge.
            2. Determine a verdict: "True", "False", "Misleading", "Unverified", or "Opinion".
            3. Provide a concise explanation (max 2 sentences).
            4. If possible, provide real sources/URLs that verify this, in the "sources" array.

            Return JSON:
            {
                "verdict": "string",
                "explanation": "string",
                "sources": [{ "title": "string", "uri": "string" }]
            }
        `;

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${key}`,
                "Content-Type": "application/json",
                "HTTP-Referer": window.location.origin,
                "X-Title": "ZenReddit"
            },
            body: JSON.stringify({
                model: model || 'meta-llama/llama-3-8b-instruct:free',
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: commentBody.substring(0, 500) }
                ],
                response_format: { type: "json_object" }
            })
        });

        if (!response.ok) throw new Error("API Error");

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        
        if (!content) throw new Error("No content");

        const parsed = JSON.parse(cleanJsonString(content));
        
        return {
            verdict: parsed.verdict || 'Unverified',
            explanation: parsed.explanation || "No explanation provided.",
            sources: Array.isArray(parsed.sources) ? parsed.sources : []
        };

    } catch (error) {
        console.error("Fact Check Failed:", error);
        return {
            verdict: 'Unverified',
            explanation: "Could not perform fact check at this time.",
            sources: []
        };
    }
}
