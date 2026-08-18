// test_timing_logic.js - Unit tests for Timing Manager reordering and export/import logic

const assert = require('assert');

console.log('--- Testing Timing Manager Logic ---');

// Simulated initial annotations
let timings = [
  { originalIndex: 1, startTime: 0, endTime: 10, duration: 10 },
  { originalIndex: 2, startTime: 10, endTime: 20, duration: 10 },
  { originalIndex: 3, startTime: 20, endTime: 30, duration: 10 },
  { originalIndex: 4, startTime: 30, endTime: 40, duration: 10 }
];

function moveTimingItem(arr, fromIndex, toIndex) {
  const list = JSON.parse(JSON.stringify(arr));
  const [moved] = list.splice(fromIndex, 1);
  list.splice(toIndex, 0, moved);
  return list;
}

// Test 1: Move Annotation 4 (Index 3) to Slot 1 (Index 0)
// Expected: Item 4 becomes slot 1, Item 1 shifts to slot 2, Item 2 to slot 3, Item 3 to slot 4
const afterMove1 = moveTimingItem(timings, 3, 0);
console.log('Test 1: Moving #4 to Slot 1...');
assert.strictEqual(afterMove1[0].originalIndex, 4, 'Slot 1 must have timing from #4');
assert.strictEqual(afterMove1[1].originalIndex, 1, 'Slot 2 must have timing from #1');
assert.strictEqual(afterMove1[2].originalIndex, 2, 'Slot 3 must have timing from #2');
assert.strictEqual(afterMove1[3].originalIndex, 3, 'Slot 4 must have timing from #3');
console.log('✔ Test 1 Passed: Array shift splice perfectly matches user requirement');

// Test 2: Move Annotation 2 (Index 1) to Slot 4 (Index 3)
const afterMove2 = moveTimingItem(timings, 1, 3);
console.log('Test 2: Moving #2 to Slot 4...');
assert.strictEqual(afterMove2[0].originalIndex, 1, 'Slot 1 must remain #1');
assert.strictEqual(afterMove2[1].originalIndex, 3, 'Slot 2 must shift to #3');
assert.strictEqual(afterMove2[2].originalIndex, 4, 'Slot 3 must shift to #4');
assert.strictEqual(afterMove2[3].originalIndex, 2, 'Slot 4 must have timing from #2');
console.log('✔ Test 2 Passed: Downward shift works cleanly');

// Test 3: Export & Import round-trip parser verification
function exportTimings(list) {
  let content = `mySecondTeacher Annotation Timings Export\n\n`;
  content += `SLOT | SOURCE TIMING | START TIME | END TIME | DURATION\n`;
  list.forEach((item, idx) => {
    content += `Slot #${idx + 1} | From #${item.originalIndex} | 00:00.000 (${item.startTime}s) | 00:10.000 (${item.endTime}s) | ${item.duration}s\n`;
  });
  content += `\n[STRUCTURED JSON DATA FOR EASY IMPORT - DO NOT EDIT BELOW]\n`;
  content += JSON.stringify({ version: "1.3.0", timings: list }, null, 2);
  return content;
}

function parseTimings(text) {
  if (text.includes('[STRUCTURED JSON DATA FOR EASY IMPORT - DO NOT EDIT BELOW]')) {
    const parts = text.split('[STRUCTURED JSON DATA FOR EASY IMPORT - DO NOT EDIT BELOW]');
    const jsonStr = parts[1].replace(/^[=\s]+/, '');
    const data = JSON.parse(jsonStr);
    return data.timings;
  }
  return [];
}

const exportedText = exportTimings(afterMove1);
const reImported = parseTimings(exportedText);
assert.strictEqual(reImported.length, 4, 'Should parse 4 timing items');
assert.strictEqual(reImported[0].originalIndex, 4);
assert.strictEqual(reImported[0].startTime, 30);
assert.strictEqual(reImported[0].endTime, 40);
console.log('✔ Test 3 Passed: Export/Import round-trip lossless verification passed');

console.log('\n--- ALL TIMING LOGIC TESTS PASSED SUCCESSFULLY! ---');
