const fs = require('fs');
const path = require('path');

console.log('[Patch] Starting Granite patch...');

// 1. metro-cache-key 경로 패치
const targetFile = path.join(
  __dirname,
  'node_modules/@granite-js/mpack/dist/vendors/metro/src/DeltaBundler/getTransformCacheKey.js'
);

if (fs.existsSync(targetFile)) {
  let content = fs.readFileSync(targetFile, 'utf8');
  
  // metro-cache-key 경로 패치
  // @granite-js/mpack/node_modules에 복사했으므로 직접 참조
  content = content.replace(
    /require\([\"']\.*(\/\.\.)*\/node_modules\/metro-cache-key[\"']\)/g,
    'require("metro-cache-key")'
  );
  content = content.replace(
    /require\([\"']\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/node_modules\/metro-cache-key[\"']\)/g,
    'require("metro-cache-key")'
  );
  
  fs.writeFileSync(targetFile, content, 'utf8');
  console.log('✅ Patched getTransformCacheKey.js');
} else {
  console.log('⚠️  getTransformCacheKey.js not found, skipping patch');
}

console.log('[Patch] Granite patch completed');

