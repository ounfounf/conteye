import { assertEquals } from "jsr:@std/assert";
import { process } from "~/process/md5.ts";

function bytesToStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

// Known MD5 test vectors
const MD5_VECTORS = {
  empty: {
    bytes: new Uint8Array([]),
    md5: "d41d8cd98f00b204e9800998ecf8427e",
  },
  a: {
    bytes: new TextEncoder().encode("a"),
    md5: "0cc175b9c0f1b6a831c399e269772661",
  },
  abc: {
    bytes: new TextEncoder().encode("abc"),
    md5: "900150983cd24fb0d6963f7d28e17f72",
  },
  messageDigest: {
    bytes: new TextEncoder().encode("message digest"),
    md5: "f96b697d7cb7938d525a2f31aaf161d0",
  },
  alphabet: {
    bytes: new TextEncoder().encode("abcdefghijklmnopqrstuvwxyz"),
    md5: "c3fcd3d76192e4007dfb496cca67e13b",
  },
  alphanumeric: {
    bytes: new TextEncoder().encode(
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    ),
    md5: "d174ab98d277d9f5a5611c2c9f419d9f",
  },
  numeric: {
    bytes: new TextEncoder().encode(
      "12345678901234567890123456789012345678901234567890123456789012345678901234567890"
    ),
    md5: "57edf4a22be3c955ac49da2e2107b67a",
  },
} as const;

Deno.test("md5 processor", async (t) => {
  await t.step("hashes empty input", async () => {
    const stream = bytesToStream(MD5_VECTORS.empty.bytes);
    const result = await process(stream);
    assertEquals(result, MD5_VECTORS.empty.md5);
  });

  await t.step("hashes 'a'", async () => {
    const stream = bytesToStream(MD5_VECTORS.a.bytes);
    const result = await process(stream);
    assertEquals(result, MD5_VECTORS.a.md5);
  });

  await t.step("hashes 'abc'", async () => {
    const stream = bytesToStream(MD5_VECTORS.abc.bytes);
    const result = await process(stream);
    assertEquals(result, MD5_VECTORS.abc.md5);
  });

  await t.step("hashes 'message digest'", async () => {
    const stream = bytesToStream(MD5_VECTORS.messageDigest.bytes);
    const result = await process(stream);
    assertEquals(result, MD5_VECTORS.messageDigest.md5);
  });

  await t.step("hashes alphabet", async () => {
    const stream = bytesToStream(MD5_VECTORS.alphabet.bytes);
    const result = await process(stream);
    assertEquals(result, MD5_VECTORS.alphabet.md5);
  });

  await t.step("hashes alphanumeric", async () => {
    const stream = bytesToStream(MD5_VECTORS.alphanumeric.bytes);
    const result = await process(stream);
    assertEquals(result, MD5_VECTORS.alphanumeric.md5);
  });

  await t.step("hashes numeric string", async () => {
    const stream = bytesToStream(MD5_VECTORS.numeric.bytes);
    const result = await process(stream);
    assertEquals(result, MD5_VECTORS.numeric.md5);
  });

  await t.step("produces consistent results", async () => {
    const data = MD5_VECTORS.abc.bytes;
    const results: string[] = [];
    for (let i = 0; i < 5; i++) {
      const stream = bytesToStream(data);
      results.push(await process(stream));
    }
    for (const result of results) {
      assertEquals(result, MD5_VECTORS.abc.md5);
    }
  });

  await t.step("handles chunked stream", async () => {
    const data = MD5_VECTORS.alphabet.bytes;
    const chunkSize = 5;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < data.length; i += chunkSize) {
          controller.enqueue(data.slice(i, i + chunkSize));
        }
        controller.close();
      },
    });
    const result = await process(stream);
    assertEquals(result, MD5_VECTORS.alphabet.md5);
  });

  await t.step("returns 32 character hex string", async () => {
    const stream = bytesToStream(MD5_VECTORS.abc.bytes);
    const result = await process(stream);
    assertEquals(result.length, 32);
    assertEquals(/^[0-9a-f]{32}$/.test(result), true);
  });

  await t.step("hashes binary data", async () => {
    const bytes = new Uint8Array([0x00, 0xff, 0x7f, 0x80, 0x01, 0xfe]);
    const stream = bytesToStream(bytes);
    const result = await process(stream);
    assertEquals(result.length, 32);
    assertEquals(/^[0-9a-f]{32}$/.test(result), true);
  });

  await t.step("hashes large data", async () => {
    const bytes = new Uint8Array(1024 * 100).map((_, i) => i % 256);
    const stream = bytesToStream(bytes);
    const result = await process(stream);
    assertEquals(result.length, 32);
    assertEquals(/^[0-9a-f]{32}$/.test(result), true);
  });
});
