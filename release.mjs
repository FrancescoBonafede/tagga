#!/usr/bin/env node

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoDir = resolve(scriptDir);

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function git(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: repoDir,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });

  if (result.status !== 0) {
    const detail = result.stderr?.trim();
    throw new Error(detail || `git ${args.join(" ")} failed`);
  }

  return result.stdout?.trim() ?? "";
}

function isSemverTag(value) {
  return /^v?\d+\.\d+\.\d+$/.test(String(value).trim());
}

async function askTagName() {
  const rl = createInterface({ input, output });
  try {
    const tagName = (await rl.question("Tag name (example 0.2.0): ")).trim();

    if (!tagName) {
      fail("tag name is required");
    }

    if (!isSemverTag(tagName)) {
      fail(`"${tagName}" is not a valid SemVer tag. Use x.y.z, for example 0.2.0`);
    }

    return tagName;
  } finally {
    rl.close();
  }
}

function ensureStagedChangesExist() {
  const staged = git(["diff", "--cached", "--name-only"], { capture: true });
  if (!staged) {
    fail("there are no staged changes to commit");
  }
}

function currentBranch() {
  return git(["branch", "--show-current"], { capture: true });
}

function ensureOnBranch(tagName) {
  const branch = currentBranch();
  if (branch) {
    return branch;
  }

  const releaseBranch = `release/${tagName}`;
  const localBranch = git(["branch", "--list", releaseBranch], { capture: true });

  if (localBranch) {
    fail(`branch ${releaseBranch} already exists locally`);
  }

  git(["switch", "--create", releaseBranch]);
  return releaseBranch;
}

function ensureReleaseCanBeCreated(tagName) {
  const existingTag = git(["tag", "--list", tagName], { capture: true });
  if (existingTag) {
    fail(`tag ${tagName} already exists locally`);
  }

  git(["fetch", "--tags", "--prune"]);

  const fetchedTag = git(["tag", "--list", tagName], { capture: true });
  if (fetchedTag) {
    fail(`tag ${tagName} already exists after fetching tags`);
  }
}

try {
  ensureStagedChangesExist();
  const tagName = await askTagName();
  ensureReleaseCanBeCreated(tagName);
  const branch = ensureOnBranch(tagName);
  const message = `Release ${tagName}`;

  git(["commit", "-m", message]);
  git(["tag", "-a", tagName, "-m", message]);
  git(["push", "origin", branch]);
  git(["push", "origin", tagName]);

  console.log(`released ${tagName}`);
} catch (error) {
  fail(error.message);
}
