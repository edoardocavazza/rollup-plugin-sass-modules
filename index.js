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

function alternatives(url) {
    let res = path.extname(url) ?
        [url] :
        STYLE_EXTENSIONS.map((ext) => `${url}${ext}`);
    if (path.basename(url) !== '_') {
        for (let i = 0, len = res.length; i < len; i++) {
            res.push(
                path.join(
                    path.dirname(res[i]),
                    `_${path.basename(res[i])}`
                )
            );
        }
    }
    return res;
}

function nodeResolver(url, prev, options) {
    let mod;
    if (!url.match(/^[./]/)) {
        if (url[0] === '~') {
            mod = url.substring(1);
        } else {
            let toCheck = alternatives(path.join(path.dirname(prev), url));
            let resolved = toCheck.find((f) => fs.existsSync(f));
            if (resolved) {
                url = resolved;
            } else {
                mod = url;
            }
        }
    }
    if (mod) {
        let toCheck = alternatives(mod);
        let ok = false;
        toCheck.forEach((modCheck) => {
            if (!ok) {
                try {
                    url = resolve.sync(modCheck, {
                        basedir: path.dirname(prev) || process.cwd(),
                    });
                    let base = path.join(url.replace(modCheck, ''), '**/*');
                    if (includePaths.indexOf(base) === -1) {
                        includePaths.push(base);
                    }
                    ok = true;
                } catch (ex) {
                    //
                }
            }
        });
    } else if (!path.isAbsolute(url)) {
        let toCheck = alternatives(path.resolve(path.dirname(prev), url));
        url = toCheck.find((f) => fs.existsSync(f));
    }
    return {
        file: url,
        contents: options ? fs.readFileSync(url, 'utf8') : '',
    };
}

module.exports = function(options) {
    const filter = rollupPluginutils.createFilter(options.include || ['**/*.scss', '**/*.sass'], options.exclude);
    const importer = options.importer || nodeResolver;
    const processor = options.processor || ((code) => global.Promise.resolve(code));
    const defaults = options.options || {};
    let file;
    let css;
    let last;
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
            return new global.Promise((resolve, reject) => {
                sass.render(sassOptions, (err, result) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(result);
                    }
                });
            }).then((result) => {
                let jsMaps;
                css = result.css.toString()
                    .replace(/\\/g, '\\\\')
                    .replace(/'/g, '\\\'')
                    .replace(/\n/g, '');
                if (result.map) {
                    jsMaps = result.map.toString();
                }
                let post = processor(css);
                if (!(post instanceof global.Promise)) {
                    post = global.Promise.resolve(post);
                }
                return post.then((css) => {
                    if (options.insert) {
                        jsCode += stylize(css);
                    } else {
                        jsCode += `export default '${css}';`;
                    }
                    last = id;
                    return global.Promise.resolve({
                        code: jsCode,
                        map: jsMaps ? jsMaps : { mappings: '' },
                    });
                });
            }).catch((err) => {
                last = id;
                if (STYLE_EXTENSIONS.indexOf(path.extname(last)) !== -1) {
                    return global.Promise.resolve({
                        code: jsCode,
                        map: { mappings: '' },
                    });
                }
                return global.Promise.reject(err);
            });
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