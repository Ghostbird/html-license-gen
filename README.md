# HTML License Generator for NPM/Yarn based projects

Generate a HTML page with list of dependency licenses based on npm/yarn installed packages. [Example output](https://dlvoy.github.io/html-license-gen/example_licenses)

This project is based on [npm-license-generator](https://github.com/mymindstorm/npm-license-generator)

## Usage

Install:

```bash
npm install --global html-license-gen
```

Options:

```bash
$ html-license-gen --help

Usage:
  html-license-gen [folder]

Positionals:
  folder  Folder of NPM project. Defaults to current working directory  [string]

Paths and files:
  --folder           Folder of NPM project. Defaults to current working
                     directory                                          [string]
  --out-path         HTML output path      [string] [default: "./licenses.html"]
  --tmp-folder-name  Name of temporary folder
                                          [string] [default: ".license-gen-tmp"]

Output HTML appearance:
  --group           Group licenses                     [boolean] [default: true]
  --external-links  Link package names to their repos  [boolean] [default: true]
  --add-index       Creates index with link to licenses below
                                                      [boolean] [default: false]
  --title           Use given value as document title  [string] [default: false]
  --template        Path to custom mustache template                    [string]

Package related:
  --registry      URL of package registry to use
                                [string] [default: "https://registry.npmjs.org"]
  --ignored       Semicolon-separated list of packages to ignore
                                          [string] [default: "html-license-gen"]
  --only-prod     Ignore optional and dev dependencies[boolean] [default: false]
  --package-lock  Run on all packages listed in package-lock.json
                                                      [boolean] [default: false]

Cache and optimization:
  --keep-cache      Do not clean cache after run      [boolean] [default: false]
  --checksum-path   Checksum file path, to detect if update of HTML is needed
                                                       [string] [default: false]
  --checksum-embed  Embed checksum into HTML to detect need for update
                                                      [boolean] [default: false]
  --avoid-registry  Try local package.json instead asking online registry
                                                       [boolean] [default: true]
  --no-spdx         Do not download license file based on SPDX string
                                                      [boolean] [default: false]
  --only-spdx       Do not use tarballs, only use SPDX string
                                                      [boolean] [default: false]
  --only-local-tar  Do not download tarballs, use only local tarballs
                                                       [boolean] [default: true]

Options:
  --version        Show version number                                 [boolean]
  --help           Show help                                           [boolean]
  --error-missing  Exit 1 if no license is present for a package
                                                      [boolean] [default: false]
```

## Options

All boolean options can be prepended with `no-` that negates flag, 
for example; `--group` groups packages but `--no-group` disables grouping.

* `--error-missing`, `--no-error-missing`
  If enabled, stops and exits generator (without generating/updating HTML file) when any expected license is missing
  **Disabled** by default.
  <br>

### Path related options:

* `--folder` 
  Specify root directory of project to parse, by default current directory
  <br>
* `--out-path` 
  Specify output path where generated file will be written.
  File is always overwritten unless `--checksum-path` or `--checksum-embed` is used and no change is needed.
  <br>
* `--tmp-folder-name` 
  Specify folder where to download tarballs. Folder need to be writable.
  Folder and its contents gets deleted after generating file unless `--keep-cache` options is given.

### Output and HTML appearance options:

* `--group`, `--no-group` 
  Groups packages which use exact same license texts, reducing duplicates and file size.
  Enabled by default.
  <br>
* `--external-links`, `--no-external-links`
  Links package names (in license header) to their homepages (if and as configured in package.json `homepage`)
  Enabled by default.
  <br>
* `--add-index`, `--no-add-index`
  Creates index at begin of file - list of anchors allowing quickly jumping to respective package library. 
  **Disabled** by default.
  <br>
* `--title`
  Overrides default document title / main header (which is root app package name) with given string.
  <br>
* `--template`
  Overrides default template path, allowing passing custom template.
  <br>

### Package filtering and configuration:

* `--registry`
  Allows specifying URL of custom NPM repository, otherwise default global NPM repo is used
  <br>
* `--ignored`
  Semicolon-separated list of packages to ignore and NOT include in generated HTML.
  For example: `typescript;eslint;tar`
  <br>
* `--only-prod`, `--no-only-prod`
  If enabled, ignores optional and development packages, using only "production" facing packages
  **Disabled** by default.
  <br>
* `--package-lock`, `--no-package-lock`
  Instead of relying solely on `package.json` - also scan lock files to include all dependencies and sub-dependencies.
  Generates bigger file but include also dependencies of dependencies, not only direct deps.
  Recommended to use with `--only-prod` (which would otherwise be huge) and without `--no-avoid-registry` which generates a lot of network requests to registry
  **Disabled** by default.

### Cache and optimization:

* `--keep-cache`, `--no-keep-cache`
  If enabled, does not delete tmp folder, allowing cache to persist between runs
  **Disabled** by default.
  <br>
* `--checksum-path`
  Allows skipping generation of HTM when packages have not changed.
  If path is specified, special file indicated by path is used to store checksum.
  If file exist and contains checksum matching checksum resolved for current package/version list - HTML generation **will be skipped**
  After generating HTML file, checksum is written/updated int this file.
  **NOTICE** - it does NOT checks for changes in license files, only if package list (and their version) are same.
  <br>
* `--checksum-embed`, `--no-checksum-embed`
  Allows skipping generation of HTM when packages have not changed.
  If specified, embed checksum inside generated HTML (as an comment)
  If existing HTML checksum matching checksum resolved for current package/version list - HTML generation **will be skipped**
  **NOTICE** - it does NOT checks for changes in license files, only if package list (and their version) are same.
  **Disabled** by default.
  <br>
* `--avoid-registry`, `--no-avoid-registry`
  By default, instead asking online NPM repo, uses `package.json` files found in `node_modules`.
  It is way faster but may be inaccurate.
  Enabled by default.
  <br>
* `--no-spdx`
  If enabled, does not use SPDX license repository as fallback for missing licenses
  **Disabled** by default.
  <br>
* `--no-spdx`
  If enabled, use only SPDX license repository and do not use license files found in packages/tarballs
  **Disabled** by default.
  <br>
* `--only-local-tar`, `--no-only-local-tar`
  By default, use only local filesystem and tarballs for license discovery.
  `--no-only-local-tar` will enable downloading tarballs from resolved online URLs - but this may generate lot of internet traffic, especially when used together with `--package-lock` or without `--only-prod`
  Enabled by default.

## Use your own template

Supply your own template using the `--template` option. Templates are written in [Mustache](https://mustache.github.io/). Your template does not have to be HTML, change the output file name using `--out-path`.

Use `template.html` file as and starting point

## How licenses are found

1. Get package version and tarball location from package.lock / yarn.lock
2. Look for licenses in node_modules if avalible
3. Otherwise download tarball, extract, look for licenses, and use that
4. Otherwise, evaluate SPDX string and use a file from https://github.com/spdx/license-list-data/tree/master/text
