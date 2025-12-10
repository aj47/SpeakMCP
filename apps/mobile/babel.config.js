module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // react-native-reanimated/plugin must be listed LAST
      'react-native-reanimated/plugin',
    ],
  };
};

