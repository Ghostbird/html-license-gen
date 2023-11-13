import superagent from 'superagent';
import { URL } from 'url';
import process from 'process';
import path from 'path';
import fs from 'fs';
import rimraf from 'rimraf';
import yargs from 'yargs';
import tar from 'tar';
import mustache from 'mustache';
import spdx from 'spdx-expression-parse';
// @ts-expect-error We do not have types for that
import cacheModule from 'cache-service-cache-module';
// @ts-expect-error We do not have types for that
import cachePlugin from 'superagent-cache-plugin';
import { yarnToNpm } from 'synp';

import crypto from 'crypto';

const cache = new cacheModule();
const superagentCache = cachePlugin(cache);

let CWD = '';
let REGISTRY = '';
let PKG_JSON_PATH = '';
let PKG_LOCK_JSON_PATH = '';
let YARN_LOCK_PATH = '';
let NODE_MODULES_PATH = '';
let TMP_FOLDER_PATH = '';
let OUT_PATH = '';
let TEMPLATE_PATH = '';
let GROUP = true;
let RUN_PKG_LOCK = false;
let NO_SPDX = false;
let ONLY_SPDX = false;
let ONLY_LOCAL_TAR = true;
let ERR_MISSING = false;
let EXTERNAL_LINKS = true;
let ADD_INDEX = false;
let TITLE = false;
let IGNORED = 'html-license-gen';
let ONLY_PROD = false;
let KEEP_CACHE = false;
let CHECKSUM_PATH: string | boolean = false;
let CHECKSUM_EMBED = false;
let AVOID_REGISTRY = true;

const NO_MATCH_EXTENSIONS = ['js', 'ts', 'd.ts', 'c', 'cpp', 'h', 'class', 'pl', 'sh'];

function getAllFiles(dirPath: string, arrayOfFiles?: string[]): string[] {
  const files = fs.readdirSync(dirPath);

  arrayOfFiles = arrayOfFiles || [];

  files.forEach(function (file) {
    if (fs.statSync(dirPath + '/' + file).isDirectory()) {
      arrayOfFiles = getAllFiles(path.join(dirPath, file), arrayOfFiles);
    } else {
      arrayOfFiles?.push(path.join(dirPath, file));
    }
  });

  return arrayOfFiles;
}

function fixedName(name: string): string {
  if (name.startsWith('@')) {
    return name.substring(1);
  } else {
    return name;
  }
}

function filterUnique(pkgs: GroupedLicensePkg[]): GroupedLicensePkg[] {
  const unique = new Map<string, GroupedLicensePkg>();
  pkgs.forEach((pkg) => {
    if (!unique.has(pkg.name)) {
      unique.set(pkg.name, pkg);
    }
  });

  return Array.from(unique.values());
}

