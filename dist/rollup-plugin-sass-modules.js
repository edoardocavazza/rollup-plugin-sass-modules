'use strict';

var fs = require('fs');
var path = require('path');
var rollupPluginutils = require('rollup-pluginutils');
var sass = require('node-sass');
var resolve = require('resolve');
var importRegex = /@import[\s'"]*([^;'"]*)[;'"]/g;
var includePaths = ['node_modules'];
var STYLE_EXTENSIONS = ['.scss', '.sass', '.css'];

function stylize(css) {
    return ("\n\n(function(){\n    const head = document.head || document.getElementsByTagName('head')[0];\n    const style = document.createElement('style');\n    style.textContent = '" + (css.replace(/'/g, '\\\'').replace(/\n/g, '')) + "';\n    head.appendChild(style);\n})();\n");
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
    var file;
    var css;
    return {
        name: 'sass-modules',
        transform: function transform(code, id) {
            if (!filter(id)) { return null; }
            var match = importRegex.exec(code);
            var matches = [];
            while (match) {
                matches.push(match[1]);
                match = importRegex.exec(code);
            }
            matches = matches.map(function (url) { return importer(url, id).file; });
            var jsCode = '';
            jsCode += matches.map(function (url, index) { return ("import STYLE_" + index + " from '" + url + "';"); }).join('\n');
            var sassOptions = Object.assign({
                file: id,
                data: code,
                includePaths: includePaths,
                importer: function (url, prev) { return importer(url, prev, options); },
            }, defaults);
            sassOptions.omitSourceMapUrl = true;
            sassOptions.sourceMapEmbed = false;
            var rendered = sass.renderSync(sassOptions);
            var jsMaps;
            css = rendered.css.toString();
            if (rendered.map) {
                jsMaps = rendered.map.toString();
            }
            if (options.insert) {
                jsCode += stylize(css);
            } else {
                jsCode += "export default `" + css + "`";
            }
            return {
                code: jsCode,
                map: jsMaps ? jsMaps : { mappings: '' },
            };
        },
        ongenerate: function ongenerate(options) {
            if (defaults.outFile) {
                file = '';
                var bundle = options.bundle;
                bundle.modules.forEach(function (mod) {
                    if (STYLE_EXTENSIONS.indexOf(path.extname(mod.id)) === -1) {
                        mod.dependencies.forEach(function (dep) {
                            if (STYLE_EXTENSIONS.indexOf(path.extname(dep)) !== -1) {
                                var sassOptions = Object.assign({
                                    file: dep,
                                    data: fs.readFileSync(dep, 'utf8'),
                                    includePaths: includePaths,
                                    importer: function (url, prev) { return importer(url, prev, options); },
                                }, defaults);
                                file += sass.renderSync(sassOptions).css.toString();
                            }
                        });
                    }
                });
            }
        },
        onwrite: function onwrite() {
            if (defaults.outFile && file) {
                fs.writeFileSync(defaults.outFile, file);
                return global.Promise.resolve();
            }
        },
    };
};
