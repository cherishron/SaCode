#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const defaultRoot = path.resolve(__dirname, '..');
const allowedStatuses = ['已验收', '部分验收', '未开始', '延后', '不在范围'];
const platformLabels = {
  'linux-x64': 'Linux x64',
  'win32-x64': 'Windows x64',
  'darwin-x64': 'macOS x64',
  'darwin-arm64': 'macOS arm64',
};

function read(root, relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson(root, relativePath) {
  return JSON.parse(read(root, relativePath));
}

function getCargoVersion(cargoToml) {
  const marker = '[workspace.package]';
  const index = cargoToml.indexOf(marker);
  if (index === -1) return null;
  return cargoToml.slice(index + marker.length).match(/\nversion\s*=\s*"([^"]+)"/)?.[1] || null;
}

function getBinaryMap(content) {
  const map = {};
  for (const match of content.matchAll(/'([^']+)':\s*'([^']+)'/g)) {
    map[match[1]] = match[2];
  }
  return map;
}

function collectStatusErrors(status) {
  const errors = [];
  if (status.schema_version !== 1) errors.push('docs/product/status.json: schema_version must be 1');
  if (JSON.stringify(status.allowed_statuses) !== JSON.stringify(allowedStatuses)) {
    errors.push('docs/product/status.json: allowed_statuses is out of sync');
  }
  if (JSON.stringify(status.modes?.preferred) !== JSON.stringify(['plan', 'build', 'auto'])) {
    errors.push('docs/product/status.json: preferred modes must be plan/build/auto');
  }
  if (status.modes?.input_aliases?.yolo !== 'auto') {
    errors.push('docs/product/status.json: yolo must remain an input alias for auto');
  }
  for (const capability of status.capabilities || []) {
    if (!allowedStatuses.includes(capability.status)) {
      errors.push(`docs/product/status.json: capability ${capability.id} uses invalid status ${capability.status}`);
    }
    if (!capability.evidence) {
      errors.push(`docs/product/status.json: capability ${capability.id} is missing evidence`);
    }
  }
  for (const platform of status.platforms || []) {
    if (!allowedStatuses.includes(platform.build_status)) {
      errors.push(`docs/product/status.json: platform ${platform.id} uses invalid build_status`);
    }
    if (!allowedStatuses.includes(platform.support_status)) {
      errors.push(`docs/product/status.json: platform ${platform.id} uses invalid support_status`);
    }
    if (platform.support_status === '部分验收' && !platform.gap) {
      errors.push(`docs/product/status.json: platform ${platform.id} is missing its validation gap`);
    }
  }
  return errors;
}