async function getPkgLicense(pkg: PkgInfo): Promise<LicenseInfo> {
  const license: LicenseInfo = {
    pkg: pkg,
    type: '',
    uid: '',
    texts: {},
  };

  let hasLicenseInfo = false;

  if (AVOID_REGISTRY) {
    const packageLocalFile = path.resolve(CWD, pkg.localPackageFile);

    hasLicenseInfo = await new Promise<boolean>((resolve) => {
      if (fs.existsSync(packageLocalFile)) {
        const pkgPayload = fs.readFileSync(packageLocalFile, 'utf8');
        const pkgInfo: PkgJsonData = JSON.parse(pkgPayload);
        if (pkgInfo.license) {
          license.type = pkgInfo.license;
        } else {
          console.error(`Could not find license info in local package.json for ${pkg.name} ${pkg.version}`);
          resolve(false);
          return license;
        }
        license.pkg.shortLink = crypto.createHash('sha1').update(pkg.name).digest('hex').substring(0, 12);
        license.pkg.homepage = EXTERNAL_LINKS ? pkgInfo.homepage : undefined;
        if (!pkg.tarball) {
          resolve(false);
          return license;
        }
        resolve(true);
      } else {
        console.error(`Cannot parse local package: ${pkg.localPackageFile}`);
        resolve(false);
      }
    });
  }

  // Get package info from registry
  if (!hasLicenseInfo) {
    const url = new URL(REGISTRY);
    url.pathname = pkg.name;
    if (AVOID_REGISTRY) {
      console.log(`Checking ${pkg.name} in online registry: ${url}`);
    }
    // Get registry info
    await new Promise<boolean>((resolve) => {
      superagent
        .get(url.toString())
        .then((res) => {
          license.type = res.body.license;
          if (!res.body.license) {
            try {
              license.type = res.body.versions[pkg.version].license;
            } catch (e) {
              console.error(`Could not find license info in registry for ${pkg.name} ${pkg.version}`);
              resolve(false);
              return license;
            }
          }
          license.pkg.shortLink = crypto.createHash('sha1').update(pkg.name).digest('hex').substring(0, 12);
          license.pkg.homepage = EXTERNAL_LINKS ? res.body.homepage || res.body.repository?.url : false;
          if (!pkg.tarball) {
            try {
              pkg.tarball = res.body.versions[pkg.version].dist.tarball;
            } catch (e) {
              console.error(`Could not find version info for ${pkg.name} ${pkg.version}`);
              resolve(false);
              return license;
            }
          }
          resolve(true);
        })
        .catch((e) => {
          if (e?.status) {
            console.warn(`Could not get info from registry for ${pkg.name}! HTTP status code ${e.status}`);
          } else {
            console.warn(`Could not get info from registry for ${pkg.name}! Error: ${e}`);
          }
          resolve(false);
          return license;
        });
    });
  }

  // look for license in node_modules
  if (!ONLY_SPDX) {
    try {
      let files = getAllFiles(path.join(NODE_MODULES_PATH, pkg.name));
      files = files.filter((path) => {
        const regex = /[/\\](LICENSE|LICENCE|COPYING|COPYRIGHT)\.?.*/gim;
        const extension = path.split('.');
        if (NO_MATCH_EXTENSIONS.includes(extension[extension.length - 1])) {
          return false;
        }
        if (regex.test(path)) {
          return true;
        }
        return false;
      });
      for (const path of files) {
        console.log(`Reading license from: ${path}`);
        const text = fs.readFileSync(path).toString().trim();
        const textId = crypto.createHash('sha1').update(text).digest('hex');
        license.texts[textId] = text;
      }
    } catch (e) {
      /* empty */
    }
  }

  // Download tarball if not found locally
  const fileName = `${pkg.name.replace('/', '.')}-${pkg.version}`;
  if (!ONLY_SPDX && !ONLY_LOCAL_TAR && !Object.entries(license.texts).length) {
    const hasTarball = await new Promise<boolean>((resolve) => {
      if (!pkg.tarball) {
        console.error('No tarball location', pkg);
        resolve(false);
        return license;
      }

      if (!pkg.tarball.startsWith('https://') && !pkg.tarball.startsWith('http://')) {
        console.error('Not online location', pkg);
        resolve(false);
        return license;
      }

      console.log(`Downloading ${pkg.tarball}`);
      superagent
        .get(pkg.tarball)
        .buffer(true)
        .parse(superagent.parse['application/octet-stream'])
        .then((res) => {
          fs.writeFileSync(path.join(TMP_FOLDER_PATH, fileName + '.tgz'), res.body);
          resolve(true);
        });
    });

    if (hasTarball) {
      // Extract license
      const extractFolder = path.join(TMP_FOLDER_PATH, fileName);
      if (!fs.existsSync(extractFolder)) {
        fs.mkdirSync(extractFolder);
      }
      await tar.extract({
        cwd: extractFolder,
        file: path.join(TMP_FOLDER_PATH, fileName + '.tgz'),
        // strip: 1,
        filter: (path) => {
          const regex = /[/\\](LICENSE|LICENCE|COPYING|COPYRIGHT)\.?.*/gim;
          const extension = path.split('.');
          if (NO_MATCH_EXTENSIONS.includes(extension[extension.length - 1])) {
            return false;
          }
          if (regex.test(path)) {
            return true;
          }
          return false;
        },
      });

      // Throw license files into array
      const files = getAllFiles(extractFolder);
      for (const path of files) {
        console.log(`Reading tarball license from: ${path}`);
        const text = fs.readFileSync(path).toString().trim();
        const textId = crypto.createHash('sha1').update(text).digest('hex');
        license.texts[textId] = text;
      }
    }
  }

  if (!Object.entries(license.texts).length) {
    if (!ONLY_SPDX) {
      console.warn(`No license file found for package ${license.pkg.name}${NO_SPDX ? '' : ', using SPDX string'}.`);
    }

    try {
      if (!NO_SPDX) {
        // eslint-disable-next-line no-async-promise-executor
        await new Promise<void>(async (resolve) => {
          let parsedLicense: SPDXLicense | SPDXJunction | undefined;
          try {
            parsedLicense = spdx(license.type);
          } catch (e) {
            console.error(`Error: Could not parse license string '${license.type}' for ${license.pkg.name}!`);
            resolve();
            return;
          }
          if (!parsedLicense) {
            resolve();
            return;
          }
          const licenseStrings: string[] = [];
          if ('license' in parsedLicense) {
            licenseStrings.push(parsedLicense.license);
          } else {
            const getLicenses = (license: SPDXJunction): void => {
              if ('license' in license.left) {
                licenseStrings.push(license.left.license);
              } else {
                getLicenses(license.left);
              }

              if ('license' in license.right) {
                licenseStrings.push(license.right.license);
              } else {
                getLicenses(license.right);
              }
            };
            getLicenses(parsedLicense);
          }

          const orLaterLicenses = ['AGPL-1.0', 'AGPL-3.0', 'LGPL-2.0', 'LGPL-2.1', 'LGPL-3.0', 'GPL-1.0', 'GPL-2.0', 'GPL-3.0'];

          for (const licenseStringRaw of licenseStrings) {
            try {
              let licenseString = licenseStringRaw;
              if (orLaterLicenses.includes(licenseStringRaw)) {
                licenseString = `${licenseStringRaw}-or-later`;
              }

              await new Promise<void>((resolve, reject) => {
                const prefetchCandidate = path.join(__dirname, 'spdx', `${licenseString}.txt`);

                if (fs.existsSync(prefetchCandidate)) {
                  console.log(`Using prefetched SPDX license ${licenseString} `);
                  const prefTxt = fs.readFileSync(prefetchCandidate, 'utf8');
                  const textId = crypto.createHash('sha1').update(prefTxt).digest('hex');
                  license.texts[textId] = prefTxt;
                  resolve();
                  return;
                }

                console.log(`Downloading SPDX license ${licenseString}`);

                superagent
                  .get(`https://raw.githubusercontent.com/spdx/license-list-data/master/text/${licenseString}.txt`)
                  .use(superagentCache)
                  .then((res) => {
                    const textId = crypto.createHash('sha1').update(res.text).digest('hex');
                    license.texts[textId] = res.text;
                    resolve();
                  })
                  .catch((e) => {
                    console.warn(`Error downloading license for ${license.pkg.name}. L: ${licenseString} S: ${e.status}`);
                    reject(e);
                  });
              });
            } catch (e) {
              console.error(`Error: ${e}!`);
            }
          }
          resolve();
        });
      }
    } catch (e) {
      console.error(`Error: ${e}!`);
      return license;
    }

    if (!Object.entries(license.texts).length) {
      if (ERR_MISSING) {
        console.error(`Missing license - no file generated`);
        process.exit(1);
      } else {
        console.error(`No license file for ${license.pkg.name}, skipping...`);
      }
    }
  }

  return license;
}

