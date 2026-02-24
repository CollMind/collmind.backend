const webpack = require('webpack');

module.exports = function (options, webpack) {
  const lazyImports = [
    '@nestjs/microservices/microservices-module',
    '@nestjs/websockets/socket-module',
  ];

  // Native modülleri externals olarak işaretle
  const externals = [
    ...(options.externals || []),
    'bcrypt',
    'pg',
    'pg-native',
    'mock-aws-s3',
    'aws-sdk',
    'nock',
  ];

  // ForkTsCheckerWebpackPlugin bellek limitini artır veya devre dışı bırak
  const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
  
  // Mevcut plugin'leri kontrol et ve ForkTsCheckerWebpackPlugin'i güncelle
  const plugins = options.plugins
    .filter((plugin) => {
      // ForkTsCheckerWebpackPlugin'i devre dışı bırak (bellek hatası nedeniyle)
      return !(plugin instanceof ForkTsCheckerWebpackPlugin);
    })
    .map((plugin) => plugin);

  return {
    ...options,
    externals: externals,
    output: {
      ...options.output,
      libraryTarget: 'commonjs2',
    },
    plugins: [
      ...plugins,
      new webpack.IgnorePlugin({
        checkResource(resource) {
          if (lazyImports.includes(resource)) {
            try {
              require.resolve(resource);
            } catch (err) {
              return true;
            }
          }
          // Native modül bağımlılıklarını ignore et
          if (
            resource.includes('mock-aws-s3') ||
            resource.includes('aws-sdk') ||
            resource.includes('nock') ||
            resource.includes('@mapbox/node-pre-gyp')
          ) {
            return true;
          }
          return false;
        },
      }),
    ],
  };
};
