const fs = require('fs');
const path = require('path');
const webpack = require('webpack');

const ICON_SIZES = [16, 32, 48, 128];

// Both manifests declare `icons/icon-<size>.png` relative to the extension
// root, so the unpacked extension and the store zip carry them from there.
// This mirrors the same files into `dist/` so the build output (the artifact CI
// uploads) is self-contained, and fails the build if a declared size is missing
// instead of shipping a manifest that points at nothing.
class CopyIconsPlugin {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap('CopyIconsPlugin', (compilation) => {
      for (const size of ICON_SIZES) {
        const source = path.resolve(__dirname, `icons/icon-${size}.png`);
        if (!fs.existsSync(source)) {
          throw new Error(
            `Missing extension icon ${source}; generate it from store-assets/icon-128.png`,
          );
        }
        compilation.emitAsset(
          `icons/icon-${size}.png`,
          new webpack.sources.RawSource(fs.readFileSync(source)),
        );

        const darkSource = path.resolve(__dirname, `icons/icon-dark-${size}.png`);
        if (fs.existsSync(darkSource)) {
          compilation.emitAsset(
            `icons/icon-dark-${size}.png`,
            new webpack.sources.RawSource(fs.readFileSync(darkSource)),
          );
        }
      }
    });
  }
}

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
  mode: "production",
  devtool: "source-map",
  entry: {
    popup: "./src/popup.ts",
    settings: "./src/settings.ts",
    "content-script": "./src/content-script.ts",
    background: "./src/background.ts",
  },
  output: {
    filename: "[name].js",
    path: path.resolve(__dirname, "dist"),
    clean: true,
  },
  resolve: {
    extensions: [".ts", ".js", ".css"],
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
        use: "ts-loader",
        exclude: [/node_modules/, /\.test\.ts$/, /\.spec\.ts$/],
      },
      {
        test: /\.css$/i,
        use: ["style-loader", "css-loader"],
      },
    ],
  },
  performance: {
    hints: false,
  },
  plugins: [new CopyIconsPlugin()],
  optimization: {
    minimize: true,
  },
};