function buildIndex(licenses: GroupedLicense[]) {
  const indexes: { [key: string]: IndexEntry } = {};

  licenses.forEach((license) => {
    license.pkgs.forEach((pkg) => {
      if (indexes[pkg.name]) {
        indexes[pkg.name].additional.push({
          name: `${indexes[pkg.name].additional.length + 2}`,
          link: `${license.uid}-pkg-${pkg.shortLink}`,
        });
      } else {
        indexes[pkg.name] = {
          name: pkg.name,
          link: `${license.uid}-pkg-${pkg.shortLink}`,
          additional: [],
          comma: true,
        };
      }
    });
  });

  let index = Object.values(indexes);
  index = index.sort((a, b) => fixedName(a.name).localeCompare(fixedName(b.name)));

  if (index.length > 0) {
    index[index.length - 1].comma = false;
  }

  return index;
}

async function main(): Promise<void> {
  let pkgInfo: PkgJsonData | undefined;
  let pkgLockInfo: PkgLockJsonData | undefined;
  try {
    console.log(`Parsing package file: ${PKG_JSON_PATH}`);
    const pkgJson = fs.readFileSync(PKG_JSON_PATH, 'utf8');
    pkgInfo = JSON.parse(pkgJson);
    if (fs.existsSync(PKG_LOCK_JSON_PATH)) {
      const pkgLockJson = fs.readFileSync(PKG_LOCK_JSON_PATH, 'utf8');
      pkgLockInfo = JSON.parse(pkgLockJson);
    }

    if (fs.existsSync(YARN_LOCK_PATH)) {
      console.log(`Using ${YARN_LOCK_PATH} instead of npm lock file`);
      const stringifiedPackageLock = yarnToNpm(CWD);
      pkgLockInfo = JSON.parse(stringifiedPackageLock);
    }
  } catch (e) {
    console.error('Error parsing package.json or package-lock.json', e);
    process.exit(1);
  }

  if (!pkgInfo) {
    console.error('pkgInfo undefined');
    process.exit(1);
  }

  const supportedLock = pkgLockInfo && (pkgLockInfo.lockfileVersion == 1 || pkgLockInfo.lockfileVersion == 3);

  if (pkgLockInfo && !supportedLock) {
    console.info(`Unsupported package-lock version ${pkgLockInfo.lockfileVersion}! Falling back to using package.json only!`);
  }

  let keys: string[] = [];
  let extraKeys: string[] = [];

  if (!RUN_PKG_LOCK || !supportedLock) {
    if (pkgInfo.dependencies) {
      keys = keys.concat(Object.keys(pkgInfo.dependencies));
    }
    if (pkgInfo.devDependencies && !ONLY_PROD) {
      keys = keys.concat(Object.keys(pkgInfo.devDependencies));
    }
    if (pkgInfo.optionalDependencies && !ONLY_PROD) {
      keys = keys.concat(Object.keys(pkgInfo.optionalDependencies));
    }
  } else {
    if (pkgLockInfo && pkgLockInfo.lockfileVersion == 1 && (pkgLockInfo as PkgLockJsonDataV1).dependencies) {
      if (ONLY_PROD) {
        console.log('Using --only-prod with --package-lock and yarn based lock or old (v1) npm lock do not work! Usw v3 npm lock');
      }
      keys = Object.keys((pkgLockInfo as PkgLockJsonDataV1).dependencies);
    }
    if (pkgLockInfo && pkgLockInfo.lockfileVersion == 3 && (pkgLockInfo as PkgLockJsonDataV3).packages) {
      const prodKeys = pkgInfo.dependencies ? Object.keys(pkgInfo.dependencies) : [];
      const baseKeys = Object.keys((pkgLockInfo as PkgLockJsonDataV3).packages);
      const prodKeysDir = prodKeys.map((k) => `${k}/`);

      extraKeys = ONLY_PROD
        ? baseKeys
            .map((k) => k.split('node_modules/'))
            .filter((k) => k.length > 2 && prodKeysDir.includes(k[1]))
            .map((k) => k.join('node_modules/'))
        : [];

      keys = baseKeys
        .map((k) => k.split('node_modules/'))
        .filter((k) => k.length == 2)
        .map((k) => k[1])
        .filter((k) => (ONLY_PROD ? prodKeys.includes(k) : true));
    }
  }

  let pkgs: PkgInfo[] = [];

  for (const pkg of keys) {
    const info: PkgInfo = { name: pkg, version: '', localPackageFile: '' };
    if (pkgLockInfo && pkgLockInfo.lockfileVersion == 1) {
      const lockInfo = pkgLockInfo as PkgLockJsonDataV1;
      if (lockInfo.dependencies && lockInfo.dependencies[pkg]) {
        info.version = lockInfo.dependencies[pkg].version;
        info.tarball = lockInfo.dependencies[pkg].resolved;
        info.localPackageFile = `node_modules/${pkg}/package.json`;
      } else {
        console.warn(`Could not find ${pkg} in package-lock.json! Skipping...`);
        continue;
      }
    }
    if (pkgLockInfo && pkgLockInfo.lockfileVersion == 3) {
      const lockInfo = pkgLockInfo as PkgLockJsonDataV3;
      const pkgKey = `node_modules/${pkg}`;
      if (lockInfo.packages && lockInfo.packages[pkgKey]) {
        info.version = lockInfo.packages[pkgKey].version;
        info.tarball = lockInfo.packages[pkgKey].resolved;
        info.localPackageFile = `node_modules/${pkg}/package.json`;
      } else {
        console.warn(`Could not find ${pkg} in package-lock.json! Skipping...`);
        continue;
      }
    }
    pkgs.push(info);
  }

  for (const path of extraKeys) {
    const pkg = path.split('node_modules/').pop() || '';
    const info: PkgInfo = { name: pkg, version: '', localPackageFile: `${path}/package.json` };
    const lockInfo = pkgLockInfo as PkgLockJsonDataV3;
    if (lockInfo.packages && lockInfo.packages[path]) {
      info.version = lockInfo.packages[path].version;
      info.tarball = lockInfo.packages[path].resolved;
    } else {
      console.warn(`Could not find ${pkg} in package-lock.json! Skipping...`);
      continue;
    }
    pkgs.push(info);
  }

  const ignoredPkgs = IGNORED.split(';')
    .map((ig) => ig.trim())
    .filter((ig) => ig.length > 0);

  pkgs = pkgs.filter((pkg) => !ignoredPkgs.includes(pkg.name));
  pkgs = pkgs.sort((a, b) => fixedName(a.name).localeCompare(fixedName(b.name)));

  const versionCorpus = pkgs.map((pkg) => `${pkg.name}@${pkg.version}`).join(', ');

  const versionCorpusHash = crypto.createHash('sha1').update(versionCorpus).digest('hex');

  if (CHECKSUM_PATH !== false) {
    if (fs.existsSync(CHECKSUM_PATH as string)) {
      const gotDigest = fs.readFileSync(CHECKSUM_PATH as string, 'utf8');
      if (gotDigest == versionCorpusHash) {
        console.log(`Generating license HTML skipped, license already generated for corpus: ${versionCorpusHash}`);
        process.exit(0);
      }
    }
  }

  if (CHECKSUM_EMBED !== false) {
    if (fs.existsSync(OUT_PATH)) {
      const oldHtml = fs.readFileSync(OUT_PATH, 'utf8');
      if (oldHtml.includes(`[[checksum: ${versionCorpusHash}]]`)) {
        console.log(`Generating license HTML skipped, license already generated for corpus: ${versionCorpusHash}`);
        process.exit(0);
      }
    }
  }

  console.log(`Generating license HTML for corpus: ${versionCorpusHash} \n Contains packages: ${versionCorpus}`);

  if (!fs.existsSync(TMP_FOLDER_PATH)) {
    fs.mkdirSync(TMP_FOLDER_PATH);
  }
  const promises: Promise<LicenseInfo>[] = [];
  for (const pkg of pkgs) {
    promises.push(getPkgLicense(pkg));
  }

  try {
    const licenses = await Promise.all(promises);
    licenses.sort((a, b) => fixedName(a.pkg.name).localeCompare(fixedName(b.pkg.name)));

    console.log(`Found ${licenses.length} licenses`);

    const preGroupedLicenses: GroupedLicense[] = [];
    let groupedLicenses: GroupedLicense[] = [];
    const groupedLicensesObj: { [key: string]: GroupedLicense } = {};
    if (GROUP) {
      for (const license of licenses) {
        for (const [textKey, text] of Object.entries(license.texts)) {
          if (text) {
            let found = false;
            for (const groupedLicense of preGroupedLicenses) {
              if (groupedLicense.texts[textKey]) {
                groupedLicense.pkgs.push({ ...license.pkg, comma: true });
                found = true;
              }
            }
            if (!found) {
              const newTexts: { [key: string]: string } = {};
              newTexts[textKey] = text;
              preGroupedLicenses.push({
                pkgs: [{ ...license.pkg, comma: true }],
                texts: newTexts,
                licenses: [],
                uid: '',
              });
            }
          }
        }
      }

      for (const groupedLicense of preGroupedLicenses) {
        groupedLicense.pkgs = filterUnique(groupedLicense.pkgs);

        const groupId = groupedLicense.pkgs.map((gl) => gl.name).join(', ');
        if (groupedLicensesObj[groupId]) {
          groupedLicensesObj[groupId].texts = {
            ...groupedLicensesObj[groupId].texts,
            ...groupedLicense.texts,
          };
        } else {
          groupedLicensesObj[groupId] = groupedLicense;
        }

        groupedLicensesObj[groupId].uid = crypto.createHash('sha1').update(groupId).digest('hex').substring(0, 12);
      }

      groupedLicenses = Object.values(groupedLicensesObj);

      for (const license of groupedLicenses) {
        for (const i in license.pkgs) {
          if (i === String(license.pkgs.length - 1)) {
            license.pkgs[i].comma = false;
          }
        }
      }
    } else {
      for (const license of licenses) {
        license.uid = crypto.createHash('sha1').update(license.pkg.name).digest('hex').substring(0, 12);
      }
    }

    const renderLicenses = GROUP
      ? groupedLicenses
      : licenses.map((licenseInfo) => {
          return {
            pkgs: [{ ...licenseInfo.pkg, comma: false }],
            type: licenseInfo.type,
            uid: licenseInfo.uid,
            texts: licenseInfo.texts,
            licenses: [],
          };
        });

    renderLicenses.forEach((rl) => {
      rl.licenses = Object.values(rl.texts);
    });

    console.log(`Loading template from: ${TEMPLATE_PATH}`);
    const outText = mustache.render(fs.readFileSync(TEMPLATE_PATH).toString(), {
      renderLicenses,
      name: TITLE ? TITLE : pkgInfo.name,
      index: ADD_INDEX ? buildIndex(renderLicenses) : [],
      comments: CHECKSUM_EMBED ? `<!-- [[checksum: ${versionCorpusHash}]] -->` : '',
      addIndex: ADD_INDEX,
    });

    const outDir = path.dirname(OUT_PATH);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    fs.writeFileSync(OUT_PATH, outText);
    if (CHECKSUM_PATH !== false) {
      fs.writeFileSync(CHECKSUM_PATH as string, versionCorpusHash);
    }
  } catch (e) {
    console.error('Error!', e);
  }

  if (!KEEP_CACHE) {
    rimraf.sync(TMP_FOLDER_PATH);
  }
  console.log('Done!');
}

