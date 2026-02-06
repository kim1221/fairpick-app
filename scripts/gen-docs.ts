#!/usr/bin/env node

/**
 * Documentation Generator Script
 *
 * Automatically generates and updates documentation files by:
 * - Scanning repository structure
 * - Reading package.json scripts
 * - Extracting cron schedules from scheduler.ts
 * - Updating documents within AUTO-GENERATED markers
 *
 * Usage:
 *   node scripts/gen-docs.ts --dry    # Preview changes
 *   node scripts/gen-docs.ts --write  # Update files
 */

const fs = require('fs');
const path = require('path');

// ============================================================
// Configuration
// ============================================================

const REPO_ROOT = path.resolve(process.cwd());
const BACKEND_DIR = path.join(REPO_ROOT, 'backend');
const DOCS_DIR = path.join(REPO_ROOT, 'docs');

const DOCUMENT_PATHS = {
  REPO_FILE_MAP: path.join(REPO_ROOT, 'REPO_FILE_MAP.md'),
  ARCHITECTURE: path.join(REPO_ROOT, 'ARCHITECTURE.md'),
  CHANGELOG: path.join(REPO_ROOT, 'CHANGELOG.md'),
  BACKEND_FILE_MAP: path.join(BACKEND_DIR, 'FILE_MAP.md'),
};

const AUTO_GEN_START = '<!-- AUTO-GENERATED:START -->';
const AUTO_GEN_END = '<!-- AUTO-GENERATED:END -->';

// ============================================================
// Utility Functions
// ============================================================

function log(message, prefix = '[docs:sync]') {
  console.log(`${prefix} ${message}`);
}

function getCurrentDateKST() {
  const now = new Date();
  const kstOffset = 9 * 60; // KST is UTC+9
  const kstTime = new Date(now.getTime() + kstOffset * 60 * 1000);
  return kstTime.toISOString().split('T')[0];
}

function readJsonFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    log(`Warning: Could not read ${filePath}: ${error.message}`, '[docs:sync]');
    return null;
  }
}

function countLines(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.split('\n').length;
  } catch {
    return 0;
  }
}

// ============================================================
// Repository Structure Scanner
// ============================================================

function scanRepoStructure() {
  log('Scanning repository structure...');

  const scanDirectory = (dirPath, maxDepth = 1, currentDepth = 0) => {
    if (!fs.existsSync(dirPath)) {
      return [];
    }

    const items = [];

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        // Skip node_modules, .git, dist, etc.
        if (['.git', 'node_modules', 'dist', '.swc', '.granite'].includes(entry.name)) {
          continue;
        }

        const fullPath = path.join(dirPath, entry.name);
        const relativePath = path.relative(REPO_ROOT, fullPath);

        if (entry.isDirectory()) {
          items.push(`${relativePath}/`);

          // Recursively scan subdirectories if within depth limit
          if (currentDepth < maxDepth) {
            const subItems = scanDirectory(fullPath, maxDepth, currentDepth + 1);
            items.push(...subItems);
          }
        } else {
          items.push(relativePath);
        }
      }
    } catch (error) {
      log(`Warning: Could not scan ${dirPath}: ${error.message}`, '[docs:sync]');
    }

    return items.sort();
  };

  return {
    root: scanDirectory(REPO_ROOT, 0),
    backend: scanDirectory(BACKEND_DIR, 0),
    backendSrc: scanDirectory(path.join(BACKEND_DIR, 'src'), 1),
    backendAdminWeb: scanDirectory(path.join(BACKEND_DIR, 'admin-web'), 1),
    pages: scanDirectory(path.join(REPO_ROOT, 'pages'), 1),
    src: scanDirectory(path.join(REPO_ROOT, 'src'), 1),
    docs: scanDirectory(DOCS_DIR, 1),
    migrations: scanDirectory(path.join(BACKEND_DIR, 'migrations'), 0),
  };
}

// ============================================================
// Package.json Scripts Reader
// ============================================================

function readPackageScripts(packagePath) {
  const pkg = readJsonFile(packagePath);
  if (!pkg || !pkg.scripts) {
    return null;
  }
  return pkg.scripts;
}

// ============================================================
// Cron Schedule Extractor
// ============================================================

