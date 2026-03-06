const fs = require('fs');
const path = require('path');

const rootDir = process.argv[2];

if (!rootDir) {
  console.error('Usage: node scripts/fix-browser-esm-imports.cjs <directory>');
  process.exit(1);
}

const FROM_RE = /(from\s+['"])(\.{1,2}\/[^'"]+)(['"])/g;
const DYNAMIC_IMPORT_RE = /(import\s*\(\s*['"])(\.{1,2}\/[^'"]+)(['"]\s*\))/g;

const needsJsExtension = (specifier) => {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return false;
  const clean = specifier.split('?')[0].split('#')[0];
  return path.extname(clean) === '';
};

const rewriteSpecifier = (specifier) => {
  if (!needsJsExtension(specifier)) return specifier;
  const [pathname, suffix = ''] = specifier.match(/^[^?#]+/) ? [specifier.match(/^[^?#]+/)[0], specifier.slice(specifier.match(/^[^?#]+/)[0].length)] : [specifier, ''];
  return `${pathname}.js${suffix}`;
};

const processFile = (filePath) => {
  const original = fs.readFileSync(filePath, 'utf8');
  const updated = original
    .replace(FROM_RE, (match, prefix, specifier, suffix) => `${prefix}${rewriteSpecifier(specifier)}${suffix}`)
    .replace(DYNAMIC_IMPORT_RE, (match, prefix, specifier, suffix) => `${prefix}${rewriteSpecifier(specifier)}${suffix}`);
  if (updated !== original) {
    fs.writeFileSync(filePath, updated, 'utf8');
  }
};

const walk = (dirPath) => {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const nextPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walk(nextPath);
      continue;
    }
    if (entry.isFile() && nextPath.endsWith('.js')) {
      processFile(nextPath);
    }
  }
};

walk(path.resolve(rootDir));
