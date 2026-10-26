/**
 * Bubu AI docs/branch hygiene guard.
 * Checks file paths (including untracked files in local runs) and PR branch names.
 * Run: node scripts/check-repo-hygiene.mjs
 */
import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const ignoredDirs = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', 'coverage',
  '.local-notes', '.ai-scratch', '.codex-tmp', '.turbo', '.cache',
]);
const files = [];
function walk(dir) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (!ignoredDirs.has(ent.name)) walk(join(dir, ent.name));
    } else if (ent.isFile()) {
      files.push(relative(root, join(dir, ent.name)).split(sep).join('/'));
    }
  }
}
walk(root);

const problems = [];
const bannedDirs = /(^|\/)docs\/(?:tasks?|plans?|worklogs?|progress)(\/|$)/i;
const bannedTaskFilename = /(^|\/)(?:(?:a|b)\d{2,3}|task[-_]?\d+|plan[-_]?\d+|step[-_]?\d+|progress|worklog|implementation-plan)(?:[-_][^/]*)?\.md$/i;
const allowedDocRoots = ['product/', 'design/', 'features/', 'architecture/', 'development/'];

for (const path of files) {
  if (bannedDirs.test(path) || bannedTaskFilename.test(path)) {
    problems.push(`${path}: 一次性任务/进度文档禁止提交；请放到 GitHub Issue 或 PR`);
  }
  if (path.startsWith('docs/') && path.endsWith('.md')) {
    const rest = path.slice('docs/'.length);
    if (rest !== 'README.md' && !allowedDocRoots.some(prefix => rest.startsWith(prefix))) {
      problems.push(`${path}: 不在受控文档目录；参考 docs/README.md`);
    }
  }
}
const branch = process.env.GITHUB_HEAD_REF || '';
if (branch && !/^(?:feat|fix|chore|docs|refactor|test)\/\d+-[a-z0-9][a-z0-9-]*$/.test(branch) && !/^(?:dependabot|renovate)\//.test(branch)) {
  problems.push(`当前 PR 分支 ${branch} 不符合 <type>/<issue>-<slug> 规则`);
}
if (problems.length) {
  console.error('Bubu AI 仓库卫生检查失败：\n' + problems.map(s => `- ${s}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Bubu AI 仓库卫生检查通过（检查 ${files.length} 个文件${branch ? `，分支 ${branch}` : ''}）`);
}
