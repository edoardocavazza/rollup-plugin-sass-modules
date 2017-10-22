import buble from 'rollup-plugin-buble';

export default {
    entry: 'index.js',
    format: 'cjs',
    dest: 'dist/rollup-plugin-sass-modules.js',
    external: [
        'fs',
        'path',
        'resolve',
        'node-sass',
        'rollup-pluginutils',
    ],
    plugins: [
        buble(),
    ],
};
