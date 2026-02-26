const fs = require('fs');
const path = require('path');

console.log('[Patch] Starting Granite patch...');

// 1. metro-cache-key 경로 패치
const targetFile = path.join(
  __dirname,
  'node_modules/@granite-js/mpack/dist/vendors/metro/src/DeltaBundler/getTransformCacheKey.js'
);

if (fs.existsSync(targetFile)) {
  const metroCacheKeyPath = path.join(__dirname, 'node_modules/metro-cache-key/src/index.js');
  const absolutePath = path.resolve(metroCacheKeyPath);
  
  console.log(`[Patch] metro-cache-key absolute path: ${absolutePath}`);
  
  let content = fs.readFileSync(targetFile, 'utf8');
  
  // metro-cache-key를 절대 경로로 변경
  content = content.replace(
    /require\([\"'].*metro-cache-key.*[\"']\)/g,
    `require("${absolutePath}")`
  );
  
  fs.writeFileSync(targetFile, content, 'utf8');
  console.log('✅ Patched getTransformCacheKey.js with absolute path');
} else {
  console.log('⚠️  getTransformCacheKey.js not found, skipping patch');
}

console.log('[Patch] Granite patch completed');

