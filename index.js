const fs = require('fs');
const path = require('path');
const rollupPluginutils = require('rollup-pluginutils');
const sass = require('node-sass');
const resolve = require('resolve');
const importRegex = /@import[\s'"]*([^;'"]*)[;'"]/g;
const includePaths = ['node_modules'];

function stylize(css) {
    return `

(function(){
    const head = document.head || document.getElementsByTagName('head')[0];
    const style = document.createElement('style');
    style.textContent = '${css.replace(/\n/g, '')}';
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
    let resolved = [];
    let files = [];
    let css;
    return {
        name: 'sass-modules',
        transform(code, id) {
            if (!filter(id)) { return null; }
            if (resolved.indexOf(id) === -1) {
                resolved = [];
            }
            let match = importRegex.exec(code);
            let matches = [];
            while (match) {
                matches.push(match[1]);
                match = importRegex.exec(code);
            }
            matches = matches.map((url) => importer(url, id).file);
            let jsCode = matches.map((url) => `import '${url}';`).join('\n');
            let jsMaps;
            if (resolved.length === 0) {
                let sassOptions = Object.assign({
                    file: id,
                    data: code,
                    includePaths,
                    importer: (url, prev) => importer(url, prev, options),
                }, defaults);
                let rendered = sass.renderSync(sassOptions);
                css = rendered.css.toString();
                if (options.insert) {
                    jsCode += stylize(css.replace(/'/g, '\\\''));
                } else if (!defaults.outFile) {
                    jsCode += `\nexport default '${css.replace(/'/g, '\\\'')}'`;
                } else {
                    files.push(css);
                }
                if (rendered.map) {
                    jsMaps = rendered.map.toString();
                }
            }
            matches.forEach((url) => {
                if (resolved.indexOf(url) === -1) {
                    resolved.push(url);
                }
            });
            if (jsMaps) {
                return {
                    code: jsCode,
                    map: jsMaps,
                };
            }
            return jsCode;
        },
        onwrite() {
            if (defaults.outFile) {
                fs.writeFileSync(defaults.outFile, files.join('\n'));
                return global.Promise.resolve();
            }
        },
    };
};