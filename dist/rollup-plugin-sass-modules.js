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
    return ("\n\n(function(){\n    const head = document.head || document.getElementsByTagName('head')[0];\n    const style = document.createElement('style');\n    style.textContent = '" + css + "';\n    head.appendChild(style);\n})();\n");
}

function alternatives(url) {
    var res = path.extname(url) ?
        [url] :
        STYLE_EXTENSIONS.map(function (ext) { return ("" + url + ext); });
    if (path.basename(url) !== '_') {
        for (var i = 0, len = res.length; i < len; i++) {
            res.push(
                path.join(
                    path.dirname(res[i]),
                    ("_" + (path.basename(res[i])))
                )
            );
        }
    }
    return res;
}

function nodeResolver(url, prev, options) {
    var mod;
    if (!url.match(/^[./]/)) {
        if (url[0] === '~') {
            mod = url.substring(1);
        } else {
            var toCheck = alternatives(path.join(path.dirname(prev), url));
            var resolved = toCheck.find(function (f) { return fs.existsSync(f); });
            if (resolved) {
                url = resolved;
            } else {
                mod = url;
            }
        }
    }
    if (mod) {
        var toCheck$1 = alternatives(mod);
        var ok = false;
        toCheck$1.forEach(function (modCheck) {
            if (!ok) {
                try {
                    url = resolve.sync(modCheck, {
                        basedir: path.dirname(prev) || process.cwd(),
                    });
                    var base = path.join(url.replace(modCheck, ''), '**/*');
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
        var toCheck$2 = alternatives(path.resolve(path.dirname(prev), url));
        url = toCheck$2.find(function (f) { return fs.existsSync(f); });
    }
    return {
        file: url,
        contents: options ? fs.readFileSync(url, 'utf8') : '',
    };
}

function inline(str) {
    if ( str === void 0 ) str = '';

    return str.toString()
        .replace(/\\/g, '\\\\')
        .replace(/'/g, '\\\'')
        .replace(/\n/g, '');
}

module.exports = function(options) {
    var filter = rollupPluginutils.createFilter(options.include || ['**/*.scss', '**/*.sass'], options.exclude);
    var importer = options.importer || nodeResolver;
    var processor = options.processor || (function (code) { return global.Promise.resolve(code); });
    var defaults = options.options || {};
    var file;
    var css;
    var last;
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
            return new global.Promise(function (resolve, reject) {
                sass.render(sassOptions, function (err, result) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(result);
                    }
                });
            }).then(function (result) {
                css = inline(result.css);
                var post = processor(css);
                if (!(post instanceof global.Promise)) {
                    post = global.Promise.resolve(post);
                }
                return post.then(function (css) {
                    if (options.insert) {
                        jsCode += stylize(css);
                    } else {
                        jsCode += "export default '" + css + "';";
                    }
                    last = id;
                    return global.Promise.resolve({
                        code: jsCode,
                        map: { mappings: '' },
                    });
                });
            }).catch(function (err) {
                last = id;
                if (STYLE_EXTENSIONS.indexOf(path.extname(last)) !== -1) {
                    jsCode += "\nexport default '" + (inline(err)) + "';";
                    return global.Promise.resolve({
                        code: jsCode,
                        map: { mappings: '' },
                    });
                }
                return global.Promise.reject(err);
            });
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
