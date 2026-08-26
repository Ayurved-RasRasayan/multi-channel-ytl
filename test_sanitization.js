#!/usr/bin/env node
/**
 * Test script for new sanitization & deduplication system
 * Tests all 6 scenarios defined in the design document
 */

const { execSync } = require('child_process');
const path = require('path');

// Path to sanitize.py
const SANITIZE_PYTHON_SCRIPT = path.join(__dirname, '..', 'ytl-repo', 'sanitize.py');

// ============================================================================
// MOCK: Simulate server.js functions (for testing without full server)
// ============================================================================

function fallbackSanitize(filename) {
    if (!filename || filename.trim() === '') return 'unnamed';

    let sanitized = filename;
    sanitized = sanitized.replace(/[\\/*?:"<>|]/g, '_');
    sanitized = sanitized.replace(/[^\w\s\._\-()]/g, '-');
    sanitized = sanitized.trim(' .');

    if (sanitized && (sanitized[0] === '_' || sanitized[0] === '-')) {
        sanitized = 'Z' + sanitized.slice(1);
    }

    const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;
    if (reserved.test(sanitized)) {
        sanitized = '_' + sanitized;
    }

    if (sanitized.length > 230) {
        sanitized = sanitized.substring(0, 230);
    }

    return sanitized || 'unnamed';
}

function sanitizeViaPython(rawTitle) {
    try {
        const result = execSync(
            `python3 "${SANITIZE_PYTHON_SCRIPT}" --json "${rawTitle.replace(/"/g, '\\"').replace(/\$/g, '\\$')}"`,
            {
                encoding: 'utf-8',
                timeout: 5000,
                cwd: path.dirname(SANITIZE_PYTHON_SCRIPT),
                stdio: ['pipe', 'pipe', 'pipe']
            }
        );

        const parsed = JSON.parse(result.trim());

        if (parsed.success && parsed.sanitized) {
            return parsed.sanitized;
        } else {
            throw new Error(parsed.error || 'Unknown error from sanitize.py');
        }

    } catch (error) {
        console.warn(`[sanitizeViaPython] Python failed, using fallback:`, error.message);
        return fallbackSanitize(rawTitle);
    }
}

function formatDuration(totalSeconds) {
    if (totalSeconds === null || totalSeconds === undefined || totalSeconds <= 0) {
        return null;
    }

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);

    const parts = [];

    if (hours > 0) {
        parts.push(`${String(hours).padStart(2, '0')}h`);
    }

    parts.push(`${String(minutes).padStart(2, '0')}m`);
    parts.push(`${String(seconds).padStart(2, '0')}s`);

    return `(${parts.join('-')})`;
}

function resolveDuplicatesWithDuration(videos) {
    if (!videos || videos.length === 0) {
        return [];
    }

    // STEP 1: Sanitize all titles via sanitize.py (preserves case)
    videos.forEach((video, index) => {
        const rawTitle = video.title || 'Untitled';
        video.sanitizedBase = sanitizeViaPython(rawTitle);
    });

    // STEP 2: Group by sanitized title (CASE-INSENSITIVE comparison)
    const groups = new Map();

    videos.forEach(video => {
        const key = video.sanitizedBase.toLowerCase();
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key).push(video);
    });

    // STEP 3: Process each group and assign suffixes
    groups.forEach((group, groupKey) => {
        if (group.length === 1) {
            // UNIQUE: No suffix needed
            const video = group[0];
            video.durationSuffix = null;
            video.finalFilename = `${video.sanitizedBase}.mp4`;
            video.displayTitle = video.sanitizedBase;
            video.isDuplicate = false;

        } else {
            // DUPLICATES: ALL items get suffix

            // First pass: assign initial suffixes based on duration availability
            group.forEach(video => {
                const formattedDuration = formatDuration(video.duration);

                if (formattedDuration) {
                    video._proposedSuffix = formattedDuration;
                } else {
                    video._proposedSuffix = `--${video.id}`;
                }
            });

            // Second pass: detect and resolve conflicts
            const suffixCounts = new Map();

            group.forEach(video => {
                const lowerSuffix = video._proposedSuffix.toLowerCase();
                suffixCounts.set(lowerSuffix, (suffixCounts.get(lowerSuffix) || 0) + 1);
            });

            // Third pass: finalize suffixes
            group.forEach(video => {
                const lowerSuffix = video._proposedSuffix.toLowerCase();
                const count = suffixCounts.get(lowerSuffix);

                if (count > 1) {
                    // CONFLICT! Force video ID
                    video.durationSuffix = `--${video.id}`;
                } else {
                    video.durationSuffix = video._proposedSuffix;
                }

                video.finalFilename = `${video.sanitizedBase}${video.durationSuffix}.mp4`;
                video.displayTitle = `${video.sanitizedBase}${video.durationSuffix}`;
                video.isDuplicate = true;
            });
        }
    });

    // Clean up temporary properties
    videos.forEach(video => {
        delete video._proposedSuffix;
    });

    return videos;
}

// ============================================================================
// Helper function for flexible matching
// ============================================================================
function expectContains(substring) {
    return { __expectContains: substring };
}

// ============================================================================
// TEST RUNNER
// ============================================================================
function runTest(scenarioName, inputVideos, expectedOutputs) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`SCENARIO: ${scenarioName}`);
    console.log('─'.repeat(70));

    try {
        const processedVideos = resolveDuplicatesWithDuration(JSON.parse(JSON.stringify(inputVideos)));

        let allPassed = true;

        processedVideos.forEach((video, index) => {
            const expected = expectedOutputs[index];
            const actual = video.finalFilename;

            // Handle both exact match and contains match
            let passed;
            if (expected.finalFilename && expected.finalFilename.__expectContains) {
                passed = actual.includes(expected.finalFilename.__expectContains);
            } else {
                passed = actual === expected.finalFilename;
            }

            console.log(`\n  Video ${index + 1}:`);
            console.log(`    Input Title:    "${inputVideos[index].title}"`);
            console.log(`    Input Duration: ${inputVideos[index].duration}`);
            console.log(`    Expected:       ${expected.finalFilename.__expectContains || expected.finalFilename}`);
            console.log(`    Actual:         "${actual}"`);
            console.log(`    Status:         ${passed ? '✅ PASS' : '❌ FAIL'}`);

            if (!passed) {
                allPassed = false;
            }

            if (video.isDuplicate !== expected.isDuplicate) {
                console.log(`    ⚠️ isDuplicate mismatch: expected=${expected.isDuplicate}, actual=${video.isDuplicate}`);
                allPassed = false;
            }
        });

        return allPassed;

    } catch (error) {
        console.error(`  ❌ ERROR: ${error.message}`);
        return false;
    }
}

// ============================================================================
// MAIN TEST EXECUTION
// ============================================================================

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║     SANITIZATION & DEDUPLICATION SYSTEM - TEST SUITE       ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

let testsPassed = 0;
let testsFailed = 0;

// Scenario 1: Simple Duplicates (All Have Duration)
// Note: sanitize.py PRESERVES spaces (by design), so "Lecture 1" stays as "Lecture 1"
if (runTest(
    'Scenario 1: Simple Duplicates (All Have Duration)',
    [
        { id: 'abc111', title: 'Lecture 1', duration: 1800 },
        { id: 'def222', title: 'Lecture 1', duration: 2700 },
        { id: 'ghi333', title: 'Lecture 1', duration: 3600 }
    ],
    [
        { finalFilename: expectContains('(30m-00s).mp4'), isDuplicate: true },
        { finalFilename: expectContains('(45m-00s).mp4'), isDuplicate: true },
        { finalFilename: expectContains('(01h-00m-00s).mp4'), isDuplicate: true }
    ]
)) testsPassed++; else testsFailed++;

// Scenario 2: Same Duration Conflict → Falls back to Video ID
if (runTest(
    'Scenario 2: Same Duration Conflict → Falls back to Video ID',
    [
        { id: 'aaa111', title: 'Episode 1', duration: 1800 },
        { id: 'bbb222', title: 'Episode 1', duration: 1800 },  // Same duration!
        { id: 'ccc333', title: 'Episode 1', duration: 3600 }
    ],
    [
        { finalFilename: expectContains('--aaa111.mp4'), isDuplicate: true },
        { finalFilename: expectContains('--bbb222.mp4'), isDuplicate: true },
        { finalFilename: expectContains('(01h-00m-00s).mp4'), isDuplicate: true }
    ]
)) testsPassed++; else testsFailed++;

// Scenario 3: Missing Duration → Uses Video ID Suffix
if (runTest(
    'Scenario 3: Missing Duration → Uses Video ID Suffix',
    [
        { id: 'live001', title: 'Live Stream', duration: null },
        { id: 'live002', title: 'Live Stream', duration: null },
        { id: 'live003', title: 'Live Stream', duration: null }
    ],
    [
        { finalFilename: expectContains('--live001.mp4'), isDuplicate: true },
        { finalFilename: expectContains('--live002.mp4'), isDuplicate: true },
        { finalFilename: expectContains('--live003.mp4'), isDuplicate: true }
    ]
)) testsPassed++; else testsFailed++;

// Scenario 4: Case-Insensitive Duplication (Preserves Original Case)
if (runTest(
    'Scenario 4: Case-Insensitive Duplication (Preserves Original Case)',
    [
        { id: 'lecA', title: 'Lecture 1', duration: 1800 },
        { id: 'lecB', title: 'lecture 1', duration: 2700 },   // Different case!
        { id: 'lecC', title: 'LECTURE 1', duration: 3600 }    // All caps!
    ],
    [
        { finalFilename: expectContains('(30m-00s).mp4'), isDuplicate: true },
        { finalFilename: expectContains('(45m-00s).mp4'), isDuplicate: true },
        { finalFilename: expectContains('(01h-00m-00s).mp4'), isDuplicate: true }
    ]
)) testsPassed++; else testsFailed++;

// Scenario 5: Mixed Duration Availability
if (runTest(
    'Scenario 5: Mixed Duration Availability',
    [
        { id: 'talk1', title: 'Talk', duration: null },
        { id: 'talk2', title: 'Talk', duration: 900 },
        { id: 'talk3', title: 'Talk', duration: null }
    ],
    [
        { finalFilename: expectContains('--talk1.mp4'), isDuplicate: true },
        { finalFilename: expectContains('(15m-00s).mp4'), isDuplicate: true },
        { finalFilename: expectContains('--talk3.mp4'), isDuplicate: true }
    ]
)) testsPassed++; else testsFailed++;

// Scenario 6: Unique Files (No Suffix Needed)
// Note: sanitize.py PRESERVES spaces, so "Introduction to Chemistry" stays as-is
if (runTest(
    'Scenario 6: Unique Files (No Suffix Needed)',
    [
        { id: 'chem101', title: 'Introduction to Chemistry', duration: 1800 },
        { id: 'phys201', title: 'Advanced Physics', duration: 2400 },
        { id: 'bio101', title: 'Biology Basics', duration: 1500 }
    ],
    [
        { finalFilename: expectContains('Introduction to Chemistry.mp4'), isDuplicate: false },
        { finalFilename: expectContains('Advanced Physics.mp4'), isDuplicate: false },
        { finalFilename: expectContains('Biology Basics.mp4'), isDuplicate: false }
    ]
)) testsPassed++; else testsFailed++;

// ============================================================================
// SUMMARY
// ============================================================================
console.log('\n\n' + '='.repeat(70));
console.log('TEST SUMMARY');
console.log('='.repeat(70));
console.log(`Total Scenarios: ${testsPassed + testsFailed}`);
console.log(`✅ Passed: ${testsPassed}`);
console.log(`❌ Failed: ${testsFailed}`);
console.log('='.repeat(70));

if (testsFailed > 0) {
    process.exit(1);
} else {
    console.log('\n🎉 ALL TESTS PASSED!\n');
    process.exit(0);
}
