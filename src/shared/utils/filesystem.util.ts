import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * Filesystem helpers shared across Scheduler, Media, and Archive modules.
 * All functions are pure/stateless so they can be unit tested without DI.
 */
export class FilesystemUtil {
  static async ensureDir(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }

  static async pathExists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  static async listSubdirectories(dirPath: string): Promise<string[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  }

  static async listFiles(dirPath: string): Promise<string[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  }

  static async getFileSize(filePath: string): Promise<number> {
    const stats = await fs.stat(filePath);
    return stats.size;
  }

  /**
   * Moves a directory tree, falling back to copy+delete when the source and
   * destination are on different filesystems/volumes (fs.rename fails with EXDEV).
   */
  static async moveDirectory(sourcePath: string, destinationPath: string): Promise<void> {
    await this.ensureDir(path.dirname(destinationPath));
    try {
      await fs.rename(sourcePath, destinationPath);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'EXDEV') {
        await fs.cp(sourcePath, destinationPath, { recursive: true });
        await fs.rm(sourcePath, { recursive: true, force: true });
      } else {
        throw error;
      }
    }
  }

  /** Appends a numeric suffix if destination already exists, to avoid overwriting archived data. */
  static async resolveCollisionFreePath(destinationPath: string): Promise<string> {
    if (!(await this.pathExists(destinationPath))) {
      return destinationPath;
    }
    const dir = path.dirname(destinationPath);
    const base = path.basename(destinationPath);
    let attempt = 1;
    let candidate = path.join(dir, `${base}-${attempt}`);
    while (await this.pathExists(candidate)) {
      attempt += 1;
      candidate = path.join(dir, `${base}-${attempt}`);
    }
    return candidate;
  }

  static async readTextFile(filePath: string): Promise<string> {
    return fs.readFile(filePath, 'utf-8');
  }

  static findFileByExtensions(files: string[], extensions: readonly string[]): string | undefined {
    return files.find((file) => extensions.includes(path.extname(file).toLowerCase()));
  }
}
