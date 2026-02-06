# Scripts Documentation

This directory contains utility scripts for the Fairpick project.

## gen-docs.ts

Automatically generates and updates documentation by scanning the repository structure and extracting information from source code.

### Features

1. **Repository Structure Scanning**
   - Scans root, backend, pages, src, docs directories
   - Counts files and folders
   - Excludes node_modules, .git, dist, etc.

2. **Package.json Scripts Inventory**
   - Reads scripts from root and backend package.json
   - Categorizes scripts (Server, Collectors, Jobs, Backfill, etc.)
   - Generates formatted script listings

3. **Cron Schedule Extraction**
   - Parses `backend/src/scheduler.ts`
   - Extracts all cron.schedule() calls
   - Identifies commented schedules
   - Parses timezone and job names
   - Generates human-readable time descriptions

4. **Document Updates**
   - Updates sections marked with `<!-- AUTO-GENERATED:START -->` and `<!-- AUTO-GENERATED:END -->`
   - If no markers exist, appends auto-generated section at the end
   - Never modifies content outside markers

### Usage

```bash
# Preview changes without modifying files
node scripts/gen-docs.ts --dry

# Actually update documentation files
node scripts/gen-docs.ts --write
```

### Updated Documents

- `REPO_FILE_MAP.md` - Repository structure overview and scheduler table
- `ARCHITECTURE.md` - Scheduler configuration summary
- `CHANGELOG.md` - Auto-update entries with timestamp
- `backend/FILE_MAP.md` - Backend file structure and npm scripts

### How It Works

1. **Scan Phase**
   - Recursively scans directories up to specified depth
   - Counts files and categorizes by location

2. **Extract Phase**
   - Reads package.json files for script definitions
   - Parses scheduler.ts using regex to find cron.schedule calls
   - Extracts job names, cron expressions, and timezones

3. **Generate Phase**
   - Creates markdown content for each document
   - Formats tables with file counts, schedules, and scripts
   - Adds timestamps in KST (Asia/Seoul)

4. **Update Phase**
   - Locates AUTO-GENERATED markers in documents
   - Replaces content between markers
   - Preserves manually-written content

### Marker Format

To enable auto-generation in a document, add these markers:

```markdown
<!-- AUTO-GENERATED:START -->
This content will be replaced by the script
<!-- AUTO-GENERATED:END -->
```

If markers don't exist, the script will append the auto-generated section at the end of the file.

### Output Example

```
[docs:sync] Starting documentation generation...
[docs:sync] Mode: DRY RUN (no files will be modified)
[docs:sync]
[docs:sync] Scanning repository structure...
[docs:sync] ✓ Found 37 root items
[docs:sync] ✓ Found 84 backend items
[docs:sync] ✓ Found 6 root package.json scripts
[docs:sync] ✓ Found 55 backend/package.json scripts
[docs:sync] Extracting cron schedules from scheduler.ts...
[docs:sync] ✓ Extracted 12 cron schedules
[docs:sync]
[docs:sync] Generating auto-content...
[docs:sync]
[docs:sync] Updating documents...
[docs:sync] ✓ Would update REPO_FILE_MAP.md
[docs:sync] ✓ Would update ARCHITECTURE.md
[docs:sync] ✓ Would update CHANGELOG.md
[docs:sync] ✓ Would update FILE_MAP.md
[docs:sync]
[docs:sync] Done! Would update 4 documents.
[docs:sync] Run with --write to actually update the files.
```

### When to Run

- After adding/removing files or directories
- After modifying package.json scripts
- After changing scheduler.ts (cron schedules)
- Before major releases or documentation reviews
- Weekly or monthly as part of maintenance

### Maintenance

The script uses Node.js built-in modules only (fs, path) and requires no external dependencies. It's compatible with Node 18+.

To modify what gets generated:
- Edit `generateRepoFileMapContent()` for REPO_FILE_MAP.md
- Edit `generateArchitectureContent()` for ARCHITECTURE.md
- Edit `generateChangelogContent()` for CHANGELOG.md
- Edit `generateBackendFileMapContent()` for backend/FILE_MAP.md

### Troubleshooting

**Script fails to find files:**
- Check that you're running from the repository root
- Verify file paths in DOCUMENT_PATHS constant

**Cron schedules not detected:**
- Check scheduler.ts uses `cron.schedule()` syntax
- Verify job names are wrapped in `runJobSafely()`

**Documents not updated:**
- Ensure AUTO-GENERATED markers are present
- Check file permissions
- Run with --dry first to preview changes
