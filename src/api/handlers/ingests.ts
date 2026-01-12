import type { Instance } from "~/core/instance.ts";
import type { IngestJob, IngestOptions, IngestJobSummary } from "~/core/ingest_manager.ts";
import type { ProcessorName } from "~/process/index.ts";

export interface IngestsResponse {
  ingests: IngestJobSummary[];
  active: number;
  total: number;
}

export interface IngestResponse extends IngestJob {}

export interface StartIngestRequest {
  root: string;
  processors?: ProcessorName[];
}

export interface StartIngestResponse {
  success: boolean;
  ingest?: IngestJob;
  error?: string;
}

export interface CancelIngestResponse {
  success: boolean;
  error?: string;
}

export function handleGetIngests(instance: Instance): Response {
  const jobs = instance.ingestManager.getJobs();
  const activeJobs = instance.ingestManager.getActiveJobs();

  const summaries: IngestJobSummary[] = jobs.map(job => {
    const progress = job.totalFiles > 0
      ? Math.round((job.processedFiles / job.totalFiles) * 100)
      : 0;

    return {
      id: job.id,
      root: job.root,
      status: job.status,
      progress,
      processedFiles: job.processedFiles,
      totalFiles: job.totalFiles,
    };
  });

  const response: IngestsResponse = {
    ingests: summaries,
    active: activeJobs.length,
    total: jobs.length,
  };

  return Response.json(response);
}

export function handleGetIngest(instance: Instance, ingestId: string): Response {
  const job = instance.ingestManager.getJob(ingestId);

  if (!job) {
    return Response.json({ error: "Ingest job not found" }, { status: 404 });
  }

  return Response.json(job);
}

export async function handleStartIngest(
  instance: Instance,
  request: Request
): Promise<Response> {
  try {
    const body = await request.json() as StartIngestRequest;

    if (!body.root) {
      return Response.json(
        { success: false, error: "root path is required" },
        { status: 400 }
      );
    }

    // Validate root path exists
    try {
      const stat = await Deno.stat(body.root);
      if (!stat.isDirectory) {
        return Response.json(
          { success: false, error: "root must be a directory" },
          { status: 400 }
        );
      }
    } catch {
      return Response.json(
        { success: false, error: "root path does not exist or is not accessible" },
        { status: 400 }
      );
    }

    const options: IngestOptions = {};
    if (body.processors) {
      options.processors = body.processors;
    }

    const job = await instance.ingestManager.start(body.root, options);

    const response: StartIngestResponse = {
      success: true,
      ingest: job,
    };

    return Response.json(response, { status: 201 });
  } catch (error) {
    const response: StartIngestResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
    return Response.json(response, { status: 500 });
  }
}

export function handleCancelIngest(
  instance: Instance,
  ingestId: string
): Response {
  const success = instance.ingestManager.cancel(ingestId);

  if (!success) {
    return Response.json(
      { success: false, error: "Ingest job not found or already completed" },
      { status: 404 }
    );
  }

  const response: CancelIngestResponse = { success: true };
  return Response.json(response);
}

export function handleGetActiveIngests(instance: Instance): Response {
  const activeJobs = instance.ingestManager.getActiveJobs();

  const summaries: IngestJobSummary[] = activeJobs.map(job => {
    const progress = job.totalFiles > 0
      ? Math.round((job.processedFiles / job.totalFiles) * 100)
      : 0;

    return {
      id: job.id,
      root: job.root,
      status: job.status,
      progress,
      processedFiles: job.processedFiles,
      totalFiles: job.totalFiles,
    };
  });

  return Response.json({
    ingests: summaries,
    count: summaries.length,
  });
}
