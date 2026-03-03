#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const packageRoot = path.resolve(__dirname, "..");
const packageJson = require(path.join(packageRoot, "package.json"));
const nextBin = require.resolve("next/dist/bin/next", { paths: [packageRoot] });

function parseDotenvFile(content) {
  const out = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const exportPrefix = line.startsWith("export ") ? "export " : "";
    const withoutExport = exportPrefix ? line.slice(exportPrefix.length) : line;
    const separatorIndex = withoutExport.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = withoutExport.slice(0, separatorIndex).trim();
    let value = withoutExport.slice(separatorIndex + 1).trim();
    if (!key) continue;

    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.split(" #")[0].trim();
    }

    value = value
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t");
    out[key] = value;
  }
  return out;
}

function loadEnvFromDirectory(directory, env) {
  const candidates = [".env", ".env.local"];
  for (const fileName of candidates) {
    const filePath = path.join(directory, fileName);
    if (!fs.existsSync(filePath)) continue;

    try {
      const parsed = parseDotenvFile(fs.readFileSync(filePath, "utf8"));
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof env[key] === "undefined") {
          env[key] = value;
        }
      }
      writeCliLog(env, "info", `dotenv-loaded ${filePath}`);
    } catch (error) {
      writeCliLog(env, "warn", `dotenv-load-failed ${filePath} ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function resolveAppHome(env) {
  if (env.GRAPHX_AI_HOME && String(env.GRAPHX_AI_HOME).trim().length > 0) {
    return path.resolve(String(env.GRAPHX_AI_HOME).trim());
  }
  return process.cwd();
}

function writeCliLog(env, level, message) {
  try {
    const appHome = resolveAppHome(env);
    const logDir = path.join(appHome, "log");
    const logFile = path.join(logDir, "cli.log");
    fs.mkdirSync(logDir, { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      message
    });
    fs.appendFileSync(logFile, `${line}\n`, "utf8");
  } catch {
    // Do not fail startup if log file writing fails.
  }
}

function printHelp() {
  process.stdout.write(
    [
      "GraphX.AI CLI",
      "",
      "Usage:",
      "  graphx-ai [dev] [next-options]",
      "  graphx-ai build [next-options]",
      "  graphx-ai start [next-options]",
      "  graphx-ai help",
      "",
      "Examples:",
      "  npx graphx-ai",
      "  npx graphx-ai --port 3100",
      "  npx graphx-ai start --port 3100",
      "",
      "Data directory:",
      "  GRAPHX_AI_HOME defaults to your current directory."
    ].join("\n")
  );
}

function runNext(args, env, cwd) {
  return new Promise((resolve, reject) => {
    writeCliLog(env, "info", `starting-next ${JSON.stringify(args)}`);
    const child = spawn(process.execPath, [nextBin, ...args], {
      cwd,
      env,
      stdio: "inherit"
    });

    child.on("error", (error) => {
      writeCliLog(env, "error", `next-spawn-error ${error instanceof Error ? error.message : String(error)}`);
      reject(error);
    });

    child.on("exit", (code, signal) => {
      writeCliLog(env, "info", `next-exit code=${String(code)} signal=${String(signal)}`);
      resolve(code ?? 1);
    });
  });
}

function ensureRuntimeWorkspace(env) {
  const isNpxNodeModulesInstall = packageRoot.includes(`${path.sep}node_modules${path.sep}`);
  if (!isNpxNodeModulesInstall) {
    return packageRoot;
  }

  const appHome = resolveAppHome(env);
  const runtimeRoot = path.join(appHome, ".graphx-ai-runtime", String(packageJson.version));
  const readyMarker = path.join(runtimeRoot, ".ready");

  if (!fs.existsSync(readyMarker)) {
    fs.mkdirSync(runtimeRoot, { recursive: true });
    const filesToCopy = [
      "src",
      "bin",
      "next.config.ts",
      "tsconfig.json",
      "next-env.d.ts",
      "package.json",
      ".env.example"
    ];

    for (const item of filesToCopy) {
      const from = path.join(packageRoot, item);
      const to = path.join(runtimeRoot, item);
      if (!fs.existsSync(from)) continue;
      fs.cpSync(from, to, { recursive: true, force: true });
    }

    const sourceNodeModules = path.resolve(packageRoot, "..");
    const targetNodeModules = path.join(runtimeRoot, "node_modules");
    if (!fs.existsSync(targetNodeModules)) {
      fs.symlinkSync(sourceNodeModules, targetNodeModules, "dir");
    }

    fs.writeFileSync(readyMarker, new Date().toISOString(), "utf8");
    writeCliLog(env, "info", `runtime-workspace-created ${runtimeRoot}`);
  }

  return runtimeRoot;
}

function withDefaultHost(args) {
  const hasHostArg = args.includes("--hostname") || args.includes("-H");
  if (hasHostArg) {
    return args;
  }

  return [...args, "--hostname", "127.0.0.1"];
}

async function main() {
  const args = process.argv.slice(2);
  const first = args[0];

  if (first === "help" || first === "-h" || first === "--help") {
    printHelp();
    process.exit(0);
  }

  const command = !first || first.startsWith("-") ? "dev" : first;
  const tailArgs = command === "dev" && first?.startsWith("-") ? args : args.slice(1);

  const env = { ...process.env };
  if (!env.GRAPHX_AI_HOME) {
    env.GRAPHX_AI_HOME = process.cwd();
  }
  loadEnvFromDirectory(process.cwd(), env);
  env.GRAPHX_AI_CLI = "1";
  writeCliLog(env, "info", `cli-start command=${command} args=${JSON.stringify(tailArgs)}`);
  process.stdout.write(`GraphX.AI CLI: command=${command}, home=${resolveAppHome(env)}\n`);
  process.stdout.write(`GraphX.AI CLI log file: ${path.join(resolveAppHome(env), "log", "cli.log")}\n`);
  const executionRoot = ensureRuntimeWorkspace(env);
  const buildIdPath = path.join(executionRoot, ".next", "BUILD_ID");
  writeCliLog(env, "info", `execution-root ${executionRoot}`);

  if (command === "dev") {
    process.exit(await runNext(withDefaultHost(["dev", executionRoot, ...tailArgs]), env, executionRoot));
  }

  if (command === "build") {
    process.exit(await runNext(["build", executionRoot, ...tailArgs], env, executionRoot));
  }

  if (command === "start") {
    if (!fs.existsSync(buildIdPath)) {
      const buildCode = await runNext(["build", executionRoot], env, executionRoot);
      if (buildCode !== 0) {
        process.exit(buildCode);
      }
    }
    process.exit(await runNext(withDefaultHost(["start", executionRoot, ...tailArgs]), env, executionRoot));
  }

  process.stderr.write(`Unknown command: ${command}\nRun "graphx-ai help" for usage.\n`);
  writeCliLog(env, "error", `unknown-command ${command}`);
  process.exit(1);
}

main().catch((error) => {
  const env = { ...process.env, GRAPHX_AI_HOME: process.env.GRAPHX_AI_HOME || process.cwd() };
  writeCliLog(env, "error", `cli-error ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});