function extractCronSchedules(schedulerPath) {
  log('Extracting cron schedules from scheduler.ts...');

  if (!fs.existsSync(schedulerPath)) {
    log(`Warning: scheduler.ts not found at ${schedulerPath}`, '[docs:sync]');
    return [];
  }

  const content = fs.readFileSync(schedulerPath, 'utf-8');
  const schedules = [];

  // Split into lines for easier analysis
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if this line contains cron.schedule
    const cronMatch = line.match(/cron\.schedule\(['"]([^'"]+)['"]/);

    if (cronMatch) {
      const cronExpression = cronMatch[1];
      const isCommented = line.trim().startsWith('//');

      // Look ahead for the job name in runJobSafely
      let jobName = 'unknown';
      let modulePath = '';

      for (let j = i; j < Math.min(i + 10, lines.length); j++) {
        const nextLine = lines[j];

        // Match runJobSafely('job-name', ...)
        const jobMatch = nextLine.match(/runJobSafely\(['"]([^'"]+)['"]/);
        if (jobMatch) {
          jobName = jobMatch[1];
        }

        // Match function calls like runGeoRefreshPipeline, runCleanupJob, etc.
        const funcMatch = nextLine.match(/await\s+(\w+)\(/);
        if (funcMatch && !modulePath) {
          modulePath = funcMatch[1];
        }

        // Break if we hit the next cron.schedule
        if (j > i && nextLine.includes('cron.schedule')) {
          break;
        }
      }

      // Look for timezone in options
      let timezone = 'Asia/Seoul'; // Default
      for (let j = i; j < Math.min(i + 5, lines.length); j++) {
        const tzMatch = lines[j].match(/timezone:\s*['"]([^'"]+)['"]/);
        if (tzMatch) {
          timezone = tzMatch[1];
          break;
        }
      }

      // Parse time description from cron expression
      const time = parseCronTime(cronExpression);

      schedules.push({
        time,
        cron: cronExpression,
        jobName,
        module: modulePath,
        timezone,
        commented: isCommented,
      });
    }
  }

  log(`✓ Extracted ${schedules.length} cron schedules`, '[docs:sync]');
  return schedules;
}

function parseCronTime(cron) {
  // Cron format: minute hour day month weekday
  const parts = cron.split(' ');

  if (parts.length < 5) {
    return cron;
  }

  const minute = parts[0] || '*';
  const hour = parts[1] || '*';
  const weekday = parts[4] || '*';

  // Special case: */N means every N units
  if (minute.startsWith('*/')) {
    return `Every ${minute.slice(2)} minutes`;
  }

  // Build time string
  let timeStr = '';

  if (hour === '*' && minute === '*') {
    return 'Every minute';
  }

  if (hour !== '*') {
    const hourNum = parseInt(hour, 10);
    timeStr = `${hourNum.toString().padStart(2, '0')}:${minute.padStart(2, '0')}`;
  }

  // Add day of week if specified
  if (weekday !== '*') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayNames = weekday.split(',').map(d => days[parseInt(d, 10)]).join(', ');
    timeStr += ` (${dayNames})`;
  }

  return timeStr || cron;
}

// ============================================================
// Document Updater
// ============================================================

function updateDocument(docPath, autoContent, dryRun) {
  if (!fs.existsSync(docPath)) {
    log(`Warning: Document not found: ${docPath}`, '[docs:sync]');
    return { docPath, updated: false, error: 'File not found' };
  }

  try {
    let content = fs.readFileSync(docPath, 'utf-8');
    let updated = false;

    // Check if AUTO-GENERATED markers exist
    const hasStartMarker = content.includes(AUTO_GEN_START);
    const hasEndMarker = content.includes(AUTO_GEN_END);

    if (hasStartMarker && hasEndMarker) {
      // Replace content between markers
      const startIndex = content.indexOf(AUTO_GEN_START);
      const endIndex = content.indexOf(AUTO_GEN_END);

      if (startIndex < endIndex) {
        const before = content.substring(0, startIndex + AUTO_GEN_START.length);
        const after = content.substring(endIndex);

        const newContent = before + '\n' + autoContent + '\n' + after;

        if (newContent !== content) {
          if (!dryRun) {
            fs.writeFileSync(docPath, newContent, 'utf-8');
          }
          updated = true;
        }
      }
    } else {
      // Append auto-generated section at the end
      const newSection = `\n\n---\n\n${AUTO_GEN_START}\n${autoContent}\n${AUTO_GEN_END}\n`;

      if (!dryRun) {
        fs.appendFileSync(docPath, newSection, 'utf-8');
      }
      updated = true;
    }

    return { docPath, updated };
  } catch (error) {
    return { docPath, updated: false, error: error.message };
  }
}

// ============================================================
// Content Generators
// ============================================================

function generateRepoFileMapContent(structure, schedules) {
  const date = getCurrentDateKST();

  let content = `## Auto-Generated Repository Overview\n\n`;
  content += `**Generated on:** ${date}\n\n`;

  // Repository structure summary
  content += `### Repository Structure\n\n`;
  content += `| Directory | File Count |\n`;
  content += `|-----------|------------|\n`;
  content += `| Root | ${structure.root.length} |\n`;
  content += `| Backend | ${structure.backend.length} |\n`;
  content += `| Backend/src | ${structure.backendSrc.length} |\n`;
  content += `| Backend/admin-web | ${structure.backendAdminWeb.length} |\n`;
  content += `| Pages | ${structure.pages.length} |\n`;
  content += `| Src | ${structure.src.length} |\n`;
  content += `| Docs | ${structure.docs.length} |\n`;
  content += `| Migrations | ${structure.migrations.length} |\n\n`;

  // Scheduler table
  const activeSchedules = schedules.filter(s => !s.commented);
  content += `### Scheduler Jobs (${activeSchedules.length} active)\n\n`;
  content += `| Time | Cron | Job Name | Module | Status |\n`;
  content += `|------|------|----------|--------|--------|\n`;

  for (const schedule of schedules) {
    const status = schedule.commented ? '(주석 처리)' : 'Active';
    const timeDisplay = schedule.commented ? `~~${schedule.time}~~` : schedule.time;
    const jobDisplay = schedule.commented ? `~~${schedule.jobName}~~` : schedule.jobName;

    content += `| ${timeDisplay} | \`${schedule.cron}\` | ${jobDisplay} | ${schedule.module} | ${status} |\n`;
  }

  content += `\n**Timezone:** ${schedules[0]?.timezone || 'Asia/Seoul'}\n`;

  return content;
}

function generateArchitectureContent(schedules) {
  const date = getCurrentDateKST();

  let content = `## Auto-Generated Scheduler Summary\n\n`;
  content += `**Generated on:** ${date}\n\n`;

  // Active schedules only
  const activeSchedules = schedules.filter(s => !s.commented);
  const commentedSchedules = schedules.filter(s => s.commented);

  content += `### Active Schedules (${activeSchedules.length})\n\n`;

  for (const schedule of activeSchedules) {
    content += `- **${schedule.time}** (\`${schedule.cron}\`): ${schedule.jobName}\n`;
  }

  if (commentedSchedules.length > 0) {
    content += `\n### Disabled Schedules (${commentedSchedules.length})\n\n`;

    for (const schedule of commentedSchedules) {
      content += `- ~~${schedule.time}~~ (주석 처리): ${schedule.jobName}\n`;
    }
  }

  content += `\n**Environment Variable Required:** \`ENABLE_SCHEDULER=true\`\n`;

  return content;
}

function generateChangelogContent() {
  const date = getCurrentDateKST();

  let content = `## [${date}] Documentation Auto-Update\n\n`;
  content += `### Auto-Generated Changes\n\n`;
  content += `- Repository structure scanned and documented\n`;
  content += `- Scheduler configuration extracted from scheduler.ts\n`;
  content += `- Package.json scripts inventory updated\n`;
  content += `- File maps regenerated\n\n`;
  content += `**마지막 업데이트:** ${date} (Asia/Seoul)\n`;

  return content;
}

function generateBackendFileMapContent(structure, scripts) {
  const date = getCurrentDateKST();

  let content = `## Auto-Generated Backend Overview\n\n`;
  content += `**Generated on:** ${date}\n\n`;

  // Backend structure
  content += `### Backend File Structure\n\n`;
  content += `| Directory | Files |\n`;
  content += `|-----------|-------|\n`;
  content += `| src/ | ${structure.backendSrc.length} |\n`;
  content += `| admin-web/ | ${structure.backendAdminWeb.length} |\n`;
  content += `| migrations/ | ${structure.migrations.length} |\n\n`;

  // Package scripts
  if (scripts) {
    const scriptCount = Object.keys(scripts).length;
    content += `### Available NPM Scripts (${scriptCount})\n\n`;
    content += `\`\`\`bash\n`;

    const categories = {
      'Server': ['dev', 'start', 'build'],
      'Collectors': ['collect:'],
      'Jobs': ['job:', 'pipeline:'],
      'Backfill': ['backfill:'],
      'Tests': ['test-', 'test:'],
      'Reports': ['report:', 'verify:', 'audit:', 'analyze:'],
      'Enrichment': ['enrich:'],
    };

    for (const [category, patterns] of Object.entries(categories)) {
      const categoryScripts = Object.entries(scripts).filter(([name]) =>
        patterns.some(pattern => name.includes(pattern))
      );

      if (categoryScripts.length > 0) {
        content += `\n# ${category}\n`;
        for (const [name] of categoryScripts.slice(0, 10)) {
          content += `npm run ${name}\n`;
        }
      }
    }

    content += `\`\`\`\n\n`;
  }

  // Key files
  content += `### Key Files\n\n`;

  const keyFiles = [
    { path: 'src/index.ts', description: 'Main server entry point' },
    { path: 'src/scheduler.ts', description: 'Cron job scheduler' },
    { path: 'src/db.ts', description: 'Database connection' },
  ];

  for (const file of keyFiles) {
    const fullPath = path.join(BACKEND_DIR, file.path);
    const lines = countLines(fullPath);
    if (lines > 0) {
      content += `- **${file.path}** (${lines} lines) - ${file.description}\n`;
    }
  }

  return content;
}

function generateAutoContent(structure, rootScripts, backendScripts, schedules) {
  return {
    [DOCUMENT_PATHS.REPO_FILE_MAP]: generateRepoFileMapContent(structure, schedules),
    [DOCUMENT_PATHS.ARCHITECTURE]: generateArchitectureContent(schedules),
    [DOCUMENT_PATHS.CHANGELOG]: generateChangelogContent(),
    [DOCUMENT_PATHS.BACKEND_FILE_MAP]: generateBackendFileMapContent(structure, backendScripts),
  };
}

// ============================================================
// Main Function
// ============================================================

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry');
  const write = args.includes('--write');

  if (!dryRun && !write) {
    console.log(`
Usage: node scripts/gen-docs.ts [--dry|--write]

Options:
  --dry     Show diff/summary without writing files
  --write   Actually update documentation files

Examples:
  node scripts/gen-docs.ts --dry      # Preview changes
  node scripts/gen-docs.ts --write    # Update documents
`);
    process.exit(1);
  }

  log('Starting documentation generation...');
  log(dryRun ? 'Mode: DRY RUN (no files will be modified)' : 'Mode: WRITE (files will be updated)');
  log('');

  // Step 1: Scan repository structure
  const structure = scanRepoStructure();
  log(`✓ Found ${structure.root.length} root items`);
  log(`✓ Found ${structure.backend.length} backend items`);

  // Step 2: Read package.json scripts
  const rootScripts = readPackageScripts(path.join(REPO_ROOT, 'package.json'));
  const backendScripts = readPackageScripts(path.join(BACKEND_DIR, 'package.json'));

  if (rootScripts) {
    log(`✓ Found ${Object.keys(rootScripts).length} root package.json scripts`);
  }
  if (backendScripts) {
    log(`✓ Found ${Object.keys(backendScripts).length} backend/package.json scripts`);
  }

  // Step 3: Extract cron schedules
  const schedulerPath = path.join(BACKEND_DIR, 'src', 'scheduler.ts');
  const schedules = extractCronSchedules(schedulerPath);

  // Step 4: Generate auto-content for each document
  log('');
  log('Generating auto-content...');
  const autoContents = generateAutoContent(structure, rootScripts, backendScripts, schedules);

  // Step 5: Update documents
  log('');
  log('Updating documents...');
  const results = [];

  for (const [docPath, content] of Object.entries(autoContents)) {
    const result = updateDocument(docPath, content, dryRun);
    results.push(result);

    if (result.error) {
      log(`✗ Failed to update ${path.basename(docPath)}: ${result.error}`, '[docs:sync]');
    } else if (result.updated) {
      log(`✓ ${dryRun ? 'Would update' : 'Updated'} ${path.basename(docPath)}`, '[docs:sync]');
    } else {
      log(`- No changes needed for ${path.basename(docPath)}`, '[docs:sync]');
    }
  }

  // Summary
  log('');
  const updatedCount = results.filter(r => r.updated).length;
  const errorCount = results.filter(r => r.error).length;

  if (dryRun) {
    log(`Done! Would update ${updatedCount} documents.`);
    if (updatedCount > 0) {
      log('Run with --write to actually update the files.');
    }
  } else {
    log(`Done! Updated ${updatedCount} documents.`);
  }

  if (errorCount > 0) {
    log(`⚠️  ${errorCount} errors occurred.`, '[docs:sync]');
    process.exit(1);
  }
}

// ============================================================
// Entry Point
// ============================================================

main();
