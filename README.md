# Electron React Quick Start

> A bare minimum project structure to get started developing with Electron & React

Thanks to the power of `electron-webpack` this template comes packed with...

- Use of [`webpack-dev-server`](https://github.com/webpack/webpack-dev-server) for development
- HMR for both `renderer` and `main` processes
- Use of [`babel-preset-env`](https://github.com/babel/babel-preset-env) that is automatically configured based on your `electron` version
- Use of [`electron-builder`](https://github.com/electron-userland/electron-builder) to package and build a distributable electron application

## Getting Started

Simply clone down this repository, install dependencies, and get started on your application.

```bash
git clone https://github.com/abdullah-bl/base
cd base
rm -rf .git

# install dependencies
yarn
```

### Development Scripts

```bash
# run application in development mode
yarn dev

# compile source code and create webpack output
yarn compile

# `yarn compile` & create build with electron-builder
yarn dist

# `yarn compile` & create unpacked build with electron-builder
yarn dist:dir
```

# base