yargs
  .scriptName('html-license-gen')
  .command('$0 [folder]', '', (yargs) => {
    const argv = yargs

      // files and paths

      .positional('folder', {
        describe: 'Folder of NPM project. Defaults to current working directory',
        type: 'string',
      })
      .option('out-path', {
        describe: 'HTML output path',
        type: 'string',
        default: './licenses.html',
      })
      .option('tmp-folder-name', {
        describe: 'Name of temporary folder',
        type: 'string',
        default: '.license-gen-tmp',
      })

      // appearance
      .option('group', {
        describe: 'Group licenses',
        type: 'boolean',
        default: true,
      })
      .option('external-links', {
        describe: 'Link package names to their repos',
        type: 'boolean',
        default: true,
      })
      .option('add-index', {
        describe: 'Creates index with link to licenses below',
        type: 'boolean',
        default: false,
      })
      .option('title', {
        describe: 'Use given value as document title',
        type: 'string',
        default: false,
      })
      .option('template', {
        describe: 'Path to custom mustache template',
        type: 'string',
      })

      // package related

      .option('registry', {
        describe: 'URL of package registry to use',
        type: 'string',
        default: 'https://registry.npmjs.org',
      })
      .option('ignored', {
        describe: 'Semicolon-separated list of packages to ignore',
        type: 'string',
        default: 'html-license-gen',
      })
      .option('only-prod', {
        describe: 'Ignore optional and dev dependencies',
        type: 'boolean',
        default: false,
      })
      .option('package-lock', {
        describe: 'Run on all packages listed in package-lock.json',
        type: 'boolean',
        default: false,
      })

      // cache and optimization

      .option('keep-cache', {
        describe: 'Do not clean cache after run',
        type: 'boolean',
        default: false,
      })
      .option('checksum-path', {
        describe: 'Checksum file path, to detect if update of HTML is needed',
        type: 'string',
        default: false,
      })
      .option('checksum-embed', {
        describe: 'Embed checksum into HTML to detect need for update',
        type: 'boolean',
        default: false,
      })
      .option('avoid-registry', {
        describe: 'Try local package.json instead asking online registry',
        type: 'boolean',
        default: true,
      })
      .option('no-spdx', {
        describe: 'Do not download license file based on SPDX string',
        type: 'boolean',
        default: false,
      })
      .option('only-spdx', {
        describe: 'Do not use tarballs, only use SPDX string',
        type: 'boolean',
        default: false,
      })
      .option('only-local-tar', {
        describe: 'Do not download tarballs, use only local tarballs',
        type: 'boolean',
        default: true,
      })
      .option('error-missing', {
        describe: 'Exit 1 if no license is present for a package',
        type: 'boolean',
        default: false,
      }).argv;

    const folder = argv.folder || (argv._[0] as string);
    CWD = folder ? path.resolve(folder) : process.cwd();
    REGISTRY = argv.registry;
    PKG_JSON_PATH = path.resolve(CWD, 'package.json');
    PKG_LOCK_JSON_PATH = path.resolve(CWD, 'package-lock.json');
    YARN_LOCK_PATH = path.resolve(CWD, 'yarn.lock');
    TMP_FOLDER_PATH = path.resolve(CWD, argv['tmp-folder-name']);
    NODE_MODULES_PATH = path.resolve(CWD, 'node_modules');
    OUT_PATH = path.resolve(argv['out-path']);
    GROUP = argv['group'];
    EXTERNAL_LINKS = argv['external-links'];
    ADD_INDEX = argv['add-index'];
    TITLE = argv['title'];
    IGNORED = argv['ignored'];
    ONLY_PROD = argv['only-prod'];
    KEEP_CACHE = argv['keep-cache'];
    CHECKSUM_PATH = argv['checksum-path'];
    CHECKSUM_EMBED = argv['checksum-embed'];
    TEMPLATE_PATH = argv.template ? path.resolve(argv.template) : path.join(__dirname, 'template.html');
    AVOID_REGISTRY = argv['avoid-registry'];
    RUN_PKG_LOCK = argv['package-lock'];
    NO_SPDX = argv['no-spdx'];
    ONLY_SPDX = argv['only-spdx'];
    ONLY_LOCAL_TAR = argv['only-local-tar'];
    ERR_MISSING = argv['error-missing'];
    main();
  })
  .help()
  .group(['folder', 'out-path', 'tmp-folder-name'], 'Paths and files:')
  .group(['group', 'external-links', 'add-index', 'title', 'template'], 'Output HTML appearance:')
  .group(['registry', 'ignored', 'only-prod', 'package-lock'], 'Package related:')
  .group(['keep-cache', 'checksum-path', 'checksum-embed', 'avoid-registry', 'no-spdx', 'only-spdx', 'only-local-tar'], 'Cache and optimization:').argv;
