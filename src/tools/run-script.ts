import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { SkillIndex } from "../core/skill-index.js";
import type { AssetResolver } from "../core/asset-resolver.js";
import type { ScriptsConfig, ScriptMeta } from "../types/index.js";
import type { Tracker } from "../analytics/tracker.js";

export interface RunScriptDeps {
  skillIndex: SkillIndex;
  assetResolver: AssetResolver;
  scriptsConfig: ScriptsConfig;
  tracker?: Tracker;
}

export async function handleRunScript(
  skillPath: string,
  file: string,
  args: Record<string, string>,
  cwd: string | undefined,
  deps: RunScriptDeps,
) {
  const { skillIndex, scriptsConfig } = deps;

  // 1. Global kill switch
  if (!scriptsConfig.enabled) {
    return { error: true, message: "Script execution is disabled globally." };
  }

  // 2. Find skill
  const skill = skillIndex.getSkillByPath(skillPath);
  if (!skill) {
    return { error: true, message: `Skill '${skillPath}' not found.` };
  }

  // 3. Path traversal check
  if (file.includes("../") || file.startsWith("/")) {
    return { error: true, message: `Path traversal is not allowed: '${file}'` };
  }

  // 4. Find script declared in frontmatter
  let script: ScriptMeta | undefined;
  for (const s of skill.scripts) {
    if (s.file === file) {
      script = s;
      break;
    }
  }
  if (!script) {
    return {
      error: true,
      message: `Script '${file}' not found in skill '${skillPath}' frontmatter.`,
    };
  }

  // 5. Check execution mode
  if (script.execution !== "server") {
    return {
      error: true,
      message:
        `Script '${file}' has execution: '${script.execution}'. ` +
        `Only scripts with execution: 'server' can be run via run_script. ` +
        `Use get_asset to retrieve the script content and execute it via bash.`,
    };
  }

  // 6. Validate required args
  const missingArgs = script.args
    .filter(a => a.required && !(a.name in args))
    .map(a => `${a.name} (${a.description})`);
  if (missingArgs.length > 0) {
    return {
      error: true,
      message: `Missing required arguments: ${missingArgs.join(", ")}`,
    };
  }

  // 7. Check extension whitelist
  const ext = path.extname(file).toLowerCase();
  if (!scriptsConfig.allowed_extensions.includes(ext)) {
    return {
      error: true,
      message:
        `Extension '${ext}' is not allowed. Allowed: ${scriptsConfig.allowed_extensions.join(", ")}`,
    };
  }

  // 8. Check file exists
  try {
    await stat(script.absolutePath);
  } catch {
    return {
      error: true,
      message: `Script file '${file}' declared but not found on filesystem.`,
    };
  }

  // 9. Determine runner
  const runner = scriptsConfig.runners[ext];
  if (!runner) {
    return {
      error: true,
      message: `No runner configured for extension '${ext}'.`,
    };
  }

  // 10. Build env vars from args
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const arg of script.args) {
    const value = args[arg.name] ?? arg.default;
    if (value !== undefined) {
      const envName = `SKILL_ARG_${arg.name.toUpperCase()}`;
      env[envName] = value;
    }
  }

  // 11. Execute
  const startTime = Date.now();
  try {
    const result = await executeScript(
      runner,
      script.absolutePath,
      env,
      cwd,
      scriptsConfig.timeout_seconds * 1000,
      scriptsConfig.max_output_bytes,
    );

    const duration = Date.now() - startTime;

    deps.tracker?.track("script_executed", {
      skill_path: skillPath,
      file,
      execution_mode: "server",
      success: result.exitCode === 0,
      exit_code: result.exitCode,
      duration_ms: duration,
      args_provided: Object.keys(args),
    });

    return {
      success: result.exitCode === 0,
      exit_code: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      duration_ms: duration,
      script: file,
    };
  } catch (err: any) {
    const duration = Date.now() - startTime;
    return {
      error: true,
      message: err.message ?? "Script execution failed.",
      duration_ms: duration,
      script: file,
    };
  }
}

interface ScriptResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function executeScript(
  runner: string,
  scriptPath: string,
  env: Record<string, string>,
  cwd: string | undefined,
  timeoutMs: number,
  maxOutputBytes: number,
): Promise<ScriptResult> {
  return new Promise((resolve, reject) => {
    const runnerParts = runner.split(/\s+/);
    const command = runnerParts[0];
    const runnerArgs = [...runnerParts.slice(1), scriptPath];

    const proc = spawn(command, runnerArgs, {
      env,
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!proc.killed) proc.kill("SIGKILL");
      }, 5000);
    }, timeoutMs);

    proc.stdout.on("data", (data: Buffer) => {
      if (stdout.length < maxOutputBytes) {
        stdout += data.toString("utf-8").slice(0, maxOutputBytes - stdout.length);
      }
    });

    proc.stderr.on("data", (data: Buffer) => {
      if (stderr.length < maxOutputBytes) {
        stderr += data.toString("utf-8").slice(0, maxOutputBytes - stderr.length);
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (killed) {
        resolve({
          exitCode: code ?? 137,
          stdout,
          stderr: stderr + "\n[skills-mcp] Script killed: timeout exceeded.",
        });
      } else {
        resolve({ exitCode: code ?? 1, stdout, stderr });
      }
    });
  });
}

export function registerRunScript(server: McpServer, deps: RunScriptDeps): void {
  server.tool(
    "run_script",
    "Execute a server-side script associated with a skill. " +
    "Only scripts declared with execution: 'server' in frontmatter. " +
    "Scripts with execution: 'claude' should be retrieved via get_asset " +
    "and executed directly via bash.",
    {
      skill_path: z.string().describe("Skill path (e.g. 'ui/react/auth')"),
      file: z.string().describe("Script file path (e.g. 'scripts/validate-auth-config.ts')"),
      args: z.record(z.string()).describe("Named script arguments"),
      cwd: z.string().optional().describe("Working directory for execution"),
    },
    async ({ skill_path, file, args, cwd }) => {
      const result = await handleRunScript(skill_path, file, args, cwd, deps);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
