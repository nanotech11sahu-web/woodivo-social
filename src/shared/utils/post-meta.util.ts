import * as path from 'path';
import { promises as fs } from 'fs';
import { POST_META_FILENAME } from '../constants/queue.constants';
import { PostMeta, PostSourceType } from '../interfaces/post-meta.interface';
import { FilesystemUtil } from './filesystem.util';

const VALID_SOURCE_TYPES: readonly PostSourceType[] = ['PRODUCT', 'BLOG', 'OTHER'];

export class PostMetaUtil {
  static async write(folderPath: string, meta: PostMeta): Promise<void> {
    await fs.writeFile(
      path.join(folderPath, POST_META_FILENAME),
      JSON.stringify(meta, null, 2),
      'utf-8',
    );
  }

  /** Defaults to sourceType OTHER when the file is missing or unreadable. */
  static async read(folderPath: string): Promise<PostMeta> {
    const metaPath = path.join(folderPath, POST_META_FILENAME);
    if (!(await FilesystemUtil.pathExists(metaPath))) {
      return { sourceType: 'OTHER' };
    }

    try {
      const raw = await fs.readFile(metaPath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PostMeta>;
      const sourceType = VALID_SOURCE_TYPES.includes(parsed.sourceType as PostSourceType)
        ? (parsed.sourceType as PostSourceType)
        : 'OTHER';
      return {
        sourceType,
        sourceId: parsed.sourceId,
        sourceTitle: parsed.sourceTitle,
        urgent: parsed.urgent === true,
      };
    } catch {
      return { sourceType: 'OTHER' };
    }
  }
}
