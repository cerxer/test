// World layout constants shared by the main thread and the workers.
export const CHUNK_SIZE = 16;
export const CHUNK_HEIGHT = 128;
export const SECTION_SIZE = 16;
export const SECTIONS = CHUNK_HEIGHT / SECTION_SIZE;
export const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE;
export const CHUNK_VOLUME = CHUNK_AREA * CHUNK_HEIGHT;
export const SEA_LEVEL = 48;

// Block index inside a chunk: x | z << 4 | y << 8 (y-major so sections are contiguous).
export function blockIndex(x, y, z) {
  return x | (z << 4) | (y << 8);
}

export function chunkKey(cx, cz) {
  return (cx + 32768) * 65536 + (cz + 32768);
}
