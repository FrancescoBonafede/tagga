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

function gitMaybe(args) {
  const result = spawnSync("git", args, {
    cwd: repoDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return result.status === 0 ? result.stdout.trim() : "";
}

function parseSemverTag(value) {
  const match = String(value).trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    return null;
  }

  return {
    tag: String(value).trim(),
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function currentTagLabel() {
  const exactTag = gitMaybe(["describe", "--tags", "--exact-match", "HEAD"]);
  if (exactTag) {
    return exactTag;
  }

  return gitMaybe(["describe", "--tags", "--abbrev=0"]) || "none";
}

async function askTagName() {
  const rl = createInterface({ input, output });
  try {
    const tagName = (await rl.question(`Tag name (attuale ${currentTagLabel()}): `)).trim();

    if (!tagName) {
      fail("tag name is required");
    }

    const version = parseSemverTag(tagName);
    if (!version) {
      fail(`"${tagName}" is not a valid SemVer tag. Use x.y.z, for example 0.2.0`);
    }

    return version;
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

function stashLocalChanges() {
  git(["stash", "push", "--include-untracked", "-m", "release local changes"]);
}

function restoreLocalChanges() {
  git(["stash", "pop", "--index"]);
}

function majorBranchName(version) {
  return `${version.major}.x`;
}

function ensureOnMajorBranch(version) {
  const majorBranch = majorBranchName(version);
  const branch = currentBranch();
  if (branch === majorBranch) {
    return branch;
  }

  stashLocalChanges();

  try {
    git(["fetch", "origin", "--prune"]);

    const localBranch = git(["branch", "--list", majorBranch], { capture: true });
    if (localBranch) {
      git(["switch", majorBranch]);
    } else {
      const remoteBranch = git(["branch", "--remotes", "--list", `origin/${majorBranch}`], { capture: true });
      if (remoteBranch) {
        git(["switch", "--track", `origin/${majorBranch}`]);
      } else {
        git(["switch", "--create", majorBranch]);
      }
    }

    restoreLocalChanges();
    return majorBranch;
  } catch (error) {
    fail(`could not switch to ${majorBranch}: ${error.message}`);
  }
}

function ensureReleaseCanBeCreated(version) {
  const existingTag = git(["tag", "--list", version.tag], { capture: true });
  if (existingTag) {
    fail(`tag ${version.tag} already exists locally`);
  }

  git(["fetch", "--tags", "--prune"]);

  const fetchedTag = git(["tag", "--list", version.tag], { capture: true });
  if (fetchedTag) {
    fail(`tag ${version.tag} already exists after fetching tags`);
  }
}

try {
  ensureStagedChangesExist();
  const version = await askTagName();
  ensureReleaseCanBeCreated(version);
  const branch = ensureOnMajorBranch(version);
  const message = `Release ${version.tag}`;

  git(["commit", "-m", message]);
  git(["tag", "-a", version.tag, "-m", message]);
  git(["push", "origin", branch]);
  git(["push", "origin", version.tag]);

  console.log(`released ${version.tag} on ${branch}`);
} catch (error) {
  fail(error.message);
}
