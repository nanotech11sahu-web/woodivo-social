import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PinoLogger } from 'nestjs-pino';
import { SeoParseException } from '../shared/exceptions/app.exceptions';
import { FilesystemUtil } from '../shared/utils/filesystem.util';
import { SeoDataDto } from './dto/seo-data.dto';
import { SEO_FIELD_ALIASES, SeoData } from './interfaces/seo-fields.interface';

/**
 * Parses the free-form `seo.txt` brief produced by Woodivo into a strictly
 * validated SeoData structure. Format is line-based "Label: value" pairs;
 * unrecognized lines are appended to the currently active field (supports
 * multi-line Description / Additional Instructions blocks).
 */
@Injectable()
export class ParserService {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(ParserService.name);
  }

  async parseSeoFile(filePath: string): Promise<SeoData> {
    const raw = await FilesystemUtil.readTextFile(filePath);
    return this.parseSeoText(raw);
  }

  parseSeoText(raw: string): SeoData {
    const lines = raw.split(/\r?\n/);
    const fieldBuffer = new Map<keyof SeoData, string[]>();

    let currentField: keyof SeoData | null = null;
    const labelLinePattern = /^\s*([A-Za-z][A-Za-z ]{1,40}?)\s*:\s*(.*)$/;

    for (const line of lines) {
      const match = line.match(labelLinePattern);
      if (match) {
        const [, rawLabel, value] = match;
        const normalizedLabel = rawLabel.trim().toLowerCase();
        const field = SEO_FIELD_ALIASES[normalizedLabel];
        if (field) {
          currentField = field;
          fieldBuffer.set(field, [value.trim()]);
          continue;
        }
      }

      if (currentField && line.trim().length > 0) {
        fieldBuffer.get(currentField)?.push(line.trim());
      }
    }

    const getValue = (field: keyof SeoData): string | undefined => {
      const parts = fieldBuffer.get(field);
      if (!parts || parts.length === 0) return undefined;
      return parts.join(' ').trim() || undefined;
    };

    const splitList = (value: string | undefined): string[] =>
      value
        ? value
            .split(',')
            .map((item) => item.trim())
            .filter((item) => item.length > 0)
        : [];

    const candidate: Partial<SeoData> = {
      title: getValue('title'),
      description: getValue('description'),
      keywords: splitList(getValue('keywords')),
      tone: getValue('tone'),
      cta: getValue('cta'),
      website: getValue('website'),
      phone: getValue('phone'),
      platforms: splitList(getValue('platforms')).map((p) => p.toLowerCase()),
      language: getValue('language') ?? 'English',
      additionalInstructions: getValue('additionalInstructions'),
    };

    const dto = plainToInstance(SeoDataDto, candidate);
    const errors = validateSync(dto, { whitelist: true, forbidUnknownValues: false });

    if (errors.length > 0) {
      const messages = errors.flatMap((error) => Object.values(error.constraints ?? {})).join('; ');
      throw new SeoParseException(`Invalid seo.txt content: ${messages}`, { candidate });
    }

    this.logger.debug(
      { title: dto.title, platforms: dto.platforms },
      'Parsed seo.txt successfully',
    );

    return {
      title: dto.title,
      description: dto.description,
      keywords: dto.keywords,
      tone: dto.tone,
      cta: dto.cta,
      website: dto.website,
      phone: dto.phone,
      platforms: dto.platforms,
      language: dto.language,
      additionalInstructions: dto.additionalInstructions,
    };
  }
}
