// Ship the exact same validator to the dependency-free Node portable runtime.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, 'public/_server'), { recursive: true });
fs.writeFileSync(
  path.join(root, 'public/_server/recruitment.cjs'),
  ts.transpileModule(
    fs.readFileSync(path.join(root, 'lib/recruitment.ts'), 'utf8'),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    },
  ).outputText,
);
