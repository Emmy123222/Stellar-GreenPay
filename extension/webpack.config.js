const path = require('path');

module.exports = {
  mode: 'production',
  devtool: 'source-map',
  entry: {
    popup: './src/popup.ts',
    settings: './src/settings.ts',
    'content-script': './src/content-script.ts',
    background: './src/background.ts',
  },
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, 'dist'),
    clean: true,
  },
  resolve: {
    extensions: ['.ts', '.js'],
    fallback: {
      buffer: false,
      crypto: false,
      stream: false,
      util: false,
      url: false,
      http: false,
      https: false,
      os: false,
      path: false,
      fs: false,
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  optimization: {
    minimize: true,
  },
};
