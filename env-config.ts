// Sets config variables based on environment variables
// The Dockerfile will copy this file to config.ts

export const eventName = env('EVENT_NAME', true);

export const readCredentials: { [username: string]: string } = JSON.parse(
  env('READ_CREDENTIALS', true)
);

// Can be local files and/or remote URLs
export const scheduleURLs: string[] = env('SCHEDULE_URLS', true)
  .split(',')
  .map((url) => url.trim());

// How often to reload remote schedule URLs
export const remoteScheduleUpdateInterval: number = parseInt(
  env('REMOTE_SCHEDULE_UPDATE_INTERVAL') ?? (5 * 60 * 1000).toString()
);

function env(name: string, required?: false): string | undefined;
function env(name: string, required?: true): string;
function env(name: string, required = false): string | undefined {
  const value = process.env[name];
  if (required && value == null) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}
