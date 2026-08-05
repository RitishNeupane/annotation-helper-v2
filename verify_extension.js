const fs = require('fs');
const path = require('path');

console.log('--- mySecondTeacher Extension Verification ---');

// 1. Verify Manifest
const manifestPath = path.join(__dirname, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error('FAIL: manifest.json does not exist');
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
console.log('✔ manifest.json parsed successfully');

if (manifest.manifest_version !== 3) {
  console.error('FAIL: Manifest version must be 3');
  process.exit(1);
}
console.log('✔ Manifest version 3 confirmed');

// Check URL match pattern
const matches = manifest.content_scripts[0].matches;
if (!matches.includes('https://publishing.mysecondteacher.com/*')) {
  console.error('FAIL: Content script must target https://publishing.mysecondteacher.com/*');
  process.exit(1);
}
console.log('✔ Target URL pattern strictly matched to https://publishing.mysecondteacher.com/*');

// 2. Check all declared file paths
const requiredFiles = [
  'manifest.json',
  'background/background.js',
  'content/content.js',
  'content/content.css',
  'popup/popup.html',
  'popup/popup.css',
  'popup/popup.js',
  'assets/icon16.png',
  'assets/icon48.png',
  'assets/icon128.png'
];

requiredFiles.forEach(file => {
  const filePath = path.join(__dirname, file);
  if (!fs.existsSync(filePath)) {
    console.error(`FAIL: Missing required file ${file}`);
    process.exit(1);
  }
  const stats = fs.statSync(filePath);
  if (stats.size === 0) {
    console.error(`FAIL: File ${file} is empty`);
    process.exit(1);
  }
  console.log(`✔ Verified ${file} (${stats.size} bytes)`);
});

// 3. Verify JavaScript syntax in background, content, popup JS
const jsFiles = ['background/background.js', 'content/content.js', 'popup/popup.js'];
jsFiles.forEach(file => {
  const code = fs.readFileSync(path.join(__dirname, file), 'utf-8');
  try {
    new Function(code);
    console.log(`✔ JavaScript syntax check passed for ${file}`);
  } catch (err) {
    console.error(`FAIL: Syntax error in ${file}: ${err.message}`);
    process.exit(1);
  }
});

console.log('\n--- ALL VERIFICATION TESTS PASSED SUCCESSFULLY! ---');
