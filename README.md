
# Rollup Plugin Sass Modules

Import and compile SASS files with [rollup](https://rollupjs.org/). It supports sourcemaps and import from `node_modules`.

## Features

- Compile SASS files with `sass`.
- Export dependencies tree to `rollup`.
- Support for sourcemaps.
- Extract CSS files.

## Installation

```
npm install rollup-plugin-sass-modules --save-dev
```

## Usage

```
import sassModules from 'rollup-plugin-sass-modules'

export default {
    plugins: [
        sassModules({
            include: ['**/*.scss', '**/*.sass'],
            exclude: [],
            options: { ... }
        }),
    ],
}
```

## Options

### `include`

minimatch glob pattern (or array) of files to include.

### `exclude`

minimatch glob pattern (or array) of files to exclude.

### `options`

See `dart-sass` [options](https://github.com/sass/dart-sass#javascript-api).

If `outFile` option is provided, the plugin will automatically extract and write the compiled CSS.

### `processor` (code) => Promise<{ code, map }>

Post processor function.