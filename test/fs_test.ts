import {
  assertEquals,
  assertExists,
  assertRejects,
  assertGreater,
} from "jsr:@std/assert";
import { expect } from "jsr:@std/expect";
import { apply, type FsRequest } from "~/fs.ts";

let tempDir: string;

Deno.test("fs module", async (t) => {
  // Setup temp directory
  tempDir = await Deno.makeTempDir({ prefix: "fs_test_" });

  // Create test files and directories
  const testFile = `${tempDir}/test.txt`;
  const testContent = "Hello, World!";
  await Deno.writeTextFile(testFile, testContent);

  const subDir = `${tempDir}/subdir`;
  await Deno.mkdir(subDir);

  const subFile = `${subDir}/nested.txt`;
  await Deno.writeTextFile(subFile, "nested content");

  // ========================================================================
  // stat action tests
  // ========================================================================

  await t.step("stat returns file info for file", async () => {
    const request: FsRequest = { action: "stat", path: testFile };
    const result = await apply(request);

    assertExists(result);
    assertEquals(result.isFile, true);
    assertEquals(result.isDirectory, false);
    assertEquals(result.size, testContent.length);
  });

  await t.step("stat returns directory info for directory", async () => {
    const request: FsRequest = { action: "stat", path: subDir };
    const result = await apply(request);

    assertExists(result);
    assertEquals(result.isFile, false);
    assertEquals(result.isDirectory, true);
  });

  await t.step("stat returns timestamps", async () => {
    const request: FsRequest = { action: "stat", path: testFile };
    const result = await apply(request);

    assertExists(result.mtime);
    assertExists(result.atime);
    // birthtime may be null on some systems
  });

  await t.step("stat throws for non-existent path", async () => {
    const request: FsRequest = { action: "stat", path: `${tempDir}/nonexistent` };
    await assertRejects(
      async () => await apply(request),
      Deno.errors.NotFound
    );
  });

  // ========================================================================
  // readDir action tests
  // ========================================================================

  await t.step("readDir returns directory entries", async () => {
    const request: FsRequest = { action: "readDir", path: tempDir };
    const result = await apply(request);

    assertExists(result);
    assertEquals(Array.isArray(result), true);
    assertGreater(result.length, 0);
  });

  await t.step("readDir returns correct entry names", async () => {
    const request: FsRequest = { action: "readDir", path: tempDir };
    const result = await apply(request);

    const names = result.map((e: Deno.DirEntry) => e.name);
    expect(names).toContain("test.txt");
    expect(names).toContain("subdir");
  });

  await t.step("readDir entries have isFile and isDirectory", async () => {
    const request: FsRequest = { action: "readDir", path: tempDir };
    const result = await apply(request);

    const fileEntry = result.find((e: Deno.DirEntry) => e.name === "test.txt");
    const dirEntry = result.find((e: Deno.DirEntry) => e.name === "subdir");

    assertExists(fileEntry);
    assertExists(dirEntry);
    assertEquals(fileEntry.isFile, true);
    assertEquals(fileEntry.isDirectory, false);
    assertEquals(dirEntry.isFile, false);
    assertEquals(dirEntry.isDirectory, true);
  });

  await t.step("readDir returns empty array for empty directory", async () => {
    const emptyDir = `${tempDir}/empty`;
    await Deno.mkdir(emptyDir);

    const request: FsRequest = { action: "readDir", path: emptyDir };
    const result = await apply(request);

    assertEquals(Array.isArray(result), true);
    assertEquals(result.length, 0);
  });

  await t.step("readDir throws for non-existent path", async () => {
    const request: FsRequest = { action: "readDir", path: `${tempDir}/nonexistent` };
    await assertRejects(
      async () => await apply(request),
      Deno.errors.NotFound
    );
  });

  await t.step("readDir throws for file path", async () => {
    const request: FsRequest = { action: "readDir", path: testFile };
    await assertRejects(async () => await apply(request));
  });

  // ========================================================================
  // realPath action tests
  // ========================================================================

  await t.step("realPath returns absolute path", async () => {
    const request: FsRequest = { action: "realPath", path: testFile };
    const result = await apply(request);

    assertExists(result);
    assertEquals(typeof result, "string");
    // Should contain the file name
    expect(result).toContain("test.txt");
  });

  await t.step("realPath resolves to same location", async () => {
    const request: FsRequest = { action: "realPath", path: testFile };
    const result = await apply(request);

    // Stat both paths should give same result
    const statOriginal = await Deno.stat(testFile);
    const statResolved = await Deno.stat(result);

    assertEquals(statOriginal.size, statResolved.size);
  });

  await t.step("realPath works with directories", async () => {
    const request: FsRequest = { action: "realPath", path: subDir };
    const result = await apply(request);

    assertExists(result);
    expect(result).toContain("subdir");
  });

  await t.step("realPath throws for non-existent path", async () => {
    const request: FsRequest = { action: "realPath", path: `${tempDir}/nonexistent` };
    await assertRejects(
      async () => await apply(request),
      Deno.errors.NotFound
    );
  });

  // ========================================================================
  // Error handling tests
  // ========================================================================

  await t.step("throws for unknown action", async () => {
    const request = { action: "unknown", path: testFile } as any as FsRequest;
    await assertRejects(
      async () => await apply(request),
      Error,
      "Unknown action"
    );
  });

  // ========================================================================
  // Edge cases
  // ========================================================================

  await t.step("stat works with special characters in filename", async () => {
    const specialFile = `${tempDir}/file with spaces.txt`;
    await Deno.writeTextFile(specialFile, "content");

    const request: FsRequest = { action: "stat", path: specialFile };
    const result = await apply(request);

    assertExists(result);
    assertEquals(result.isFile, true);
  });

  await t.step("readDir handles many entries", async () => {
    const manyDir = `${tempDir}/many`;
    await Deno.mkdir(manyDir);

    for (let i = 0; i < 50; i++) {
      await Deno.writeTextFile(`${manyDir}/file${i}.txt`, `content ${i}`);
    }

    const request: FsRequest = { action: "readDir", path: manyDir };
    const result = await apply(request);

    assertEquals(result.length, 50);
  });

  await t.step("stat returns correct size for empty file", async () => {
    const emptyFile = `${tempDir}/empty.txt`;
    await Deno.writeTextFile(emptyFile, "");

    const request: FsRequest = { action: "stat", path: emptyFile };
    const result = await apply(request);

    assertEquals(result.size, 0);
  });

  await t.step("stat returns correct size for large file", async () => {
    const largeFile = `${tempDir}/large.txt`;
    const largeContent = "x".repeat(10000);
    await Deno.writeTextFile(largeFile, largeContent);

    const request: FsRequest = { action: "stat", path: largeFile };
    const result = await apply(request);

    assertEquals(result.size, 10000);
  });

  // ========================================================================
  // Cleanup
  // ========================================================================

  await Deno.remove(tempDir, { recursive: true });
});
