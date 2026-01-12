import { configure, getConsoleSink, getLogger, type Logger } from "@logtape/logtape";

let configured = false;

export async function setupLogging(options: { verbose?: boolean } = {}): Promise<void> {
  if (configured) return;

  await configure({
    sinks: {
      console: getConsoleSink({
        formatter: (record) => {
          const level = record.level.toUpperCase().padEnd(5);
          const category = record.category.join(".");
          const msg = record.message.map(m =>
            typeof m === "string" ? m : JSON.stringify(m)
          ).join("");
          return `[${level}] [${category}] ${msg}`;
        }
      }),
    },
    loggers: [
      {
        category: ["logtape", "meta"],
        lowestLevel: "warning",
        sinks: ["console"],
      },
      {
        category: ["conteye"],
        lowestLevel: options.verbose ? "debug" : "info",
        sinks: ["console"],
      },
    ],
  });

  configured = true;
}

export function getAppLogger(module: string): Logger {
  return getLogger(["conteye", module]);
}

export { getLogger };
