import fs from 'node:fs';
import path from 'node:path';
import env from './env';

const dbPath = path.resolve(process.cwd(), env.DATABASE_URL.replace('file:', ''));
const storagePath = path.resolve(process.cwd(), env.STORAGE_PATH);
const uploadsDir = path.resolve(process.cwd(), env.STORAGE_PATH);

// Ensure data directories exist
function ensureDirectories() {
  const dirs = [path.dirname(dbPath), uploadsDir];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`📁 Created directory: ${dir}`);
    }
  }
}

ensureDirectories();

export {
  dbPath,
  storagePath,
  uploadsDir,
};

// Feature flags
export const config = {
  AUTO_MIGRATE: true,
  SOFT_DELETE: true,
};