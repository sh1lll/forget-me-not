# Contributing to Forget-Me-Not

Thanks for helping! Forget-Me-Not is made and maintained by [sh1lll](https://github.com/sh1lll).

## The easiest contribution: add an AI tool

If an AI tool keeps memory or instructions in files and Forget-Me-Not doesn't find it, it's usually one line in
[`lib/sources.mjs`](lib/sources.mjs) — add an entry to `APPS`:

```js
{ id: 'my-tool', name: 'My Tool', color: '#3366ff', home: '.my-tool',
  global: [{ file: '.my-tool/RULES.md' }],          // applies everywhere (relative to your home folder)
  project: [{ dir: '.my-tool/rules' }] },          // looked for inside each project
```

Use `{ default: '…', win32: '…' }` when the location differs on Windows. Please link the tool's docs in your pull
request so the location can be checked.

Not sure how? [Open an issue](https://github.com/sh1lll/forget-me-not/issues) with the tool's name and where it keeps
its memory, and it'll get added.

## Working on the code

```
npm install
npm run app     # desktop app
npm start       # browser version
npm test        # must pass before a pull request
```

- No build step: plain JavaScript, Node 18+ (22.5+ for the database sources).
- Keep the app simple to use — plain words, one obvious way to do each thing.
- Never hard-delete: anything removed or replaced goes to Deleted first.
- Test against a copy, not your real memory: `HOME=/path/to/a/copy FMN_DATA_DIR=/path/to/a/scratch/folder npm start`.

## Reporting a security problem

Please don't open a public issue — contact [sh1lll](https://github.com/sh1lll) directly on GitHub.

## License

By contributing you agree your work is released under the [Apache License 2.0](LICENSE), the same as the rest of the project (© sh1lll).
