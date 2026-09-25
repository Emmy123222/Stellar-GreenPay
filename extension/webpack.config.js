const fs = require('fs');
const path = require('path');
const webpack = require('webpack');

function contractDefines() {
  const p = path.resolve(__dirname, '../contracts/addresses.json');
  if (!fs.existsSync(p)) return {};
  const addresses = JSON.parse(fs.readFileSync(p, 'utf8'));
  const net = addresses.testnet || {};
  return {
    __GREENPAY_CONTRACT_ID__: JSON.stringify(net.greenpay || ''),
    __ESCROW_CONTRACT_ID__: JSON.stringify(net.escrow || ''),
  };
}

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
  plugins: [
    new webpack.DefinePlugin(contractDefines()),
  ],
  optimization: {
    minimize: true,
  },
};
