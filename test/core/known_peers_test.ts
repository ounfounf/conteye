import { assertEquals, assertExists } from "jsr:@std/assert";
import { DuckDBInstance } from "npm:@duckdb/node-api";
import { DB_SCHEMA } from "~/core/instance.ts";

async function setupTestDb() {
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  await connection.run(DB_SCHEMA);
  return { instance, connection };
}

Deno.test({ name: "Known Peers Database Operations", sanitizeOps: false, sanitizeResources: false }, async (t) => {
  await t.step("can insert a known peer with prepared statement", async () => {
    const { instance, connection } = await setupTestDb();
    try {
      const wsUrl = "ws://localhost:8000/ws/workers";
      const name = "Test Peer";
      const autoConnect = 1;
      const createdAt = Date.now();

      const stmt = await connection.prepare(`
        INSERT INTO known_peers (wsUrl, name, autoConnect, createdAt)
        VALUES ($wsUrl, $name, $autoConnect, $createdAt)
      `);
      stmt.bind({
        wsUrl,
        name,
        autoConnect,
        createdAt: BigInt(createdAt),
      });
      await stmt.run();

      // Verify the insert
      const result = await connection.run("SELECT * FROM known_peers");
      const rows = (await result.getRowObjects()) as Array<{
        wsUrl: string;
        name: string | null;
        autoConnect: number;
        createdAt: bigint;
        lastConnectedAt: bigint | null;
      }>;

      assertEquals(rows.length, 1);
      assertEquals(rows[0].wsUrl, wsUrl);
      assertEquals(rows[0].name, name);
      assertEquals(rows[0].autoConnect, autoConnect);
      assertEquals(rows[0].createdAt, BigInt(createdAt));
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });

  await t.step("can insert a known peer with null name", async () => {
    const { instance, connection } = await setupTestDb();
    try {
      const wsUrl = "ws://localhost:8000/ws/workers";
      const createdAt = Date.now();

      const stmt = await connection.prepare(`
        INSERT INTO known_peers (wsUrl, name, autoConnect, createdAt)
        VALUES ($wsUrl, $name, $autoConnect, $createdAt)
      `);
      stmt.bind({
        wsUrl,
        name: null,
        autoConnect: 1,
        createdAt: BigInt(createdAt),
      });
      await stmt.run();

      // Verify the insert
      const result = await connection.run("SELECT * FROM known_peers");
      const rows = (await result.getRowObjects()) as Array<{
        wsUrl: string;
        name: string | null;
        autoConnect: number;
        createdAt: bigint;
        lastConnectedAt: bigint | null;
      }>;

      assertEquals(rows.length, 1);
      assertEquals(rows[0].wsUrl, wsUrl);
      assertEquals(rows[0].name, null);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });

  await t.step("can upsert a known peer (ON CONFLICT)", async () => {
    const { instance, connection } = await setupTestDb();
    try {
      const wsUrl = "ws://localhost:8000/ws/workers";
      const originalName = "Original Name";
      const updatedName = "Updated Name";
      const createdAt = Date.now();

      // Insert first
      const insertStmt = await connection.prepare(`
        INSERT INTO known_peers (wsUrl, name, autoConnect, createdAt)
        VALUES ($wsUrl, $name, $autoConnect, $createdAt)
      `);
      insertStmt.bind({
        wsUrl,
        name: originalName,
        autoConnect: 1,
        createdAt: BigInt(createdAt),
      });
      await insertStmt.run();

      // Upsert with new name
      const upsertStmt = await connection.prepare(`
        INSERT INTO known_peers (wsUrl, name, autoConnect, createdAt)
        VALUES ($wsUrl, $name, $autoConnect, $createdAt)
        ON CONFLICT(wsUrl) DO UPDATE SET
          name = COALESCE(excluded.name, known_peers.name),
          autoConnect = excluded.autoConnect
      `);
      upsertStmt.bind({
        wsUrl,
        name: updatedName,
        autoConnect: 0, // Changed to false
        createdAt: BigInt(Date.now()),
      });
      await upsertStmt.run();

      // Verify the upsert
      const result = await connection.run("SELECT * FROM known_peers");
      const rows = (await result.getRowObjects()) as Array<{
        wsUrl: string;
        name: string | null;
        autoConnect: number;
        createdAt: bigint;
        lastConnectedAt: bigint | null;
      }>;

      assertEquals(rows.length, 1);
      assertEquals(rows[0].wsUrl, wsUrl);
      assertEquals(rows[0].name, updatedName);
      assertEquals(rows[0].autoConnect, 0);
      // createdAt should remain the original
      assertEquals(rows[0].createdAt, BigInt(createdAt));
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });

  await t.step("can update lastConnectedAt", async () => {
    const { instance, connection } = await setupTestDb();
    try {
      const wsUrl = "ws://localhost:8000/ws/workers";
      const createdAt = Date.now();

      // Insert first
      const insertStmt = await connection.prepare(`
        INSERT INTO known_peers (wsUrl, name, autoConnect, createdAt)
        VALUES ($wsUrl, $name, $autoConnect, $createdAt)
      `);
      insertStmt.bind({
        wsUrl,
        name: null,
        autoConnect: 1,
        createdAt: BigInt(createdAt),
      });
      await insertStmt.run();

      // Update lastConnectedAt
      const lastConnectedAt = Date.now() + 1000;
      const updateStmt = await connection.prepare(
        "UPDATE known_peers SET lastConnectedAt = $lastConnectedAt WHERE wsUrl = $wsUrl"
      );
      updateStmt.bind({
        lastConnectedAt: BigInt(lastConnectedAt),
        wsUrl,
      });
      await updateStmt.run();

      // Verify the update
      const result = await connection.run("SELECT * FROM known_peers");
      const rows = (await result.getRowObjects()) as Array<{
        wsUrl: string;
        name: string | null;
        autoConnect: number;
        createdAt: bigint;
        lastConnectedAt: bigint | null;
      }>;

      assertEquals(rows.length, 1);
      assertEquals(rows[0].lastConnectedAt, BigInt(lastConnectedAt));
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });

  await t.step("can delete a known peer", async () => {
    const { instance, connection } = await setupTestDb();
    try {
      const wsUrl = "ws://localhost:8000/ws/workers";
      const createdAt = Date.now();

      // Insert first
      const insertStmt = await connection.prepare(`
        INSERT INTO known_peers (wsUrl, name, autoConnect, createdAt)
        VALUES ($wsUrl, $name, $autoConnect, $createdAt)
      `);
      insertStmt.bind({
        wsUrl,
        name: null,
        autoConnect: 1,
        createdAt: BigInt(createdAt),
      });
      await insertStmt.run();

      // Delete
      const deleteStmt = await connection.prepare("DELETE FROM known_peers WHERE wsUrl = $wsUrl");
      deleteStmt.bind({ wsUrl });
      const deleteResult = await deleteStmt.run();

      // Check rowsChanged
      assertExists(deleteResult.rowsChanged);
      assertEquals(deleteResult.rowsChanged, 1);

      // Verify deletion
      const result = await connection.run("SELECT * FROM known_peers");
      const rows = (await result.getRowObjects()) as Array<Record<string, unknown>>;
      assertEquals(rows.length, 0);
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });

  await t.step("can select all known peers ordered by createdAt", async () => {
    const { instance, connection } = await setupTestDb();
    try {
      const peers = [
        { wsUrl: "ws://peer1:8000/ws/workers", createdAt: 1000 },
        { wsUrl: "ws://peer2:8000/ws/workers", createdAt: 2000 },
        { wsUrl: "ws://peer3:8000/ws/workers", createdAt: 1500 },
      ];

      // Insert all
      for (const peer of peers) {
        const stmt = await connection.prepare(`
          INSERT INTO known_peers (wsUrl, name, autoConnect, createdAt)
          VALUES ($wsUrl, $name, $autoConnect, $createdAt)
        `);
        stmt.bind({
          wsUrl: peer.wsUrl,
          name: null,
          autoConnect: 1,
          createdAt: BigInt(peer.createdAt),
        });
        await stmt.run();
      }

      // Select ordered
      const result = await connection.run("SELECT * FROM known_peers ORDER BY createdAt ASC");
      const rows = (await result.getRowObjects()) as Array<{ wsUrl: string }>;

      assertEquals(rows.length, 3);
      assertEquals(rows[0].wsUrl, "ws://peer1:8000/ws/workers");
      assertEquals(rows[1].wsUrl, "ws://peer3:8000/ws/workers");
      assertEquals(rows[2].wsUrl, "ws://peer2:8000/ws/workers");
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  });
});
