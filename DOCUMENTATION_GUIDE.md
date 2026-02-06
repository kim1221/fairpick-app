# Documentation Guide

This guide explains how to maintain and update the Fairpick documentation.

## Table of Contents

1. [Auto-Generated Documentation](#auto-generated-documentation)
2. [Manual Documentation](#manual-documentation)
3. [Best Practices](#best-practices)
4. [Document Structure](#document-structure)

---

## Auto-Generated Documentation

### Overview

Fairpick uses an automated documentation generator (`scripts/gen-docs.ts`) to keep documentation synchronized with the codebase.

### Quick Start

```bash
# Preview changes without modifying files
npm run docs:preview

# Update all documentation
npm run docs:sync
```

### What Gets Auto-Generated?

The following sections in these documents are automatically maintained:

#### REPO_FILE_MAP.md
- Repository structure (file counts)
- Scheduler jobs table with cron expressions
- Active vs commented schedules

#### ARCHITECTURE.md
- Scheduler configuration summary
- Active and disabled schedules
- Environment variable requirements

#### CHANGELOG.md
- Auto-update entries with timestamps

#### backend/FILE_MAP.md
- Backend file structure
- NPM scripts inventory
- Key file listings with line counts

### Adding Auto-Generated Sections

To enable auto-generation in any markdown document, add these markers:

```markdown
<!-- AUTO-GENERATED:START -->
Content between these markers will be automatically updated
<!-- AUTO-GENERATED:END -->
```

**Important:** Content outside these markers is never modified by the script.

---

## Manual Documentation

### Documents to Maintain Manually

These documents require human judgment and should be updated manually:

1. **PROJECT_CONTEXT.md** - Project vision, goals, and philosophy
2. **QUICK_START.md** - Getting started guide for new developers
3. **HOT_SCORE_IMPLEMENTATION_GUIDE.md** - Hot scoring algorithm details
4. **AI_ENRICHMENT_GUIDE.md** - AI enrichment workflow
5. **PHASE*_*.md** - Phase-specific implementation details

### When to Update Manual Documentation

- Architecture decisions change (update ARCHITECTURE.md manually, then add AUTO-GENERATED section for scheduler)
- New features are added
- API contracts change
- Troubleshooting steps are discovered
- Best practices evolve

---

## Best Practices

### 1. Keep Auto-Generated Sections Accurate

Run `npm run docs:sync` after:
- Adding/removing files or directories
- Modifying package.json scripts
- Changing scheduler.ts (cron schedules)
- Major refactorings

### 2. Use Consistent Formatting

- **Headings:** Use sentence case (not title case)
- **Code blocks:** Always specify language (```typescript, ```bash, etc.)
- **Lists:** Use `-` for unordered, `1.` for ordered
- **Tables:** Always include header row

### 3. Link Related Documents

When mentioning another document, link to it:

```markdown
See [ARCHITECTURE.md](./ARCHITECTURE.md) for details.
```

### 4. Add Examples

For complex concepts, always include:
- Code examples
- Command examples
- Expected output

### 5. Date Your Changes

For significant manual updates, add a note:

```markdown
**Last Updated:** 2026-02-07
```

---

## Document Structure

### Repository Root Documents

```
fairpick-app/
├── REPO_FILE_MAP.md              # Repository overview (AUTO-GEN)
├── ARCHITECTURE.md               # System architecture (MIXED)
├── CHANGELOG.md                  # Change log (AUTO-GEN + MANUAL)
├── DOCUMENTATION_GUIDE.md        # This file
├── PROJECT_CONTEXT.md            # Project vision (MANUAL)
├── QUICK_START.md                # Getting started (MANUAL)
├── HOT_SCORE_IMPLEMENTATION_GUIDE.md
├── AI_ENRICHMENT_GUIDE.md
└── PHASE*_*.md
```

### Backend Documents

```
backend/
├── FILE_MAP.md                   # Backend file map (AUTO-GEN)
├── README.md                     # Backend overview (MANUAL)
├── GEMINI_SETUP_GUIDE.md         # Gemini API setup (MANUAL)
├── NAVER_BUZZ_SETUP.md           # Naver API setup (MANUAL)
└── docs/
    └── (API specifications, schemas, etc.)
```

### Documentation Categories

#### AUTO-GENERATED (✓)
- File counts and structure
- Scheduler configuration
- NPM scripts inventory
- Cron schedules

#### MIXED (⚠️)
- ARCHITECTURE.md (manual + auto-generated scheduler section)
- CHANGELOG.md (manual entries + auto-generated summaries)

#### MANUAL (✋)
- Project vision and goals
- Setup guides
- Troubleshooting steps
- Implementation details
- Design decisions

---

## Troubleshooting

### Script fails to run

**Problem:** `node scripts/gen-docs.ts --dry` fails

**Solution:**
1. Ensure you're in the repository root
2. Check Node.js version (requires 18+)
3. Verify file permissions: `chmod +x scripts/gen-docs.ts`

### Documents not updating

**Problem:** Running `npm run docs:sync` but changes don't appear

**Solution:**
1. Check if AUTO-GENERATED markers exist in the document
2. If missing, the script will append at the end of the file
3. Verify you're using `--write` flag (not `--dry`)

### Cron schedules not detected

**Problem:** Scheduler table is empty or incomplete

**Solution:**
1. Verify `backend/src/scheduler.ts` exists
2. Check that cron.schedule() calls use standard syntax
3. Ensure job names are in runJobSafely() calls

---

## Contributing to Documentation

### Before Making Changes

1. Run `npm run docs:preview` to see current state
2. Check if the section you want to edit is auto-generated
3. If auto-generated, modify the source code or the script instead

### Making Manual Updates

1. Edit the markdown file directly
2. Add/update `**Last Updated:**` timestamp if significant
3. Test any code examples you add
4. Verify internal links work

### After Making Changes

1. Run `npm run docs:sync` to update auto-generated sections
2. Review the full document for consistency
3. Commit both manual and auto-generated changes together

### Commit Message Format

```
docs: update ARCHITECTURE with new scheduler jobs

- Added Phase 3 enrichment schedule
- Updated scheduler table via npm run docs:sync
- Clarified environment variable requirements
```

---

## Automation

### CI/CD Integration (Future)

Consider adding to CI pipeline:

```yaml
# .github/workflows/docs.yml
- name: Check documentation sync
  run: |
    npm run docs:preview
    git diff --exit-code
```

This ensures docs are always up-to-date before merging PRs.

### Pre-commit Hook (Optional)

Add to `.git/hooks/pre-commit`:

```bash
#!/bin/bash
npm run docs:sync
git add *.md backend/*.md
```

---

## FAQ

**Q: Can I edit auto-generated sections manually?**
A: No, they will be overwritten. Edit the source (code or script) instead.

**Q: How do I add a new document to auto-generation?**
A: Add the document path to `DOCUMENT_PATHS` in `scripts/gen-docs.ts` and create a generator function.

**Q: What if I need a different format for auto-generated content?**
A: Edit the `generate*Content()` functions in `scripts/gen-docs.ts`.

**Q: Can I disable auto-generation for specific documents?**
A: Yes, simply remove or don't add AUTO-GENERATED markers.

**Q: How often should I run docs:sync?**
A: Whenever you change file structure, package.json scripts, or scheduler.ts. Consider adding to pre-commit hook.

---

**Last Updated:** 2026-02-07
**Maintainer:** Backend Team
