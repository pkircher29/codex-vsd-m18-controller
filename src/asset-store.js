import { access, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import sharp from "sharp";
import { MAX_ASSET_BYTES } from "./constants.js";
import { dataDirectory, sha256 } from "./util.js";

const CONTENT_TYPES = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
]);

export class AssetStore {
  constructor({ directory = join(dataDirectory(), "assets") } = {}) {
    this.directory = directory;
  }

  async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
  }

  async save(buffer, contentType) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new TypeError("Image upload is empty");
    }
    if (buffer.length > MAX_ASSET_BYTES) {
      throw new TypeError("Image upload exceeds the 2 MB limit");
    }
    const extension = CONTENT_TYPES.get(contentType?.split(";")[0]?.toLowerCase());
    if (!extension) {
      throw new TypeError("Use a PNG, JPEG, WebP, or GIF image");
    }

    const metadata = await sharp(buffer, { animated: false, limitInputPixels: 40_000_000 }).metadata();
    if (!metadata.width || !metadata.height) {
      throw new TypeError("The uploaded file is not a readable image");
    }

    const id = `${sha256(buffer)}${extension}`;
    const path = join(this.directory, id);
    try {
      await access(path);
    } catch {
      const temporaryPath = `${path}.${process.pid}.tmp`;
      try {
        await writeFile(temporaryPath, buffer, { flag: "wx", mode: 0o600 });
        await rename(temporaryPath, path);
      } finally {
        await unlink(temporaryPath).catch(() => undefined);
      }
    }
    return { id, width: metadata.width, height: metadata.height, contentType };
  }

  async read(id) {
    if (!/^[a-f0-9]{64}\.(?:jpg|png|webp|gif)$/.test(id)) {
      throw new TypeError("Invalid asset identifier");
    }
    const extension = extname(id);
    const contentType = {
      ".jpg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".gif": "image/gif",
    }[extension];
    return { buffer: await readFile(join(this.directory, id)), contentType };
  }

  pathFor(id) {
    if (!/^[a-f0-9]{64}\.(?:jpg|png|webp|gif)$/.test(id)) {
      throw new TypeError("Invalid asset identifier");
    }
    return join(this.directory, id);
  }
}
