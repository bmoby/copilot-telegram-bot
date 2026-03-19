import cron from 'node-cron';
import { logger } from '../logger.js';

export type CronHandler = () => Promise<void>;

interface ScheduledJob {
  name: string;
  schedule: string;
  handler: CronHandler;
  task: cron.ScheduledTask | null;
}

const jobs: ScheduledJob[] = [];

export function registerJob(name: string, schedule: string, handler: CronHandler): void {
  jobs.push({ name, schedule, handler, task: null });
  logger.info({ name, schedule }, 'Job registered');
}

export function startAllJobs(): void {
  for (const job of jobs) {
    job.task = cron.schedule(job.schedule, async () => {
      logger.info({ job: job.name }, 'Cron job started');
      try {
        await job.handler();
        logger.info({ job: job.name }, 'Cron job completed');
      } catch (error) {
        logger.error({ job: job.name, error }, 'Cron job failed');
      }
    });
    logger.info({ name: job.name, schedule: job.schedule }, 'Cron job started');
  }
}

export function stopAllJobs(): void {
  for (const job of jobs) {
    job.task?.stop();
  }
  logger.info('All cron jobs stopped');
}
