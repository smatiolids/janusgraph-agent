import path from "node:path";

const APP_HOME_ENV = "GRAPHX_AI_HOME";

export function getAppHomeDir(): string {
  const configured = process.env[APP_HOME_ENV]?.trim();
  if (configured) {
    return path.resolve(configured);
  }

  return process.cwd();
}

export function resolveAppPath(...segments: string[]): string {
  return path.join(getAppHomeDir(), ...segments);
}
