import fs from "node:fs";

const loaded = new Set();

export function loadEnv(filePath = ".env.local") {
  if (loaded.has(filePath) || !fs.existsSync(filePath)) {
    return;
  }

  loaded.add(filePath);

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function envFlag(name) {
  return process.env[name] === "true" || process.argv.includes(`--${name}`);
}

export function requiredEnv(names) {
  return names.filter((name) => !process.env[name]);
}

export function hasAnyEnv(names) {
  return names.some((name) => !!process.env[name]);
}

export function requiredEnvGroups(groups) {
  return groups
    .filter((group) => !hasAnyEnv(group))
    .map((group) => group.join("|"));
}

export function safeUrlContext(value) {
  if (!value) return "unset";
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.hostname}`;
  } catch {
    return "set";
  }
}

export function printCheck(name, ok, detail = "") {
  const status = ok ? "PASS" : "FAIL";
  console.log(`${status} ${name}${detail ? ` - ${detail}` : ""}`);
}

export function printSkip(name, detail = "") {
  console.log(`SKIP ${name}${detail ? ` - ${detail}` : ""}`);
}

export function finish(failures) {
  if (failures.length) {
    console.error(`FAIL ${failures.length} check(s) failed.`);
    process.exitCode = 1;
    return;
  }

  console.log("PASS all checks completed.");
}

export function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}
