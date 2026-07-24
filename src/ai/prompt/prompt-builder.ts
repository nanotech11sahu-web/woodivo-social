import { Injectable } from '@nestjs/common';
import { SeoData } from '../../parser/interfaces/seo-fields.interface';

/**
 * Builds a professionally structured prompt from parsed SeoData. The AI
 * provider never sees the raw seo.txt - only this deterministic, well-formed
 * instruction, which keeps output quality independent of how Woodivo authors
 * write their briefs.
 */
@Injectable()
export class PromptBuilder {
  buildSocialContentPrompt(seo: SeoData): string {
    const platforms = seo.platforms.length > 0 ? seo.platforms.join(', ') : 'Facebook, Instagram';

    return `You are a senior social media copywriter and SEO strategist working for a professional marketing agency.
Write publish-ready social media content for the following business post. Follow every instruction exactly.

BUSINESS BRIEF
--------------
Title: ${seo.title}
Description: ${seo.description}
Keywords: ${seo.keywords.join(', ')}
Tone of voice: ${seo.tone ?? 'professional and engaging'}
Call to action: ${seo.cta ?? 'Encourage the reader to get in touch'}
Website: ${seo.website ?? 'N/A'}
Phone: ${seo.phone ?? 'N/A'}
Target platforms: ${platforms}
Language: ${seo.language}
Additional instructions: ${seo.additionalInstructions ?? 'None'}

TASK
----
Produce social media content strictly in the language "${seo.language}" and return ONLY a single valid JSON object
(no markdown fences, no commentary, no leading/trailing text) with EXACTLY these keys:

{
  "facebookCaption": string,   // Engaging Facebook caption, 2-4 short paragraphs, includes the call to action naturally, no hashtags inline
  "instagramCaption": string,  // Engaging Instagram caption, punchy and visual, emoji allowed sparingly, no hashtags inline
  "hashtags": string[],        // 8-15 relevant hashtags (each starting with #, no spaces), mixing broad and niche tags derived from the keywords
  "firstComment": string,      // A short first-comment text to post immediately after publishing (e.g. extra hashtags or a direct link/CTA)
  "altText": string,           // Accessibility alt text describing the media in under 150 characters
  "seoTitle": string           // SEO-optimized title under 70 characters incorporating the primary keyword
}

RULES
-----
- Output must be valid JSON parseable by JSON.parse with no trailing commas and all keys present.
- Do not wrap the JSON in markdown code fences.
- Do not include any explanation before or after the JSON.
- Respect the requested tone and language strictly.
- Never fabricate claims not implied by the business brief (no fake awards, prices, or guarantees).
- Keep captions free of placeholder text such as "[insert here]".
- If Website is not "N/A", both facebookCaption and instagramCaption MUST include the literal
  website text written out naturally (e.g. "Visit ${seo.website ?? 'the website'}" or
  "Shop now at ${seo.website ?? 'the website'}") - never just "link in bio" with no actual URL text.`;
  }
}
