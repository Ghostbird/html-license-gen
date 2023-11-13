interface PkgJsonData {
  name: string;
  version: string;
  homepage?: string;
  license?: string;
  repository?:
    | {
        type: string;
        url: string;
      }
    | string;
  dependencies?: {
    [key: string]: string;
  };
  devDependencies?: {
    [key: string]: string;
  };
  optionalDependencies?: {
    [key: string]: string;
  };
}

interface PkgLockJsonDataV1 {
  dependencies: {
    [name: string]: {
      version: string;
      resolved: string;
    };
  };
  lockfileVersion: number;
}

interface PkgLockJsonDataV3 {
  packages: {
    [name: string]: {
      version: string;
      resolved: string;
    };
  };
  lockfileVersion: number;
}

type PkgLockJsonData = PkgLockJsonDataV1 | PkgLockJsonDataV3;

interface PkgInfo {
  name: string;
  version: string;
  tarball?: string;
  homepage?: string;
  shortLink?: string;
  localPackageFile: string;
}

interface LicenseInfo {
  pkg: PkgInfo;
  uid: string;
  type: string;
  texts: { [key: string]: string };
}

interface GroupedLicensePkg extends PkgInfo {
  // false if last item in group
  comma: boolean;
}

interface GroupedLicense {
  pkgs: GroupedLicensePkg[];
  uid: string;
  texts: { [key: string]: string };
  licenses: string[];
}
interface IndexDetails {
  name: string;
  link: string;
}

interface SubIndexes {
  additional: IndexDetails[];
  comma: boolean;
}

type IndexEntry = IndexDetails & SubIndexes;

type KeyMap = { [key: string]: string };
