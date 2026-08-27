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
    // ⛔ SINIF ADLARI KORUNMALI (`B4 A-prime`, 2026-08-27 — review `S2`).
    // `CapabilityGuard` domain-guard muafiyetini `constructor.name` ile
    // çözüyor (`KNOWN_DOMAIN_GUARD_NAMES`, `src/common/guards/
    // capability.guard.ts`). Minify sınıf adlarını değiştirirse muafiyet
    // DÜŞER — yön güvenlidir (fail-CLOSED, `403`), ama sonuç bir ÜRETİM
    // KESİNTİSİDİR: `settlements/close` erişilemez hâle gelir ve bunu ilk
    // gören KULLANICI olur.
    // Bugün `@nestjs/cli` varsayılanı `mode: 'none'` (ölçüldü: `dist/main.js`
    // içinde `SettlementGuard` 8 kez geçiyor) — ama o ÖRTÜK bir varsayılandı
    // ve hiçbir kapı onu tutmuyordu. Artık AÇIKÇA yazılı:
    optimization: {
      ...(options.optimization || {}),
      minimize: false,
    },
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
