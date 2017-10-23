const fs = require('fs');
const path = require('path');
const rollupPluginutils = require('rollup-pluginutils');
const sass = require('node-sass');
const resolve = require('resolve');
const importRegex = /@import[\s'"]*([^;'"]*)[;'"]/g;
const includePaths = ['node_modules'];
const STYLE_EXTENSIONS = ['.scss', '.sass', '.css'];

function stylize(css) {
    return `

(function(){
    const head = document.head || document.getElementsByTagName('head')[0];
    const style = document.createElement('style');
    style.textContent = '${css}';
    head.appendChild(style);
})();
`;
}

function nodeResolver(url, prev, options) {
    let mod;
    if (!url.match(/^[./]/)) {
        if (url[0] === '~') {
            mod = url.substring(1);
        } else {
            let tryToResolve = path.resolve(path.dirname(prev), url);
            if (!fs.existsSync(tryToResolve)) {
                mod = url;
            }
        }
    }
    if (mod) {
        try {
            url = resolve.sync(mod, {
                basedir: path.dirname(prev) || process.cwd(),
            });
            let base = path.join(url.replace(mod, ''), '**/*');
            if (includePaths.indexOf(base) === -1) {
                includePaths.push(base);
            }
        } catch (ex) {
            //
        }
    } else {
        url = path.resolve(path.dirname(prev), url);
    }
    return {
        file: url,
        contents: options ? fs.readFileSync(url, 'utf8') : '',
    };
}

module.exports = function(options) {
    const filter = rollupPluginutils.createFilter(options.include || ['**/*.scss', '**/*.sass'], options.exclude);
    const importer = options.importer || nodeResolver;
    const defaults = options.options || {};
    let file;
    let css;
    return {
        name: 'sass-modules',
        transform(code, id) {
            if (!filter(id)) { return null; }
            let match = importRegex.exec(code);
            let matches = [];
            while (match) {
                matches.push(match[1]);
                match = importRegex.exec(code);
            }
            matches = matches.map((url) => importer(url, id).file);
            let jsCode = '';
            jsCode += matches.map((url, index) => `import STYLE_${index} from '${url}';`).join('\n');
            let sassOptions = Object.assign({
                file: id,
                data: code,
                includePaths,
                importer: (url, prev) => importer(url, prev, options),
            }, defaults);
            sassOptions.omitSourceMapUrl = true;
            sassOptions.sourceMapEmbed = false;
            let rendered = sass.renderSync(sassOptions);
            let jsMaps;
            css = rendered.css.toString()
                .replace(/\\/g, '\\\\')
                .replace(/'/g, '\\\'')
                .replace(/\n/g, '');
            if (rendered.map) {
                jsMaps = rendered.map.toString();
            }
            if (options.insert) {
                jsCode += stylize(css);
            } else {
                jsCode += `export default '${css}';`;
            }
            return {
                code: jsCode,
                map: jsMaps ? jsMaps : { mappings: '' },
            };
        },
        ongenerate(options) {
            if (defaults.outFile) {
                file = '';
                let bundle = options.bundle;
                bundle.modules.forEach((mod) => {
                    if (STYLE_EXTENSIONS.indexOf(path.extname(mod.id)) === -1) {
                        mod.dependencies.forEach((dep) => {
                            if (STYLE_EXTENSIONS.indexOf(path.extname(dep)) !== -1) {
                                let sassOptions = Object.assign({
                                    file: dep,
                                    data: fs.readFileSync(dep, 'utf8'),
                                    includePaths,
                                    importer: (url, prev) => importer(url, prev, options),
                                }, defaults);
                                file += sass.renderSync(sassOptions).css.toString();
                            }
                        });
                    }
                });
            }
        },
        onwrite() {
            if (defaults.outFile && file) {
                fs.writeFileSync(defaults.outFile, file);
                return global.Promise.resolve();
            }
        },
    };
};