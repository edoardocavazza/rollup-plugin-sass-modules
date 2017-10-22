'use strict';

var fs = require('fs');
var path = require('path');
var rollupPluginutils = require('rollup-pluginutils');
var sass = require('node-sass');
var resolve = require('resolve');
var importRegex = /@import[\s'"]*([^;'"]*)[;'"]/g;
var includePaths = ['node_modules'];

function stylize(css) {
    return ("\n\n(function(){\n    const head = document.head || document.getElementsByTagName('head')[0];\n    const style = document.createElement('style');\n    style.textContent = '" + (css.replace(/\n/g, '')) + "';\n    head.appendChild(style);\n})();\n");
}

function nodeResolver(url, prev, options) {
    var mod;
    if (!url.match(/^[./]/)) {
        if (url[0] === '~') {
            mod = url.substring(1);
        } else {
            var tryToResolve = path.resolve(path.dirname(prev), url);
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
            var base = path.join(url.replace(mod, ''), '**/*');
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
    var filter = rollupPluginutils.createFilter(options.include || ['**/*.scss', '**/*.sass'], options.exclude);
    var importer = options.importer || nodeResolver;
    var defaults = options.options || {};
    var resolved = [];
    var files = [];
    var css;
    return {
        name: 'sass-modules',
        transform: function transform(code, id) {
            if (!filter(id)) { return null; }
            if (resolved.indexOf(id) === -1) {
                resolved = [];
            }
            var match = importRegex.exec(code);
            var matches = [];
            while (match) {
                matches.push(match[1]);
                match = importRegex.exec(code);
            }
            matches = matches.map(function (url) { return importer(url, id).file; });
            var jsCode = matches.map(function (url) { return ("import '" + url + "';"); }).join('\n');
            var jsMaps;
            if (resolved.length === 0) {
                var sassOptions = Object.assign({
                    file: id,
                    data: code,
                    includePaths: includePaths,
                    importer: function (url, prev) { return importer(url, prev, options); },
                }, defaults);
                var rendered = sass.renderSync(sassOptions);
                css = rendered.css.toString();
                if (options.insert) {
                    jsCode += stylize(css.replace(/'/g, '\\\''));
                } else if (!defaults.outFile) {
                    jsCode += "\nexport default '" + (css.replace(/'/g, '\\\'')) + "'";
                } else {
                    files.push(css);
                }
                if (rendered.map) {
                    jsMaps = rendered.map.toString();
                }
            }
            matches.forEach(function (url) {
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
        onwrite: function onwrite() {
            if (defaults.outFile) {
                fs.writeFileSync(defaults.outFile, files.join('\n'));
                return global.Promise.resolve();
            }
        },
    };
};
