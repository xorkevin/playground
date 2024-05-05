import {fileURLToPath} from 'node:url';

import HtmlPlugin from 'html-webpack-plugin';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';

export default (_env, argv) => {
  return {
    context: fileURLToPath(new URL('./src', import.meta.url)),
    entry: {
      main: './main.tsx',
    },

    output: {
      path: fileURLToPath(new URL('./dist', import.meta.url)),
      filename: 'static/[name]-[contenthash].js',
      chunkFilename: 'static/chunk-[id]-[contenthash].js',
      module: true,
      hashFunction: 'sha256',
      hashDigest: 'hex',
      hashDigestLength: 16,
      publicPath: '/',
      environment: {
        arrowFunction: true,
        bigIntLiteral: true,
        const: true,
        destructuring: true,
        dynamicImport: true,
        forOf: true,
        module: true,
        optionalChaining: true,
        templateLiteral: true,
      },
    },

    cache: {
      type: 'filesystem',
      cacheDirectory: fileURLToPath(
        new URL('./node_modules/.cache/webpack', import.meta.url),
      ),
    },

    resolve: {
      extensions: ['.js', '.jsx', '.ts', '.tsx', '...'],
      extensionAlias: {
        '.js': ['.js', '.jsx', '.ts', '.tsx'],
      },
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },

    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
        {
          test: /\.css$/,
          use: [
            MiniCssExtractPlugin.loader,
            {
              loader: 'css-loader',
              options: {
                modules: {
                  auto: true,
                  namedExport: false,
                  exportLocalsConvention: 'as-is',
                  mode: 'local',
                  localIdentName:
                    argv.mode === 'development' ? '[local]__[hash]' : '[hash]',
                  localIdentHashFunction: 'sha256',
                  localIdentHashDigest: 'base64url',
                  localIdentHashDigestLength: 16,
                  hashStrategy: 'resource-path-and-local-name',
                },
              },
            },
          ],
        },
        {
          test: /\.(ttf|otf|woff|woff2|svg|eot)/,
          type: 'asset/resource',
          generator: {
            filename: 'static/fonts/[name].[contenthash][ext]',
          },
        },
      ],
    },

    optimization: {
      moduleIds: 'deterministic',
      chunkIds: 'deterministic',
      splitChunks: {
        chunks: 'all',
      },
    },

    plugins: [
      new HtmlPlugin({
        filename: 'index.html',
        template: 'index.html',
        scriptLoading: 'module',
        title: 'Nuke',
        meta: {
          viewport: 'width=device-width, initial-scale=1',
        },
      }),
      new MiniCssExtractPlugin({
        filename: 'static/[name]-[contenthash].css',
        chunkFilename: 'static/chunk-[id]-[contenthash].css',
      }),
    ],

    watchOptions: {
      aggregateTimeout: 300,
      poll: 1000,
      ignored: /node_modules/,
    },

    devtool: false,

    devServer: {
      compress: true,
      host: '0.0.0.0',
      port: 3000,
      historyApiFallback: true,
      hot: false,
    },

    experiments: {
      outputModule: true,
    },
  };
};
