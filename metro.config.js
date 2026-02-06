const { getDefaultConfig } = require('@react-native/metro-config');

module.exports = (async () => {
  const defaultConfig = await getDefaultConfig(__dirname);
  
  return {
    ...defaultConfig,
    watchFolders: [__dirname],
    resolver: {
      ...defaultConfig.resolver,
      // backend 폴더 제외 (Metro가 감시하지 않음)
      blockList: [
        /backend\/.*/,
        /\.git\/.*/,
      ],
    },
    // Watchman 강제 사용
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

