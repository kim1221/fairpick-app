const { getDefaultConfig } = require('@react-native/metro-config');
const path = require('path');
const exclusionList = require('metro-config/src/defaults/exclusionList');

module.exports = (async () => {
  const defaultConfig = await getDefaultConfig(__dirname);
  
  return {
    ...defaultConfig,
    projectRoot: __dirname,
    watchFolders: [__dirname],
    resolver: {
      ...defaultConfig.resolver,
      // backend 폴더 및 불필요한 디렉토리 완전 제외
      blockList: exclusionList([
        // Backend 완전 제외 (23k+ 파일)
        /backend\/.*/,
        /backend$/,
        
        // Build 디렉토리
        /android\/.*/,
        /ios\/.*/,
        /\.gradle\/.*/,
        /\.expo\/.*/,
        
        // Git
        /\.git\/.*/,
        
        // Nested node_modules
        /node_modules\/.*\/node_modules\/.*/,
        
        // Tests
        /.*\/__tests__\/.*/,
        /.*\/__mocks__\/.*/,
      ]),
    },
    // Watchman 강제 사용 (NodeWatcher 대신)
    watcher: {
      healthCheck: {
        enabled: true,
      },
      watchman: {
        deferStates: ['hg.update'],
      },
    },
  };
})();

