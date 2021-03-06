'use strict';

var fs = require('fs');
var path = require('path');
var rollupPluginutils = require('rollup-pluginutils');
var sass = require('sass');
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

var exported = [];

module.exports = function(options) {
    var filter = rollupPluginutils.createFilter(options.include || ['**/*.scss', '**/*.sass'], options.exclude);
    var importer = options.importer || nodeResolver;
    var processor = options.processor || (function (code) { return global.Promise.resolve(code); });
    var defaults = options.options || {};
    var file;
    var active = [];
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
            active.push.apply(active, matches);
            var jsCode = matches.map(function (url, index) { return ("import STYLE_" + index + " from '" + url + "';"); }).join('\n');
            if (active.indexOf(id) !== -1) {
                active.splice(active.indexOf(id), 1);
                jsCode += '\nexport default \'\';';
                return global.Promise.resolve({
                    code: jsCode,
                    map: { mappings: '' },
                });
            }
            exported.push(id);
            var sassOptions = Object.assign({
                file: id,
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
                var post = processor(inline(result.css));
                if (!(post instanceof global.Promise)) {
                    post = global.Promise.resolve(post);
                }
                return post.then(function (css) {
                    if (options.insert) {
                        jsCode += stylize(css);
                    } else {
                        jsCode += "export default '" + css + "';";
                    }
                    return global.Promise.resolve({
                        code: jsCode,
                        map: { mappings: '' },
                    });
                });
            });
        },
        ongenerate: function ongenerate(options) {
            var promise = global.Promise.resolve();
            if (defaults.outFile) {
                file = '';
                exported.forEach(function (id) {
                    var sassOptions = Object.assign({
                        file: id,
                        includePaths: includePaths,
                        importer: function (url, prev) { return importer(url, prev, options); },
                    }, defaults);
                    var css = sass.renderSync(sassOptions).css.toString();
                    var post = processor(css);
                    if (!(post instanceof global.Promise)) {
                        post = global.Promise.resolve(post);
                    }
                    promise = promise.then(function () { return post.then(function (css) {
                            file += css;
                        }); }
                    );
                });
            }
            return promise;
        },
        onwrite: function onwrite() {
            if (defaults.outFile && file) {
                fs.writeFileSync(defaults.outFile, file);
                file = null;
                return global.Promise.resolve();
            }
        },
    };
};
