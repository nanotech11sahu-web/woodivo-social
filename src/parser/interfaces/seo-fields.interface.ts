export interface SeoData {
  title: string;
  description: string;
  keywords: string[];
  tone?: string;
  cta?: string;
  website?: string;
  phone?: string;
  platforms: string[];
  language: string;
  additionalInstructions?: string;
}

/** Maps the lowercased, normalized label found in seo.txt to a SeoData field. */
export const SEO_FIELD_ALIASES: Record<string, keyof SeoData> = {
  title: 'title',
  description: 'description',
  keywords: 'keywords',
  tone: 'tone',
  cta: 'cta',
  'call to action': 'cta',
  website: 'website',
  url: 'website',
  phone: 'phone',
  'phone number': 'phone',
  platforms: 'platforms',
  platform: 'platforms',
  language: 'language',
  'additional instructions': 'additionalInstructions',
  instructions: 'additionalInstructions',
  notes: 'additionalInstructions',
};