function collectAcceptanceErrors(requirementsDoc, scenariosDoc) {
  const errors = [];
  const scenarios = new Map((scenariosDoc.scenarios || []).map((scenario) => [scenario.scenario_id, scenario]));
  const requirements = new Set();
  if (requirementsDoc.schema_version !== 1 || scenariosDoc.schema_version !== 1) {
    errors.push('acceptance documents: schema_version must be 1');
  }
  for (const requirement of requirementsDoc.requirements || []) {
    if (requirements.has(requirement.requirement_id)) {
      errors.push(`acceptance requirements: duplicate ${requirement.requirement_id}`);
    }
    requirements.add(requirement.requirement_id);
    if (!['p0', 'p1'].includes(requirement.priority)) {
      errors.push(`acceptance requirements: ${requirement.requirement_id} must be p0 or p1`);
    }
    if (!Array.isArray(requirement.scenario_ids) || requirement.scenario_ids.length === 0) {
      errors.push(`acceptance requirements: ${requirement.requirement_id} has no scenario`);
    }
    for (const scenarioId of requirement.scenario_ids || []) {
      if (!scenarios.has(scenarioId)) {
        errors.push(`acceptance requirements: ${requirement.requirement_id} references missing ${scenarioId}`);
      }
    }
    if (requirement.priority === 'p0' && requirement.requirement_id.includes('SECURITY') && requirement.blocking !== 'security_absolute') {
      errors.push(`acceptance requirements: ${requirement.requirement_id} must be security_absolute`);
    }
  }
  for (const scenario of scenarios.values()) {
    for (const requirementId of scenario.requirement_ids || []) {
      if (!requirements.has(requirementId)) {
        errors.push(`acceptance scenarios: ${scenario.scenario_id} references missing ${requirementId}`);
      }
    }
    if (!scenario.expected || !scenario.evidence_path) {
      errors.push(`acceptance scenarios: ${scenario.scenario_id} is incomplete`);
    }
  }
  const serialized = JSON.stringify({ requirementsDoc, scenariosDoc });
  for (const pattern of [/Bearer\s+[A-Za-z0-9._-]+/i, /sk-[A-Za-z0-9_-]{8,}/i, /api[_-]?key\s*[:=]\s*[^\s",}]+/i]) {
    if (pattern.test(serialized)) errors.push('acceptance documents: sensitive value pattern detected');
  }
  return errors;
}

function collectModeErrors(documents) {
  const errors = [];
  for (const [relativePath, content] of Object.entries(documents)) {
    if (/^#{1,6}\s+YOLO\s+模式/im.test(content)) {
      errors.push(`${relativePath}: YOLO cannot be the preferred mode heading`);
    }
    if (/--mode\s+yolo\b/i.test(content)) {
      errors.push(`${relativePath}: --mode yolo cannot be a primary example`);
    }
    if (/`plan`\s*\/\s*`build`\s*\/\s*`yolo`/i.test(content)) {
      errors.push(`${relativePath}: preferred mode list must use auto`);
    }
  }
  return errors;
}

function validateRepository(root = defaultRoot) {
  const errors = [];
  const cargoVersion = getCargoVersion(read(root, 'Cargo.toml'));
  const npmPackage = readJson(root, 'npm-package/package.json');
  const extensionPackage = readJson(root, 'interfaces/vscode/package.json');
  const compatibility = readJson(root, 'docs/release/compatibility.json');
  const status = readJson(root, 'docs/product/status.json');
  const requirements = readJson(root, '.codeartsdoer/specs/product_next/acceptance/requirements.json');
  const scenarios = readJson(root, '.codeartsdoer/specs/product_next/acceptance/scenarios.json');
  const documents = {
    'docs/product/PRD.md': read(root, 'docs/product/PRD.md'),
    'docs/product/roadmap.md': read(root, 'docs/product/roadmap.md'),
    'docs/guides/getting-started.md': read(root, 'docs/guides/getting-started.md'),
    'npm-package/README.md': read(root, 'npm-package/README.md'),
  };

  if (!cargoVersion) errors.push('Cargo.toml: workspace version is missing');
  if (status.current?.cli !== cargoVersion) errors.push(`docs/product/status.json: CLI ${status.current?.cli || '<missing>'} does not match Cargo ${cargoVersion || '<missing>'}`);
  if (status.current?.extension !== extensionPackage.version) errors.push('docs/product/status.json: extension version is out of sync');
  if (compatibility.current?.cli !== cargoVersion) errors.push('docs/release/compatibility.json: current CLI is out of sync');
  if (compatibility.current?.extension !== extensionPackage.version) errors.push('docs/release/compatibility.json: current extension is out of sync');
  if (npmPackage.version !== cargoVersion) errors.push('npm-package/package.json: version is out of sync');
  if (!documents['docs/product/PRD.md'].includes(`截至 \`${cargoVersion}\``)) errors.push('docs/product/PRD.md: current product baseline is out of sync');
  if (!documents['docs/product/roadmap.md'].includes(`当前版本：${cargoVersion}（VSCode 扩展 ${extensionPackage.version}）`)) errors.push('docs/product/roadmap.md: current version line is out of sync');

  errors.push(...collectStatusErrors(status));
  errors.push(...collectAcceptanceErrors(requirements, scenarios));
  errors.push(...collectModeErrors(documents));

  const expectedMap = Object.fromEntries((status.platforms || []).map((platform) => [platform.id, platform.artifact]));
  const releaseMap = getBinaryMap(read(root, 'npm-package/bin/sacode.js'));
  const installMap = getBinaryMap(read(root, 'npm-package/bin/install.js'));
  if (JSON.stringify(releaseMap) !== JSON.stringify(expectedMap)) errors.push('docs/product/status.json: platform artifacts do not match npm launcher');
  if (JSON.stringify(installMap) !== JSON.stringify(expectedMap)) errors.push('docs/product/status.json: platform artifacts do not match npm installer');
  for (const platform of status.platforms || []) {
    const label = platformLabels[platform.id];
    if (!label) {
      errors.push(`docs/product/status.json: unknown platform ${platform.id}`);
      continue;
    }
    const expectedLine = `| ${label} | ${platform.build_status} | ${platform.support_status} |`;
    if (!documents['docs/guides/getting-started.md'].includes(expectedLine)) {
      errors.push(`docs/guides/getting-started.md: missing platform state for ${platform.id}`);
    }
    if (!documents['npm-package/README.md'].includes(expectedLine)) {
      errors.push(`npm-package/README.md: missing platform state for ${platform.id}`);
    }
  }
  for (const capability of status.capabilities || []) {
    const marker = `| ${capability.id} | ${capability.status} |`;
    if (!documents['docs/product/roadmap.md'].includes(marker)) {
      errors.push(`docs/product/roadmap.md: missing normalized status for ${capability.id}`);
    }
  }
  return errors;
}

if (require.main === module) {
  const errors = validateRepository();
  if (errors.length > 0) {
    console.error('document consistency check failed:');
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  const status = readJson(defaultRoot, 'docs/product/status.json');
  console.log(`document consistency check passed for CLI ${status.current.cli} / extension ${status.current.extension}`);
}

module.exports = {
  collectAcceptanceErrors,
  collectModeErrors,
  collectStatusErrors,
  getCargoVersion,
  validateRepository,
};
