import { createXXHash3 } from "hash-wasm";

const hasher = await createXXHash3();

async function computeHash(data: Uint8Array): Promise<string> {
  hasher.init();
  hasher.update(data);
  return hasher.digest();
}

// Raw test data bytes
const RAW_DATA = {
  empty: new Uint8Array([]),
  singleByte: new Uint8Array([0x61]),
  hello: new TextEncoder().encode("hello"),
  helloWorld: new TextEncoder().encode("Hello, World!"),
  zeros1k: new Uint8Array(1000),
  byteRange: new Uint8Array(1024).map((_, i) => i % 256),
  largeMB: new Uint8Array(1024 * 1024).map((_, i) => (i * 17 + 31) % 256),
} as const;

export type TestDataKey = keyof typeof RAW_DATA;

export type TestDatum = {
  bytes: Uint8Array;
  xxhash3: string;
};

// Precompute all xxhash3 values at module load time
export const TEST_DATA: Record<TestDataKey, TestDatum> = {
  empty: {
    bytes: RAW_DATA.empty,
    xxhash3: await computeHash(RAW_DATA.empty),
  },
  singleByte: {
    bytes: RAW_DATA.singleByte,
    xxhash3: await computeHash(RAW_DATA.singleByte),
  },
  hello: {
    bytes: RAW_DATA.hello,
    xxhash3: await computeHash(RAW_DATA.hello),
  },
  helloWorld: {
    bytes: RAW_DATA.helloWorld,
    xxhash3: await computeHash(RAW_DATA.helloWorld),
  },
  zeros1k: {
    bytes: RAW_DATA.zeros1k,
    xxhash3: await computeHash(RAW_DATA.zeros1k),
  },
  byteRange: {
    bytes: RAW_DATA.byteRange,
    xxhash3: await computeHash(RAW_DATA.byteRange),
  },
  largeMB: {
    bytes: RAW_DATA.largeMB,
    xxhash3: await computeHash(RAW_DATA.largeMB),
  },
};
