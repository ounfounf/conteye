import { assertEquals } from "jsr:@std/assert";
import { process } from "~/process/xxhash3.ts";
import { TEST_DATA, type TestDataKey } from "~test/util/data.ts";

function bytesToStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

Deno.test("xxhash3 processor", async (t) => {
  await t.step("hashes empty input", async () => {
    const stream = bytesToStream(TEST_DATA.empty.bytes);
    const result = await process(stream);
    assertEquals(result, TEST_DATA.empty.xxhash3);
  });

  await t.step("hashes single byte", async () => {
    const stream = bytesToStream(TEST_DATA.singleByte.bytes);
    const result = await process(stream);
    assertEquals(result, TEST_DATA.singleByte.xxhash3);
  });

  await t.step("hashes 'hello'", async () => {
    const stream = bytesToStream(TEST_DATA.hello.bytes);
    const result = await process(stream);
    assertEquals(result, TEST_DATA.hello.xxhash3);
  });

  await t.step("hashes 'Hello, World!'", async () => {
    const stream = bytesToStream(TEST_DATA.helloWorld.bytes);
    const result = await process(stream);
    assertEquals(result, TEST_DATA.helloWorld.xxhash3);
  });

  await t.step("hashes 1k zeros", async () => {
    const stream = bytesToStream(TEST_DATA.zeros1k.bytes);
    const result = await process(stream);
    assertEquals(result, TEST_DATA.zeros1k.xxhash3);
  });

  await t.step("hashes byte range pattern", async () => {
    const stream = bytesToStream(TEST_DATA.byteRange.bytes);
    const result = await process(stream);
    assertEquals(result, TEST_DATA.byteRange.xxhash3);
  });

  await t.step("hashes large 1MB input", async () => {
    const stream = bytesToStream(TEST_DATA.largeMB.bytes);
    const result = await process(stream);
    assertEquals(result, TEST_DATA.largeMB.xxhash3);
  });

  await t.step("produces consistent results", async () => {
    const data = TEST_DATA.hello.bytes;
    const results: string[] = [];
    for (let i = 0; i < 5; i++) {
      const stream = bytesToStream(data);
      results.push(await process(stream));
    }
    for (const result of results) {
      assertEquals(result, TEST_DATA.hello.xxhash3);
    }
  });

  await t.step("handles chunked stream", async () => {
    const data = TEST_DATA.helloWorld.bytes;
    const chunkSize = 3;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < data.length; i += chunkSize) {
          controller.enqueue(data.slice(i, i + chunkSize));
        }
        controller.close();
      },
    });
    const result = await process(stream);
    assertEquals(result, TEST_DATA.helloWorld.xxhash3);
  });

  await t.step("returns 16 character hex string", async () => {
    const stream = bytesToStream(TEST_DATA.hello.bytes);
    const result = await process(stream);
    assertEquals(result.length, 16);
    assertEquals(/^[0-9a-f]{16}$/.test(result), true);
  });
});
